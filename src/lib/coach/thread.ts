import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Stored message content is Anthropic content blocks, plus one custom block for
// photos ({type: "photo", file, media_type}) so images live on disk, not in SQLite.

export type PhotoBlock = { type: "photo"; file: string; media_type: string };
export type StoredBlock = Anthropic.ContentBlockParam | PhotoBlock;

const DATA_DIR = path.dirname(path.resolve(/*turbopackIgnore: true*/ process.env.DATABASE_PATH ?? "data/app.db"));
const uploadsDir = (userId: number) => path.join(DATA_DIR, "uploads", String(userId));

export const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" } as const;
export type PhotoType = keyof typeof PHOTO_TYPES;

export function savePhoto(userId: number, bytes: Buffer, mediaType: PhotoType): PhotoBlock {
  const dir = uploadsDir(userId);
  fs.mkdirSync(dir, { recursive: true });
  const file = `${randomBytes(12).toString("hex")}.${PHOTO_TYPES[mediaType]}`;
  fs.writeFileSync(path.join(dir, file), bytes, { mode: 0o600 });
  return { type: "photo", file, media_type: mediaType };
}

/** Reads one of this user's photos. File names are validated so paths can't escape the folder. */
export function readPhoto(userId: number, file: string) {
  if (!/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(file)) return null;
  const p = path.join(uploadsDir(userId), file);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

export function addMessage(userId: number, role: "user" | "assistant", content: StoredBlock[], kind: "chat" | "checkin" = "chat") {
  return db.insert(schema.messages).values({ userId, role, kind, content }).returning().get();
}

export function recentMessages(userId: number, limit: number) {
  return db
    .select()
    .from(schema.messages)
    .where(and(eq(schema.messages.userId, userId)))
    .orderBy(desc(schema.messages.id))
    .limit(limit)
    .all()
    .reverse();
}

const isToolResult = (c: unknown[]) => c.some((b) => (b as { type?: string }).type === "tool_result");

/**
 * The last turns of the thread, shaped for the Messages API: starts on a real user
 * turn (or a check-in), merges same-role neighbours, and sends the actual image
 * only for photos in the newest user message.
 */
export function historyForModel(userId: number, limit = 40): Anthropic.MessageParam[] {
  const rows = recentMessages(userId, limit);
  // Don't start mid tool exchange.
  while (rows.length && (isToolResult(rows[0].content) || (rows[0].role === "assistant" && rows[0].kind !== "checkin")))
    rows.shift();
  const lastUser = [...rows].reverse().find((r) => r.role === "user" && !isToolResult(r.content));

  const out: Anthropic.MessageParam[] = [];
  for (const r of rows) {
    const blocks = (r.content as StoredBlock[]).map((b): Anthropic.ContentBlockParam => {
      if (b.type !== "photo") return b;
      if (r === lastUser) {
        const bytes = readPhoto(userId, b.file);
        if (bytes)
          return {
            type: "image",
            source: { type: "base64", media_type: b.media_type as PhotoType, data: bytes.toString("base64") },
          };
      }
      return { type: "text", text: "[They attached a photo here earlier.]" };
    });
    if (r.kind === "checkin") blocks.unshift({ type: "text", text: "(Scheduled check-in sent by the app:)" });
    const prev = out[out.length - 1];
    if (prev && prev.role === r.role) (prev.content as Anthropic.ContentBlockParam[]).push(...blocks);
    else out.push({ role: r.role, content: blocks });
  }
  // A tool call whose results never got stored (e.g. a crash) would be rejected by the API.
  out.forEach((m, i) => {
    if (m.role !== "assistant" || typeof m.content === "string") return;
    const next = out[i + 1];
    const answered = new Set(
      next && typeof next.content !== "string"
        ? next.content.flatMap((b) => (b.type === "tool_result" ? [b.tool_use_id] : []))
        : [],
    );
    m.content = m.content.filter((b) => b.type !== "tool_use" || answered.has(b.id));
    if (!m.content.length) m.content = [{ type: "text", text: "(no reply)" }];
  });
  if (out[0]?.role === "assistant") out.unshift({ role: "user", content: "(Earlier conversation omitted.)" });
  return out;
}

import { requireUser } from "@/lib/auth";
import { coachEnabled } from "@/lib/coach/run";
import { recentMessages, type StoredBlock } from "@/lib/coach/thread";
import { toolLabel } from "@/lib/coach/tools";
import AppNav from "../AppNav";
import Chat, { type Bubble } from "./Chat";

export const metadata = { title: "Coach · Scale & Plate" };

/** Turns stored API turns into chat bubbles: one bubble per reply, tool calls as chips. */
function toBubbles(rows: ReturnType<typeof recentMessages>): Bubble[] {
  const out: Bubble[] = [];
  for (const r of rows) {
    const blocks = r.content as StoredBlock[];
    if (blocks.some((b) => b.type === "tool_result")) continue;
    if (r.role === "user") {
      out.push({
        id: r.id,
        role: "user",
        text: blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"),
        photos: blocks.flatMap((b) => (b.type === "photo" ? [b.file] : [])),
        tools: [],
      });
      continue;
    }
    const text = blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n\n");
    const tools = blocks.flatMap((b) =>
      b.type === "tool_use" ? [toolLabel(b.name, (b.input ?? {}) as Record<string, unknown>)] : [],
    );
    const prev = out[out.length - 1];
    if (prev?.role === "assistant" && !prev.checkin && r.kind !== "checkin") {
      prev.text = [prev.text, text].filter(Boolean).join("\n\n");
      prev.tools.push(...tools);
    } else {
      out.push({ id: r.id, role: "assistant", text, photos: [], tools, checkin: r.kind === "checkin" });
    }
  }
  return out;
}

export default async function CoachPage() {
  const user = await requireUser();
  const bubbles = toBubbles(recentMessages(user.id, 120));
  return (
    <main className="shell" style={{ display: "flex", flexDirection: "column", minHeight: "100dvh", paddingBottom: 0 }}>
      <AppNav name={user.name} />
      <Chat initial={bubbles} enabled={coachEnabled()} name={user.name} />
    </main>
  );
}

import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { User } from "@/db/schema";
import { systemPrompt } from "./prompt";
import { addMessage, historyForModel, type StoredBlock } from "./thread";
import { runTool, toolLabel, toolsFor } from "./tools";

export const COACH_MODEL = process.env.COACH_MODEL ?? "claude-sonnet-5-5";
const MAX_STEPS = 8;

export type CoachEvent =
  | { t: "text"; d: string }
  | { t: "tool"; label: string }
  | { t: "done" }
  | { t: "error"; m: string };

let client: Anthropic | null = null;
export const coachEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

// One reply at a time per user, so tool calls and stored turns never interleave.
const busy = new Set<number>();
export const isBusy = (userId: number) => busy.has(userId);

/** Stores the user's turn, then runs the tool loop, streaming events to `emit`. */
export async function coachReply(user: User, userContent: StoredBlock[], emit: (e: CoachEvent) => void, signal?: AbortSignal) {
  client ??= new Anthropic();
  busy.add(user.id);
  try {
    addMessage(user.id, "user", userContent);
    const messages = historyForModel(user.id);
    const tools = toolsFor(user);
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = client.messages.stream(
        { model: COACH_MODEL, max_tokens: 2048, system: systemPrompt(user), tools, messages },
        { signal },
      );
      stream.on("text", (d) => emit({ t: "text", d }));
      const msg = await stream.finalMessage();
      addMessage(user.id, "assistant", msg.content as StoredBlock[]);
      messages.push({ role: "assistant", content: msg.content });
      if (msg.stop_reason !== "tool_use") break;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const b of msg.content) {
        if (b.type !== "tool_use") continue;
        const input = (b.input ?? {}) as Record<string, unknown>;
        let out: unknown;
        try {
          out = runTool(user, b.name, input);
        } catch (e) {
          console.error("tool failed", b.name, e);
          out = { error: "The server could not complete this action." };
        }
        const failed = typeof out === "object" && out !== null && "error" in out;
        if (!failed) emit({ t: "tool", label: toolLabel(b.name, input) });
        results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out), is_error: failed });
      }
      addMessage(user.id, "user", results);
      messages.push({ role: "user", content: results });
      emit({ t: "text", d: "\n\n" });
    }
    emit({ t: "done" });
  } catch (e) {
    console.error("coach error", e);
    const m =
      e instanceof Anthropic.APIError && e.status === 429
        ? "The coach is busy right now. Try again in a minute."
        : "Something went wrong reaching the coach. Your message is saved; try again.";
    emit({ t: "error", m });
  } finally {
    busy.delete(user.id);
  }
}

import { currentUser } from "@/lib/auth";
import { coachEnabled, coachReply, isBusy, type CoachEvent } from "@/lib/coach/run";
import { PHOTO_TYPES, savePhoto, type PhotoType, type StoredBlock } from "@/lib/coach/thread";

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const json = (status: number, error: string) => Response.json({ error }, { status });

// POST multipart: text, optional photo. Responds with NDJSON CoachEvents.
export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return json(401, "Signed out. Please sign in again.");
  if (!coachEnabled()) return json(503, "The coach isn't set up on this server yet (missing API key).");
  if (isBusy(user.id)) return json(409, "The coach is still answering your last message.");

  const form = await request.formData();
  const text = String(form.get("text") ?? "").trim().slice(0, 4000);
  const photo = form.get("photo");
  const content: StoredBlock[] = [];

  if (photo instanceof File && photo.size > 0) {
    if (!(photo.type in PHOTO_TYPES)) return json(400, "Photos must be JPEG, PNG, WebP or GIF.");
    if (photo.size > MAX_PHOTO_BYTES) return json(400, "That photo is too large (8 MB max).");
    content.push(savePhoto(user.id, Buffer.from(await photo.arrayBuffer()), photo.type as PhotoType));
  }
  if (text) content.push({ type: "text", text });
  if (!content.length) return json(400, "Say something or attach a photo.");

  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: CoachEvent) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          // Client went away; the reply still finishes and is saved.
        }
      };
      await coachReply(user, content, emit);
      try {
        controller.close();
      } catch {}
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}

import "server-only";
import webpush from "web-push";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";

export const pushEnabled = () =>
  Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

let configured = false;
function configure() {
  if (configured) return;
  const subject = process.env.VAPID_SUBJECT || process.env.APP_URL || "https://localhost";
  webpush.setVapidDetails(subject, process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!, process.env.VAPID_PRIVATE_KEY!);
  configured = true;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

/** Sends to every device the user subscribed. Drops subscriptions the push service says are gone. */
export async function pushToUser(userId: number, payload: PushPayload) {
  if (!pushEnabled()) return 0;
  configure();
  const subs = db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId)).all();
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 3, urgency: "normal" },
        );
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id)).run();
        } else {
          console.error("push failed", status ?? e);
        }
      }
    }),
  );
  return sent;
}

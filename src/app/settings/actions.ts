"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { pushToUser } from "@/lib/push";

type Sub = { endpoint: string; keys?: { p256dh?: string; auth?: string } };

export async function savePushSubscription(sub: Sub) {
  const user = await requireUser();
  const { endpoint, keys } = sub;
  if (!/^https:\/\//.test(endpoint ?? "") || !keys?.p256dh || !keys.auth) return { error: "Invalid subscription" };
  db.insert(schema.pushSubscriptions)
    .values({ userId: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth })
    .onConflictDoUpdate({
      target: schema.pushSubscriptions.endpoint,
      set: { userId: user.id, p256dh: keys.p256dh, auth: keys.auth },
    })
    .run();
  return { ok: true };
}

export async function removePushSubscription(endpoint: string) {
  const user = await requireUser();
  db.delete(schema.pushSubscriptions)
    .where(and(eq(schema.pushSubscriptions.userId, user.id), eq(schema.pushSubscriptions.endpoint, endpoint)))
    .run();
  return { ok: true };
}

export async function sendTestPush() {
  const user = await requireUser();
  const sent = await pushToUser(user.id, {
    title: "Scale & Plate",
    body: `Notifications are on, ${user.name}. Check-ins will look like this.`,
    url: "/coach",
    tag: "test",
  });
  return { sent };
}

export type TimesState = { ok?: string; error?: string } | undefined;

export async function saveCheckinTimes(_: TimesState, form: FormData): Promise<TimesState> {
  const user = await requireUser();
  const on = form.get("enabled") === "on";
  const times = form
    .getAll("time")
    .map(String)
    .filter(Boolean);
  if (times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return { error: "Use times like 07:53." };
  const unique = [...new Set(times)].sort();
  db.update(schema.users)
    .set({ checkinTimes: on ? unique : [] })
    .where(eq(schema.users.id, user.id))
    .run();
  revalidatePath("/settings");
  return { ok: on ? "Check-in times saved." : "Check-ins turned off." };
}

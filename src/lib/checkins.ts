import "server-only";
import { db, schema } from "@/db";
import type { User } from "@/db/schema";
import { addMessage } from "@/lib/coach/thread";
import { getDays, todayIn } from "@/lib/data";
import { pushToUser } from "@/lib/push";

// Meal check-ins, carried over from the Cowork scheduled task (07:53, 11:53, 17:53):
// before 10 AM morning, 10 AM to 3 PM midday, after that evening. Each one asks
// only about what isn't logged yet and is skipped when there's nothing to ask.

const WINDOW_MIN = 45; // a check-in missed by more than this (server down) is dropped, not sent late

type Slot = "morning" | "midday" | "evening";
const slotFor = (hhmm: string): Slot => (hhmm < "10:00" ? "morning" : hhmm < "15:00" ? "midday" : "evening");

function localClock(tz: string, now: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get("hour")}:${get("minute")}`;
}
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

/** The check-in text for a slot, or null when everything it would ask about is logged. */
export function composeCheckin(user: User, slot: Slot, now = new Date()) {
  const today = todayIn(user.timezone, now);
  const { days, base } = getDays(user.id, today, user.activityTracking);
  const d = days.find((x) => x.date === today)!;
  const yesterdayDate = new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10);
  const y = days.find((x) => x.date === yesterdayDate);
  const has = (day: typeof d | undefined, meal: string) => !!day?.items.some((i) => i.meal.toLowerCase() === meal.toLowerCase());
  const noom = user.programMode === "noom";

  const asks: string[] = [];
  let short = "";
  if (slot === "morning") {
    const needWeight = d.weight == null;
    const needBreakfast = !has(d, "Breakfast");
    if (!needWeight && !needBreakfast) return null;
    if (needWeight) asks.push("Did you weigh yourself this morning? If so, what was it?");
    if (needBreakfast && y && has(y, "Dinner") && !has(y, "Evening Snack")) asks.push("Did you eat anything after dinner last night?");
    if (needBreakfast) asks.push("What did you have for breakfast?");
    short = needWeight && needBreakfast ? "Weight and breakfast?" : needWeight ? "Did you weigh in?" : "What was breakfast?";
  } else if (slot === "midday") {
    if (has(d, "Lunch")) return null;
    asks.push(has(d, "Morning Snack") ? "What did you have for lunch?" : "What did you have for a morning snack (if anything) and lunch?");
    short = "What was lunch?";
  } else {
    if (has(d, "Dinner")) return null;
    asks.push(has(d, "Afternoon Snack") ? "What did you have for dinner?" : "What did you have for an afternoon snack (if anything) and dinner?");
    short = "What was dinner?";
  }

  const hello = { morning: "Good morning", midday: "Hi", evening: "Good evening" }[slot];
  const target = d.target ?? base;
  const status =
    target == null ? "" : `\n\nSo far today: ${fmt(d.cal)} of ${fmt(target)} cal, ${fmt(target - d.cal)} left.`;
  const lead = noom ? `${hello}, ${user.name}. Quick check-in when you have a minute.` : `${hello}, ${user.name}.`;
  return {
    text: `${lead} ${asks.join(" ")}${status}`,
    push: { title: `${slot[0].toUpperCase()}${slot.slice(1)} check-in`, body: short, url: "/coach", tag: `checkin-${slot}` },
  };
}

/** Sends every check-in that is due now and hasn't gone out yet. Safe to call every minute. */
export async function runDueCheckins(now = new Date()) {
  const users = db.select().from(schema.users).all();
  const sent: string[] = [];
  for (const user of users) {
    const today = todayIn(user.timezone, now);
    const clock = minutes(localClock(user.timezone, now));
    for (const t of user.checkinTimes) {
      const late = clock - minutes(t);
      if (late < 0 || late > WINDOW_MIN) continue;
      // Claim the slot first so a slow push or a second runner can't send it twice.
      const claimed = db.insert(schema.checkinsSent).values({ userId: user.id, date: today, slot: t }).onConflictDoNothing().run();
      if (!claimed.changes) continue;
      const msg = composeCheckin(user, slotFor(t), now);
      if (!msg) continue;
      addMessage(user.id, "assistant", [{ type: "text", text: msg.text }], "checkin");
      await pushToUser(user.id, msg.push);
      sent.push(`${user.username}@${t}`);
    }
  }
  return sent;
}

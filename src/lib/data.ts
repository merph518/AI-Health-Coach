import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";

// Every read here is scoped to one user id. Nothing in this module joins across users.

export const MEAL_ORDER: Record<string, number> = {
  breakfast: 0,
  "morning snack": 1,
  lunch: 2,
  "afternoon snack": 3,
  dinner: 4,
  snack: 5,
  "evening snack": 5,
  dessert: 5,
};
export const mealRank = (m: string) => MEAL_ORDER[m.trim().toLowerCase()] ?? 6;

export type DayItem = {
  id: number;
  meal: string;
  item: string;
  qty: number;
  cal: number;
  p: number;
  c: number;
  f: number;
  note: string | null;
};

export type Day = {
  date: string;
  items: DayItem[];
  cal: number;
  p: number;
  c: number;
  f: number;
  base: number | null;
  target: number | null;
  active: number | null;
  steps: number | null;
  exercise: number | null;
  partial: boolean;
  weight: number | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;

export function todayIn(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now);
}

/** Base target in effect on a date (latest history row on or before it, else the earliest). */
function baseFor(history: { effectiveDate: string; baseKcal: number }[], date: string) {
  let base: number | null = history[0]?.baseKcal ?? null;
  for (const h of history) if (h.effectiveDate <= date) base = h.baseKcal;
  return base;
}

/** All days with any data, plus today, oldest first. Mirrors make_page.py. */
export function getDays(userId: number, today: string, activityTracking = true) {
  const profile = db.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).get();
  const eatBack = profile?.eatBackPct ?? 0.5;
  const history = db
    .select()
    .from(schema.targetHistory)
    .where(eq(schema.targetHistory.userId, userId))
    .orderBy(asc(schema.targetHistory.effectiveDate))
    .all();
  const food = db
    .select()
    .from(schema.foodEntries)
    .where(eq(schema.foodEntries.userId, userId))
    .orderBy(asc(schema.foodEntries.date), asc(schema.foodEntries.id))
    .all();
  const acts = !activityTracking ? [] : db.select().from(schema.activity).where(eq(schema.activity.userId, userId)).all();
  const wts = db.select().from(schema.weights).where(eq(schema.weights.userId, userId)).all();

  const days = new Map<string, Day>();
  const day = (date: string) => {
    let d = days.get(date);
    if (!d) {
      d = {
        date,
        items: [],
        cal: 0,
        p: 0,
        c: 0,
        f: 0,
        base: null,
        target: null,
        active: null,
        steps: null,
        exercise: null,
        partial: false,
        weight: null,
      };
      days.set(date, d);
    }
    return d;
  };

  food.sort((a, b) => a.date.localeCompare(b.date) || mealRank(a.meal) - mealRank(b.meal));
  for (const e of food) {
    day(e.date).items.push({
      id: e.id,
      meal: e.meal,
      item: e.item,
      qty: e.qty,
      cal: Math.round(e.qty * e.kcal),
      p: r1(e.qty * e.protein),
      c: r1(e.qty * e.carbs),
      f: r1(e.qty * e.fat),
      note: e.note,
    });
  }
  for (const a of acts) {
    const d = day(a.date);
    d.active = a.activeKcal;
    d.steps = a.steps;
    d.exercise = a.exerciseMin;
    d.partial = a.partial;
  }
  for (const w of wts) day(w.date).weight = w.lb;
  day(today);

  for (const d of days.values()) {
    d.base = baseFor(history, d.date);
    d.target = d.base == null ? null : d.base + Math.round((d.active ?? 0) * eatBack);
    d.cal = d.items.reduce((s, i) => s + i.cal, 0);
    d.p = Math.round(d.items.reduce((s, i) => s + i.p, 0));
    d.c = Math.round(d.items.reduce((s, i) => s + i.c, 0));
    d.f = Math.round(d.items.reduce((s, i) => s + i.f, 0));
  }
  return {
    profile,
    base: baseFor(history, today),
    eatBack,
    days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}


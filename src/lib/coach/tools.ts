import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { User } from "@/db/schema";
import { MEALS } from "@/db/schema";
import { getDays, todayIn } from "@/lib/data";

// The coach never edits a log file: it calls these tools and the server writes rows.
// Every query is scoped to the signed-in user's id.

const DATE = { type: "string", description: "YYYY-MM-DD, the user's local date" } as const;
const NUTRIENTS = {
  kcal: { type: "number", description: "Calories for ONE unit" },
  protein: { type: "number", description: "Grams of protein for one unit" },
  carbs: { type: "number", description: "Grams of carbs for one unit" },
  fat: { type: "number", description: "Grams of fat for one unit" },
  grams: { type: "number", description: "Weight in grams of one unit, if known" },
} as const;

export function toolsFor(user: User): Anthropic.Tool[] {
  const tools: Anthropic.Tool[] = [
    {
      name: "log_food",
      description:
        "Add eaten items to the food log. Nutrition values are PER UNIT and qty is how many units (e.g. 2 eggs: qty 2, kcal 72). " +
        "Call lookup_food_history first for anything the user may have logged before, and reuse that basis.",
      input_schema: {
        type: "object",
        properties: {
          date: DATE,
          meal: { type: "string", enum: [...MEALS] },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item: { type: "string", description: "Short name with portion, e.g. 'Greek yogurt, nonfat (170 g cup)'" },
                qty: { type: "number" },
                ...NUTRIENTS,
                color: {
                  type: "string",
                  enum: ["green", "yellow", "orange"],
                  description: "Calorie-density color, only for Noom-style users",
                },
                note: { type: "string", description: "How the estimate was made and any assumptions" },
              },
              required: ["item", "qty", "kcal", "protein", "carbs", "fat", "note"],
            },
          },
        },
        required: ["date", "meal", "items"],
      },
    },
    {
      name: "update_food_entry",
      description: "Correct a logged item by id (from get_day_summary). Only pass fields that change.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "integer" },
          date: DATE,
          meal: { type: "string", enum: [...MEALS] },
          item: { type: "string" },
          qty: { type: "number" },
          ...NUTRIENTS,
          note: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_food_entry",
      description: "Remove a logged item by id, when the user says it was logged by mistake.",
      input_schema: { type: "object", properties: { id: { type: "integer" } }, required: ["id"] },
    },
    {
      name: "log_weight",
      description: "Record a morning weigh-in in pounds. Replaces any weight already logged for that date.",
      input_schema: {
        type: "object",
        properties: { date: DATE, lb: { type: "number" }, note: { type: "string" } },
        required: ["date", "lb"],
      },
    },
    {
      name: "lookup_food_history",
      description:
        "Search foods this user has logged before (name contains the query). Returns the per-unit basis used, so repeat foods stay consistent.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "One or two key words, e.g. 'yogurt' or 'chobani'" } },
        required: ["query"],
      },
    },
    {
      name: "get_day_summary",
      description: "Everything logged on a date: items with ids, totals, macros, the day's target and calories left.",
      input_schema: { type: "object", properties: { date: DATE }, required: ["date"] },
    },
    {
      name: "get_trend",
      description: "Recent weigh-ins and daily calories vs target, for questions about progress.",
      input_schema: {
        type: "object",
        properties: { days: { type: "integer", description: "How many days back, default 14, max 90" } },
      },
    },
  ];
  if (user.activityTracking) {
    tools.push({
      name: "log_activity",
      description:
        "Record Apple Watch numbers for a date (e.g. from a screenshot). Same-day numbers are partial; replace them later with the full day.",
      input_schema: {
        type: "object",
        properties: {
          date: DATE,
          active_kcal: { type: "number" },
          resting_kcal: { type: "number" },
          steps: { type: "integer" },
          exercise_min: { type: "integer" },
          partial: { type: "boolean", description: "true if the day is not over yet" },
        },
        required: ["date", "active_kcal", "partial"],
      },
    });
  }
  return tools;
}

/** Short human label for a tool call, shown as a chip in the chat. */
export function toolLabel(name: string, input: Record<string, unknown>) {
  switch (name) {
    case "log_food": {
      const n = Array.isArray(input.items) ? input.items.length : 0;
      return `Logged ${n} item${n === 1 ? "" : "s"} to ${String(input.meal ?? "food log").toLowerCase()}`;
    }
    case "update_food_entry":
      return "Updated a food entry";
    case "delete_food_entry":
      return "Removed a food entry";
    case "log_weight":
      return `Logged weight ${input.lb} lb`;
    case "log_activity":
      return "Logged activity";
    case "lookup_food_history":
      return `Checked past "${input.query}"`;
    case "get_day_summary":
      return "Checked the day";
    case "get_trend":
      return "Checked the trend";
    default:
      return name;
  }
}

class ToolError extends Error {}

const num = (v: unknown, name: string, { min = 0, max = 1e6 } = {}) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ToolError(`${name} must be a number between ${min} and ${max}`);
  return n;
};
const optNum = (v: unknown, name: string, opts?: { min?: number; max?: number }) =>
  v == null ? null : num(v, name, opts);

function date(v: unknown, user: User) {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new ToolError("date must be YYYY-MM-DD");
  if (s > todayIn(user.timezone)) throw new ToolError("date is in the future for this user");
  return s;
}

function meal(v: unknown) {
  const m = MEALS.find((x) => x.toLowerCase() === String(v ?? "").toLowerCase());
  if (!m) throw new ToolError(`meal must be one of ${MEALS.join(", ")}`);
  return m;
}

const color = (v: unknown) => (v === "green" || v === "yellow" || v === "orange" ? (v as "green" | "yellow" | "orange") : null);

function daySummary(user: User, d: string) {
  const { days } = getDays(user.id, todayIn(user.timezone), user.activityTracking);
  const day = days.find((x) => x.date === d);
  if (!day) return { date: d, items: [], total_kcal: 0, note: "Nothing logged" };
  return {
    date: d,
    items: day.items.map((i) => ({ id: i.id, meal: i.meal, item: i.item, qty: i.qty, kcal: i.cal, protein: i.p, carbs: i.c, fat: i.f })),
    total_kcal: day.cal,
    protein: day.p,
    carbs: day.c,
    fat: day.f,
    target_kcal: day.target,
    left_kcal: day.target == null ? null : day.target - day.cal,
    weight_lb: day.weight,
    ...(user.activityTracking ? { active_kcal: day.active, steps: day.steps, activity_partial: day.partial } : {}),
  };
}

export function runTool(user: User, name: string, input: Record<string, unknown>): unknown {
  try {
    return execute(user, name, input);
  } catch (e) {
    if (e instanceof ToolError) return { error: e.message };
    throw e;
  }
}

function execute(user: User, name: string, input: Record<string, unknown>): unknown {
  const uid = user.id;
  switch (name) {
    case "log_food": {
      const d = date(input.date, user);
      const m = meal(input.meal);
      const items = Array.isArray(input.items) ? (input.items as Record<string, unknown>[]) : [];
      if (!items.length) throw new ToolError("items is empty");
      const rows = items.map((i) => ({
        userId: uid,
        date: d,
        meal: m,
        item: String(i.item ?? "").trim().slice(0, 200),
        qty: num(i.qty ?? 1, "qty", { min: 0.01, max: 100 }),
        kcal: num(i.kcal, "kcal", { max: 5000 }),
        protein: num(i.protein ?? 0, "protein", { max: 500 }),
        carbs: num(i.carbs ?? 0, "carbs", { max: 1000 }),
        fat: num(i.fat ?? 0, "fat", { max: 500 }),
        grams: optNum(i.grams, "grams", { max: 5000 }),
        color: color(i.color),
        note: i.note ? String(i.note).slice(0, 500) : null,
      }));
      if (rows.some((r) => !r.item)) throw new ToolError("every item needs a name");
      const ids = db.transaction((tx) => {
        const out: number[] = [];
        for (const r of rows) {
          out.push(tx.insert(schema.foodEntries).values(r).returning({ id: schema.foodEntries.id }).get().id);
          tx.insert(schema.foodLibrary)
            .values({ userId: uid, name: r.item, kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, grams: r.grams, color: r.color, note: r.note, lastUsed: d })
            .onConflictDoUpdate({
              target: [schema.foodLibrary.userId, schema.foodLibrary.name],
              set: { kcal: r.kcal, protein: r.protein, carbs: r.carbs, fat: r.fat, grams: r.grams, note: r.note, uses: sql`${schema.foodLibrary.uses} + 1`, lastUsed: d },
            })
            .run();
        }
        return out;
      });
      return { logged_ids: ids, day: daySummary(user, d) };
    }
    case "update_food_entry": {
      const id = num(input.id, "id", { min: 1, max: 1e12 });
      const own = and(eq(schema.foodEntries.id, id), eq(schema.foodEntries.userId, uid));
      const row = db.select().from(schema.foodEntries).where(own).get();
      if (!row) throw new ToolError("no such entry for this user");
      const set: Partial<typeof schema.foodEntries.$inferInsert> = {};
      if (input.date != null) set.date = date(input.date, user);
      if (input.meal != null) set.meal = meal(input.meal);
      if (input.item != null) set.item = String(input.item).slice(0, 200);
      if (input.qty != null) set.qty = num(input.qty, "qty", { min: 0.01, max: 100 });
      if (input.kcal != null) set.kcal = num(input.kcal, "kcal", { max: 5000 });
      if (input.protein != null) set.protein = num(input.protein, "protein", { max: 500 });
      if (input.carbs != null) set.carbs = num(input.carbs, "carbs", { max: 1000 });
      if (input.fat != null) set.fat = num(input.fat, "fat", { max: 500 });
      if (input.grams != null) set.grams = num(input.grams, "grams", { max: 5000 });
      if (input.note != null) set.note = String(input.note).slice(0, 500);
      db.update(schema.foodEntries).set(set).where(own).run();
      return { updated: id, day: daySummary(user, set.date ?? row.date) };
    }
    case "delete_food_entry": {
      const id = num(input.id, "id", { min: 1, max: 1e12 });
      const own = and(eq(schema.foodEntries.id, id), eq(schema.foodEntries.userId, uid));
      const row = db.select().from(schema.foodEntries).where(own).get();
      if (!row) throw new ToolError("no such entry for this user");
      db.delete(schema.foodEntries).where(own).run();
      return { deleted: id, day: daySummary(user, row.date) };
    }
    case "log_weight": {
      const d = date(input.date, user);
      const lb = num(input.lb, "lb", { min: 60, max: 800 });
      const note = input.note ? String(input.note).slice(0, 300) : null;
      db.insert(schema.weights)
        .values({ userId: uid, date: d, lb, note })
        .onConflictDoUpdate({ target: [schema.weights.userId, schema.weights.date], set: { lb, note } })
        .run();
      const profile = db.select().from(schema.profiles).where(eq(schema.profiles.userId, uid)).get();
      const prev = db
        .select()
        .from(schema.weights)
        .where(and(eq(schema.weights.userId, uid), sql`${schema.weights.date} < ${d}`))
        .orderBy(desc(schema.weights.date))
        .get();
      return {
        date: d,
        lb,
        previous: prev ? { date: prev.date, lb: prev.lb, change: +(lb - prev.lb).toFixed(1) } : null,
        since_start: profile?.startWeightLb ? +(lb - profile.startWeightLb).toFixed(1) : null,
      };
    }
    case "log_activity": {
      if (!user.activityTracking) throw new ToolError("activity tracking is off for this user");
      const d = date(input.date, user);
      const vals = {
        activeKcal: num(input.active_kcal, "active_kcal", { max: 6000 }),
        restingKcal: optNum(input.resting_kcal, "resting_kcal", { max: 6000 }),
        steps: optNum(input.steps, "steps", { max: 200000 }),
        exerciseMin: optNum(input.exercise_min, "exercise_min", { max: 1440 }),
        partial: Boolean(input.partial),
        source: "chat",
      };
      db.insert(schema.activity)
        .values({ userId: uid, date: d, ...vals })
        .onConflictDoUpdate({ target: [schema.activity.userId, schema.activity.date], set: vals })
        .run();
      return { day: daySummary(user, d) };
    }
    case "lookup_food_history": {
      const q = String(input.query ?? "").trim().slice(0, 60);
      if (!q) throw new ToolError("query is empty");
      const hits = db
        .select()
        .from(schema.foodLibrary)
        .where(and(eq(schema.foodLibrary.userId, uid), like(schema.foodLibrary.name, `%${q.replace(/[%_]/g, "")}%`)))
        .orderBy(desc(schema.foodLibrary.uses))
        .limit(12)
        .all();
      return hits.length
        ? hits.map((h) => ({ name: h.name, kcal: h.kcal, protein: h.protein, carbs: h.carbs, fat: h.fat, grams: h.grams, note: h.note, times_logged: h.uses, last: h.lastUsed }))
        : { matches: 0 };
    }
    case "get_day_summary":
      return daySummary(user, date(input.date, user));
    case "get_trend": {
      const n = Math.min(90, Math.max(1, Math.round(Number(input.days ?? 14)) || 14));
      const today = todayIn(user.timezone);
      const from = new Date(Date.parse(today) - n * 864e5).toISOString().slice(0, 10);
      const { days, profile } = getDays(uid, today, user.activityTracking);
      const recent = days.filter((d) => d.date >= from);
      return {
        start: profile?.startWeightLb ? { lb: profile.startWeightLb, date: profile.startDate } : null,
        weights: recent.filter((d) => d.weight != null).map((d) => ({ date: d.date, lb: d.weight })),
        days: recent
          .filter((d) => d.items.length)
          .map((d) => ({ date: d.date, kcal: d.cal, target: d.target, protein: d.p })),
      };
    }
    default:
      throw new ToolError(`unknown tool ${name}`);
  }
}

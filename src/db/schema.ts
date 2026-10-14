import { sql } from "drizzle-orm";
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  index,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at").notNull().default(sql`(datetime('now'))`);

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  name: text("name").notNull(),
  // Google account allowed to sign in as this user (lowercase).
  email: text("email").unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  timezone: text("timezone").notNull().default("America/New_York"),
  // Apple Watch activity feeds eat-back calories. Off until a user has a device feed.
  activityTracking: integer("activity_tracking", { mode: "boolean" }).notNull().default(false),
  // Local "HH:MM" times for meal check-ins, JSON array. Empty array turns them off.
  checkinTimes: text("checkin_times", { mode: "json" })
    .$type<string[]>()
    .notNull()
    .default(sql`'["07:53","11:53","17:53"]'`),
  programMode: text("program_mode", { enum: ["classic", "noom"] })
    .notNull()
    .default("noom"),
  createdAt: createdAt(),
});

export const sessions = sqliteTable("sessions", {
  // SHA-256 of the cookie token; the raw token never touches the database.
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
});

export const profiles = sqliteTable("profiles", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  sex: text("sex", { enum: ["male", "female"] }),
  birthdate: text("birthdate"),
  // Used when no birthdate is known: age on a given date.
  age: integer("age"),
  ageAsOf: text("age_as_of"),
  heightIn: real("height_in"),
  activityFactor: real("activity_factor").notNull().default(1.2),
  goalWeightLb: real("goal_weight_lb"),
  paceLbPerWeek: real("pace_lb_per_week").notNull().default(1),
  eatBackPct: real("eat_back_pct").notNull().default(0.5),
  startWeightLb: real("start_weight_lb"),
  startDate: text("start_date"),
  bigPicture: text("big_picture"),
  notes: text("notes"),
});

export const targetHistory = sqliteTable(
  "target_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    effectiveDate: text("effective_date").notNull(),
    baseKcal: integer("base_kcal").notNull(),
    basis: text("basis"),
    createdAt: createdAt(),
  },
  (t) => [index("target_user_date").on(t.userId, t.effectiveDate)],
);

export const weights = sqliteTable(
  "weights",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    lb: real("lb").notNull(),
    measured: integer("measured", { mode: "boolean" }).notNull().default(true),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("weights_user_date").on(t.userId, t.date)],
);

export const activity = sqliteTable(
  "activity",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    activeKcal: real("active_kcal"),
    restingKcal: real("resting_kcal"),
    steps: integer("steps"),
    exerciseMin: integer("exercise_min"),
    source: text("source"),
    partial: integer("partial", { mode: "boolean" }).notNull().default(false),
    updatedAt: createdAt(),
  },
  (t) => [uniqueIndex("activity_user_date").on(t.userId, t.date)],
);

export const MEALS = [
  "Breakfast",
  "Morning Snack",
  "Lunch",
  "Afternoon Snack",
  "Dinner",
  "Evening Snack",
] as const;

export const foodEntries = sqliteTable(
  "food_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    meal: text("meal").notNull(),
    item: text("item").notNull(),
    qty: real("qty").notNull().default(1),
    // Nutrition is per unit ("each"); totals are qty x each, as in tracker-log.md.
    kcal: real("kcal").notNull(),
    protein: real("protein").notNull().default(0),
    carbs: real("carbs").notNull().default(0),
    fat: real("fat").notNull().default(0),
    grams: real("grams"),
    color: text("color", { enum: ["green", "yellow", "orange"] }),
    note: text("note"),
    createdAt: createdAt(),
  },
  (t) => [index("food_user_date").on(t.userId, t.date)],
);

// Foods a person has logged before, so repeat items reuse the same basis.
export const foodLibrary = sqliteTable(
  "food_library",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kcal: real("kcal").notNull(),
    protein: real("protein").notNull().default(0),
    carbs: real("carbs").notNull().default(0),
    fat: real("fat").notNull().default(0),
    grams: real("grams"),
    color: text("color", { enum: ["green", "yellow", "orange"] }),
    note: text("note"),
    uses: integer("uses").notNull().default(1),
    lastUsed: text("last_used"),
  },
  (t) => [uniqueIndex("library_user_name").on(t.userId, t.name)],
);

// One continuous coach thread per user. `content` holds Anthropic content blocks
// (text, tool_use, tool_result) so the history can be replayed to the model.
export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    kind: text("kind", { enum: ["chat", "checkin"] }).notNull().default("chat"),
    content: text("content", { mode: "json" }).$type<unknown[]>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("messages_user").on(t.userId, t.id)],
);

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: createdAt(),
});

// Which check-ins went out, so each slot fires once per day.
export const checkinsSent = sqliteTable(
  "checkins_sent",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    slot: text("slot").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("checkins_user_date_slot").on(t.userId, t.date, t.slot)],
);

export type User = typeof users.$inferSelect;
export type Profile = typeof profiles.$inferSelect;

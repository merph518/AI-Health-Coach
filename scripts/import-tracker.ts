// Imports a Cowork tracker-log.md into one user's tables, replacing that user's
// existing logs, profile and target history. Other users are untouched.
// Usage: npx tsx scripts/import-tracker.ts michael seed/michael/tracker-log.md
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";

const [username, file] = process.argv.slice(2);
if (!username || !file) {
  console.error("Usage: import-tracker.ts <username> <tracker-log.md>");
  process.exit(1);
}
const text = fs.readFileSync(file, "utf8");

function table(heading: string) {
  const m = text.match(new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`));
  if (!m) throw new Error(`Missing section: ${heading}`);
  return m[1]
    .split("\n")
    .filter((l) => l.startsWith("|"))
    .slice(2)
    .map((r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
}
const num = (s: string) => {
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const setting = (re: RegExp) => {
  const m = text.match(re);
  if (!m) throw new Error(`Setting not found: ${re}`);
  return m;
};

const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
if (!user) throw new Error(`No user "${username}". Run scripts/setup-users.ts first.`);
const userId = user.id;

const heightIn = num(setting(/Height: .*?\((\d+(?:\.\d+)?) in\)/)[1]);
const targetLine = setting(/Daily calorie target: ([\d,]+)(.*)/);
const baseKcal = num(targetLine[1]);
const basis = targetLine[0].replace(/^Daily calorie target: /, "");
const age = num(setting(/age (\d+)/)[1]);
// "\bmale" does not match inside "female" (the log also mentions a corrected female-formula error).
const sex = /\bmale formula\b/.test(basis) ? "male" : "female";
const eatBackPct = num(setting(/Activity eat-back: (\d+)%/)[1]) / 100;
const start = setting(/Starting weight: ([\d.]+) lb, first scale weigh-in on (\d{4}-\d{2}-\d{2})/);

const weightRows = table("Weight Log");
const activityRows = table("Activity Log");
const foodRows = table("Food Log");
const firstDate = [...foodRows, ...activityRows, ...weightRows].map((r) => r[0].slice(0, 10)).sort()[0];

db.transaction((tx) => {
  for (const t of [
    schema.foodEntries,
    schema.foodLibrary,
    schema.weights,
    schema.activity,
    schema.targetHistory,
    schema.profiles,
  ])
    tx.delete(t).where(eq(t.userId, userId)).run();

  tx.insert(schema.profiles)
    .values({
      userId,
      sex,
      age,
      ageAsOf: "2026-09-24",
      heightIn,
      activityFactor: 1.2,
      paceLbPerWeek: 1,
      eatBackPct,
      startWeightLb: num(start[1]),
      startDate: start[2],
      notes: "Imported from Cowork project \"Michael's Weight Loss Coach\" tracker-log.md",
    })
    .run();

  tx.insert(schema.targetHistory)
    .values({ userId, effectiveDate: firstDate, baseKcal, basis })
    .run();

  for (const [date, lb, measured, note] of weightRows)
    tx.insert(schema.weights)
      .values({ userId, date: date.slice(0, 10), lb: num(lb), measured: /yes/i.test(measured), note })
      .run();

  for (const [date, active, resting, steps, exercise, source] of activityRows)
    tx.insert(schema.activity)
      .values({
        userId,
        date: date.slice(0, 10),
        activeKcal: num(active),
        restingKcal: num(resting),
        steps: Math.round(num(steps)),
        exerciseMin: Math.round(num(exercise)),
        source,
        partial: /PARTIAL/.test(source),
      })
      .run();

  const library = new Map<string, typeof schema.foodLibrary.$inferInsert>();
  for (const [date, meal, item, qty, cal, p, c, f, note] of foodRows) {
    const d = date.slice(0, 10);
    const each = { kcal: num(cal), protein: num(p), carbs: num(c), fat: num(f) };
    tx.insert(schema.foodEntries)
      .values({ userId, date: d, meal, item, qty: num(qty), ...each, note })
      .run();
    const prev = library.get(item);
    library.set(item, { userId, name: item, ...each, note, uses: (prev?.uses ?? 0) + 1, lastUsed: d });
  }
  for (const row of library.values()) tx.insert(schema.foodLibrary).values(row).run();

  console.log(
    `${user.name}: ${weightRows.length} weights, ${activityRows.length} activity days, ` +
      `${foodRows.length} food entries, ${library.size} library foods; base ${baseKcal} kcal (${sex}, ${age}, ${heightIn} in)`,
  );
});

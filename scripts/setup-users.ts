// Creates the three household accounts if they don't exist yet, and keeps their Google emails current.
// Initial passwords go to data/initial-passwords.txt (mode 600), never to stdout.
// Usage: npx tsx scripts/setup-users.ts
import { hash } from "@node-rs/argon2";
import { randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../src/db";

const PEOPLE = [
  { username: "michael", name: "Michael", email: "merph2007@gmail.com", activityTracking: true, role: "admin", programMode: "classic" },
  { username: "leah", name: "Leah", email: "lmfagerstrom@gmail.com", activityTracking: false, role: "member", programMode: "noom" },
  { username: "eve", name: "Eve", email: "evlauner@gmail.com", activityTracking: false, role: "member", programMode: "noom" },
] as const;

const WORDS =
  "apple river stone maple cedar honey pepper lemon otter falcon harbor meadow sunny cobalt walnut ginger orbit tulip basil clover summit willow ember quartz".split(
    " ",
  );
const passphrase = () =>
  Array.from({ length: 4 }, () => WORDS[randomInt(WORDS.length)]).join("-") + "-" + randomInt(10, 100);

async function main() {
  const out: string[] = [];
  for (const p of PEOPLE) {
    const existing = db.select().from(schema.users).where(eq(schema.users.username, p.username)).get();
    if (existing) {
      if (existing.email !== p.email || existing.activityTracking !== p.activityTracking) {
        db.update(schema.users)
          .set({ email: p.email, activityTracking: p.activityTracking })
          .where(eq(schema.users.id, existing.id))
          .run();
        console.log(`${p.name}: updated (${p.email}, activity ${p.activityTracking ? "on" : "off"})`);
      } else console.log(`${p.name}: already exists, skipped`);
      continue;
    }
    const pw = passphrase();
    db.insert(schema.users)
      .values({ ...p, passwordHash: await hash(pw) })
      .run();
    out.push(`${p.username}\t${pw}`);
    console.log(`${p.name}: created`);
  }

  if (out.length) {
    const file = path.join(process.cwd(), "data", "initial-passwords.txt");
    fs.appendFileSync(file, out.join("\n") + "\n", { mode: 0o600 });
    fs.chmodSync(file, 0o600);
    console.log(`Initial passwords written to ${file}`);
  }
}

main();

import "server-only";
import { hash, verify } from "@node-rs/argon2";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";

export const SESSION_COOKIE = "session";
const SESSION_DAYS = 60;

const tokenId = (token: string) => createHash("sha256").update(token).digest("hex");

export const hashPassword = (pw: string) => hash(pw);
export const verifyPassword = (stored: string, pw: string) => verify(stored, pw);

export async function createSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5);
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date())).run();
  db.insert(schema.sessions).values({ id: tokenId(token), userId, expiresAt }).run();
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) db.delete(schema.sessions).where(eq(schema.sessions.id, tokenId(token))).run();
  store.delete(SESSION_COOKIE);
}

/** The signed-in user, or null. Cached per request. */
export const currentUser = cache(async () => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db
    .select({ user: schema.users, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, tokenId(token)))
    .get();
  if (!row || row.expiresAt < new Date()) return null;
  return row.user;
});

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

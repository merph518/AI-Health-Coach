"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import {
  createSession,
  destroySession,
  hashPassword,
  requireUser,
  verifyPassword,
} from "@/lib/auth";

export type FormState = { error?: string; ok?: string } | undefined;

// Simple in-memory throttle: 5 failed attempts per username per 15 minutes.
const failures = new Map<string, number[]>();
const WINDOW_MS = 15 * 60 * 1000;

export async function login(_: FormState, form: FormData): Promise<FormState> {
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const now = Date.now();
  const recent = (failures.get(username) ?? []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= 5) return { error: "Too many attempts. Try again in 15 minutes." };

  const user = db.select().from(schema.users).where(eq(schema.users.username, username)).get();
  if (!user || !(await verifyPassword(user.passwordHash, password))) {
    failures.set(username, [...recent, now]);
    return { error: "That name and password don't match." };
  }
  failures.delete(username);
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const current = String(form.get("current") ?? "");
  const next = String(form.get("next") ?? "");
  if (next.length < 10) return { error: "Use at least 10 characters." };
  if (!(await verifyPassword(user.passwordHash, current)))
    return { error: "Current password is wrong." };
  db.update(schema.users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(schema.users.id, user.id))
    .run();
  return { ok: "Password changed." };
}

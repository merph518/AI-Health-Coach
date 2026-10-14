import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { createSession } from "@/lib/auth";
import { finishAuth, googleConfig, OAUTH_COOKIE } from "@/lib/google";

const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function GET(request: NextRequest) {
  const cfg = googleConfig();
  if (!cfg) redirect("/login?error=google-off");

  const store = await cookies();
  const saved = store.get(OAUTH_COOKIE)?.value ?? "";
  store.delete({ name: OAUTH_COOKIE, path: "/auth/google" });
  const [state, verifier] = saved.split(".");
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  if (!state || !verifier || !code || !same(params.get("state") ?? "", state)) redirect("/login?error=google");

  const email = await finishAuth(cfg, code, verifier);
  if (!email) redirect("/login?error=google");

  // Only the three household accounts may sign in; unknown Google accounts are refused.
  const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (!user) redirect("/login?error=not-allowed");

  await createSession(user.id);
  redirect("/");
}

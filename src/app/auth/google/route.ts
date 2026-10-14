import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { googleConfig, OAUTH_COOKIE, startAuth } from "@/lib/google";

export async function GET() {
  const cfg = googleConfig();
  if (!cfg) redirect("/login?error=google-off");
  const { url, cookie } = startAuth(cfg);
  (await cookies()).set(OAUTH_COOKIE, cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth/google",
    maxAge: 600,
  });
  redirect(url.toString());
}

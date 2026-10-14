import { timingSafeEqual } from "node:crypto";
import { runDueCheckins } from "@/lib/checkins";

// Called every minute by the in-process timer (src/instrumentation.ts), or by system
// cron with the same JOBS_SECRET. Not reachable without the secret.
export async function POST(request: Request) {
  const secret = process.env.JOBS_SECRET ?? "";
  const given = request.headers.get("x-jobs-secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret)))
    return new Response(null, { status: 404 });
  const sent = await runDueCheckins();
  return Response.json({ sent });
}

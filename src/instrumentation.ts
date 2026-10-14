// Starts the once-a-minute check-in timer when the Node server boots. The timer calls
// the jobs route over loopback, so the job runs with the app's normal server code.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || process.env.DISABLE_JOBS === "1") return;
  const g = globalThis as { __checkinTimer?: ReturnType<typeof setInterval> };
  if (g.__checkinTimer) return;

  process.env.JOBS_SECRET ||= Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const url = `http://127.0.0.1:${process.env.PORT ?? 3000}/api/jobs/checkins`;

  const tick = async () => {
    try {
      const res = await fetch(url, { method: "POST", headers: { "x-jobs-secret": process.env.JOBS_SECRET! } });
      if (res.ok) {
        const { sent } = (await res.json()) as { sent: string[] };
        if (sent.length) console.log(`check-ins sent: ${sent.join(", ")}`);
      }
    } catch {
      // Server not listening yet; try again next minute.
    }
  };
  g.__checkinTimer = setInterval(tick, 60_000);
  setTimeout(tick, 5_000);
}

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getDays, todayIn } from "@/lib/data";
import AppNav from "./AppNav";
import Dashboard from "./Dashboard";

export default async function Home() {
  const user = await requireUser();
  const today = todayIn(user.timezone);
  const { days, base, eatBack, profile } = getDays(user.id, today, user.activityTracking);
  const hasData = days.some((d) => d.items.length || d.weight != null);

  return (
    <main className="shell">
      <AppNav name={user.name} />
      <p className="muted" style={{ fontSize: 13, marginTop: -8, marginBottom: 12 }}>
        {new Date(today + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
      </p>

      {hasData ? (
        <Dashboard
          days={days}
          today={today}
          base={base}
          eatBackPct={user.activityTracking ? eatBack : null}
          startWeight={profile?.startWeightLb ?? null}
          startDate={profile?.startDate ?? null}
        />
      ) : (
        <section className="card" style={{ display: "grid", gap: 8 }}>
          <h2 style={{ fontSize: 18 }}>Welcome, {user.name}</h2>
          <p className="muted">
            Your Noom-style program is on its way. Setup (your goal, your &ldquo;why&rdquo;, and a
            calorie zone) arrives in a later update. You can already tell the{" "}
            <Link href="/coach">Coach</Link> what you ate or what you weigh, and it will show up here.
          </p>
        </section>
      )}
    </main>
  );
}

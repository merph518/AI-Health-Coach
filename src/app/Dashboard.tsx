"use client";

import { useState } from "react";
import type { Day } from "@/lib/data";
import { CaloriesChart, WeightChart } from "./charts";
import styles from "./dashboard.module.css";

const TABS = ["Today", "Weight", "Calories", "Food history"] as const;
type Tab = (typeof TABS)[number];

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const dt = (iso: string) => new Date(iso + "T12:00:00");
const dShort = (iso: string) =>
  dt(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
const clean = (s: string) => s.replace(/\s*\([^)]*\)/g, "").trim();

type Props = {
  days: Day[];
  today: string;
  /** null until the user has a calorie target (Noom-style setup). */
  base: number | null;
  /** null when the user has no activity feed: the target is just the base. */
  eatBackPct: number | null;
  startWeight: number | null;
  startDate: string | null;
};

export default function Dashboard(props: Props) {
  const [tab, setTab] = useState<Tab>("Today");

  return (
    <>
      <nav className={styles.tabs} role="tablist" aria-label="Views">
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className={styles.tab}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </nav>
      <div role="tabpanel">
        {tab === "Today" && <TodayView {...props} />}
        {tab === "Weight" && <WeightView {...props} />}
        {tab === "Calories" && <CaloriesView {...props} />}
        {tab === "Food history" && <HistoryView {...props} />}
      </div>
    </>
  );
}

function FoodList({ day }: { day: Day }) {
  if (!day.items.length) return <p className="muted">Nothing logged yet for {dShort(day.date)}.</p>;
  const meals: { name: string; items: Day["items"] }[] = [];
  for (const i of day.items) {
    const m = meals.find((x) => x.name === i.meal);
    if (m) m.items.push(i);
    else meals.push({ name: i.meal, items: [i] });
  }
  return (
    <div className={styles.meals}>
      {meals.map((m) => (
        <div key={m.name}>
          <div className={styles.mealHead}>
            <span>{m.name}</span>
            <span className="num muted">{fmt(m.items.reduce((s, i) => s + i.cal, 0))} cal</span>
          </div>
          <ul className={styles.items}>
            {m.items.map((i) => (
              <li key={i.id} title={i.note ?? undefined}>
                <span>
                  {i.qty !== 1 && <span className="muted num">{+i.qty.toFixed(2)} × </span>}
                  {clean(i.item)}
                </span>
                <span className="num">{fmt(i.cal)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Macros({ day }: { day: Day }) {
  return (
    <div className={styles.macros}>
      {(
        [
          ["Protein", day.p],
          ["Carbs", day.c],
          ["Fat", day.f],
        ] as const
      ).map(([k, v]) => (
        <div key={k}>
          <span className="muted">{k}</span>
          <strong className="num">{fmt(v)} g</strong>
        </div>
      ))}
    </div>
  );
}

function TodayView({ days, today, base, eatBackPct }: Props) {
  const d = days.find((x) => x.date === today)!;
  if (base == null)
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <section className="card">
          <div className={styles.hero}>
            <div>
              <span className="muted">Eaten</span>
              <strong className="num">{fmt(d.cal)}</strong>
            </div>
            {d.weight != null && (
              <div>
                <span className="muted">Weight</span>
                <strong className="num">{d.weight}</strong>
              </div>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <Macros day={d} />
          </div>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Your calorie zone arrives with setup. Until then, keep logging with the coach.
          </p>
        </section>
        <section className="card">
          <h2 className={styles.h2}>Food today</h2>
          <FoodList day={d} />
        </section>
      </div>
    );
  const target = d.target ?? base;
  const left = target - d.cal;
  const pct = Math.min(100, (d.cal / target) * 100);
  const yesterday = [...days].reverse().find((x) => x.date < today && x.active != null);
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="card">
        <div className={styles.hero}>
          <div>
            <span className="muted">Eaten</span>
            <strong className="num">{fmt(d.cal)}</strong>
          </div>
          <div>
            <span className="muted">Target</span>
            <strong className="num">{fmt(target)}</strong>
          </div>
          <div>
            <span className="muted">{left >= 0 ? "Left" : "Over"}</span>
            <strong className="num" style={{ color: left >= 0 ? "var(--good)" : "var(--danger)" }}>
              {fmt(Math.abs(left))}
            </strong>
          </div>
        </div>
        <div
          className={styles.bar}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={target}
          aria-valuenow={d.cal}
          aria-label="Calories eaten against target"
        >
          <div style={{ width: `${pct}%`, background: left >= 0 ? "var(--accent)" : "var(--danger)" }} />
        </div>
        <Macros day={d} />
        <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
          {eatBackPct == null ? (
            <>Daily target: {fmt(base)}.</>
          ) : d.active != null ? (
            <>
              Target = {fmt(base)} base + {fmt((d.active * eatBackPct))} eat-back ({Math.round(eatBackPct * 100)}% of{" "}
              {fmt(d.active)} active cal{d.partial ? ", partial day" : ""}).
            </>
          ) : (
            <>
              Target = {fmt(base)} base. Today&rsquo;s Apple Watch calories add {Math.round(eatBackPct * 100)}% once
              they arrive.
            </>
          )}
          {d.weight != null && <> Weighed in at {d.weight} lb.</>}
        </p>
      </section>
      <section className="card">
        <h2 className={styles.h2}>Food today</h2>
        <FoodList day={d} />
      </section>
      {yesterday && (
        <p className="muted" style={{ fontSize: 13 }}>
          Last activity day ({dShort(yesterday.date)}): {fmt(yesterday.active ?? 0)} active cal,{" "}
          {fmt(yesterday.steps ?? 0)} steps{yesterday.partial ? " (partial)" : ""}.
        </p>
      )}
    </div>
  );
}

function WeightView({ days, startWeight, startDate }: Props) {
  const pts = days.filter((d) => d.weight != null).map((d) => ({ date: d.date, w: d.weight! }));
  if (!pts.length) return <p className="card muted">No weigh-ins yet.</p>;
  const start = startWeight ?? pts[0].w;
  const last = pts[pts.length - 1];
  const low = pts.reduce((a, b) => (b.w < a.w ? b : a));
  const chg = last.w - start;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="card">
        <div className={styles.hero}>
          <div>
            <span className="muted">Latest</span>
            <strong className="num">{last.w}</strong>
            <small className="muted">{dShort(last.date)}</small>
          </div>
          <div>
            <span className="muted">{chg <= 0 ? "Down" : "Up"}</span>
            <strong className="num" style={{ color: chg <= 0 ? "var(--good)" : "var(--warn)" }}>
              {Math.abs(chg).toFixed(1)}
            </strong>
            <small className="muted">since {startDate ? dShort(startDate) : "start"}</small>
          </div>
          <div>
            <span className="muted">Lowest</span>
            <strong className="num">{low.w}</strong>
            <small className="muted">{dShort(low.date)}</small>
          </div>
        </div>
      </section>
      <section className="card">
        <h2 className={styles.h2}>Morning weight (lb)</h2>
        <WeightChart points={pts} start={start} />
        <details className={styles.table}>
          <summary>Show as table</summary>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Weight</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {[...pts].reverse().map((p) => (
                <tr key={p.date}>
                  <td>{dShort(p.date)}</td>
                  <td className="num">{p.w}</td>
                  <td className="num">{(p.w - start).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </div>
  );
}

function CaloriesView({ days, today, base, eatBackPct }: Props) {
  if (base == null) return <p className="card muted">Calorie targets start after setup.</p>;
  const logged = days.filter((d) => d.items.length && d.target != null);
  const done = logged.filter((d) => d.date < today);
  const last7 = done.slice(-7);
  const avg = last7.length ? last7.reduce((s, d) => s + d.cal, 0) / last7.length : 0;
  const avgT = last7.length ? last7.reduce((s, d) => s + d.target!, 0) / last7.length : 0;
  const under = done.filter((d) => d.cal <= d.target!).length;
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <section className="card">
        <div className={styles.hero}>
          <div>
            <span className="muted">7-day avg</span>
            <strong className="num">{fmt(avg)}</strong>
            <small className="muted">vs {fmt(avgT)} target</small>
          </div>
          <div>
            <span className="muted">At or under</span>
            <strong className="num">
              {under}/{done.length}
            </strong>
            <small className="muted">full days</small>
          </div>
        </div>
      </section>
      <section className="card">
        <h2 className={styles.h2}>Calories eaten vs. daily target</h2>
        <p className="muted" style={{ fontSize: 13, marginBottom: 8 }}>
          Bars are calories eaten; the dark tick is that day&rsquo;s target ({fmt(base)}
          {eatBackPct != null && <> + {Math.round(eatBackPct * 100)}% of Apple Watch active calories</>}).
        </p>
        <CaloriesChart
          days={days
            .filter((d) => d.target != null && (d.items.length || d.date === today))
            .map((d) => ({ date: d.date, cal: d.cal, target: d.target!, today: d.date === today }))}
        />
        <details className={styles.table}>
          <summary>Show as table</summary>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Eaten</th>
                <th>Target</th>
                <th>Diff</th>
              </tr>
            </thead>
            <tbody>
              {[...logged].reverse().map((d) => (
                <tr key={d.date}>
                  <td>{dShort(d.date)}</td>
                  <td className="num">{fmt(d.cal)}</td>
                  <td className="num">{fmt(d.target!)}</td>
                  <td className="num">{d.cal - d.target! > 0 ? "+" : ""}{fmt(d.cal - d.target!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </div>
  );
}

function HistoryView({ days, today }: Props) {
  const list = days.filter((d) => d.items.length).reverse();
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {list.map((d) => (
        <details key={d.date} className={`card ${styles.day}`} open={d.date === list[0]?.date}>
          <summary>
            <span>
              {dShort(d.date)}
              {d.date === today && <span className="muted"> · today</span>}
            </span>
            <span className="num">
              {fmt(d.cal)}
              {d.target != null && <span className="muted"> / {fmt(d.target)}</span>}
            </span>
          </summary>
          <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
            <Macros day={d} />
            <FoodList day={d} />
          </div>
        </details>
      ))}
    </div>
  );
}

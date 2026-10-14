"use client";

import { useState } from "react";
import styles from "./dashboard.module.css";

// Plain SVG charts on a fixed viewBox that scales to the card width.
// Single series each, so no legend: the card title names the series.

const W = 640;
const H = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 44 };
const IW = W - PAD.left - PAD.right;
const IH = H - PAD.top - PAD.bottom;

const day = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", opts);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

function niceTicks(lo: number, hi: number, count = 4) {
  const span = hi - lo || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step / 2; v += step) ticks.push(+v.toFixed(6));
  return ticks;
}

/** Show at most ~6 date labels along the x axis. */
const labelEvery = (n: number) => Math.max(1, Math.ceil(n / 6));

type Tip = { x: number; y: number; title: string; lines: string[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  const left = (tip.x / W) * 100;
  return (
    <div
      className={styles.tip}
      style={{
        left: `${left}%`,
        top: `${(tip.y / H) * 100}%`,
        transform: `translate(${left > 70 ? "-100%" : left < 30 ? "0" : "-50%"}, calc(-100% - 10px))`,
      }}
      role="status"
    >
      <strong>{tip.title}</strong>
      {tip.lines.map((l) => (
        <span key={l}>{l}</span>
      ))}
    </div>
  );
}

function YGrid({ ticks, y, unit }: { ticks: number[]; y: (v: number) => number; unit?: string }) {
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className={styles.grid} />
          <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className={styles.axis}>
            {fmt(t)}
            {unit}
          </text>
        </g>
      ))}
    </g>
  );
}

export function WeightChart({ points, start }: { points: { date: string; w: number }[]; start: number }) {
  const [tip, setTip] = useState<Tip>(null);
  const t0 = new Date(points[0].date).getTime();
  const t1 = new Date(points[points.length - 1].date).getTime();
  const vals = [...points.map((p) => p.w), start];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const pad = Math.max(1, (hi - lo) * 0.12);
  const ticks = niceTicks(lo - pad, hi + pad);
  const yMin = ticks[0];
  const yMax = ticks[ticks.length - 1];
  const x = (iso: string) =>
    PAD.left + (t1 === t0 ? IW / 2 : ((new Date(iso).getTime() - t0) / (t1 - t0)) * IW);
  const y = (v: number) => PAD.top + (1 - (v - yMin) / (yMax - yMin)) * IH;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(p.date).toFixed(1)},${y(p.w).toFixed(1)}`).join("");
  const every = labelEvery(points.length);

  return (
    <div className={styles.chart} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Morning weight over time">
        <YGrid ticks={ticks} y={y} />
        <line x1={PAD.left} x2={W - PAD.right} y1={y(start)} y2={y(start)} className={styles.ref} />
        <text x={W - PAD.right} y={y(start) - 6} textAnchor="end" className={styles.axis}>
          start {start}
        </text>
        <path d={path} className={styles.line} />
        {points.map((p, i) => (
          <g key={p.date}>
            <circle cx={x(p.date)} cy={y(p.w)} r={4} className={styles.dot} />
            {i % every === 0 && (
              <text x={x(p.date)} y={H - 8} textAnchor="middle" className={styles.axis}>
                {day(p.date, { month: "short", day: "numeric" })}
              </text>
            )}
            <rect
              x={x(p.date) - 12}
              y={PAD.top}
              width={24}
              height={IH}
              fill="transparent"
              onMouseEnter={() =>
                setTip({
                  x: x(p.date),
                  y: y(p.w),
                  title: day(p.date, { weekday: "short", month: "short", day: "numeric" }),
                  lines: [`${p.w} lb`, `${(p.w - start).toFixed(1)} vs start`],
                })
              }
              onClick={() =>
                setTip({
                  x: x(p.date),
                  y: y(p.w),
                  title: day(p.date, { weekday: "short", month: "short", day: "numeric" }),
                  lines: [`${p.w} lb`, `${(p.w - start).toFixed(1)} vs start`],
                })
              }
            />
          </g>
        ))}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

export function CaloriesChart({
  days,
}: {
  days: { date: string; cal: number; target: number; today: boolean }[];
}) {
  const [tip, setTip] = useState<Tip>(null);
  if (!days.length) return null;
  const hi = Math.max(...days.map((d) => Math.max(d.cal, d.target)));
  const ticks = niceTicks(0, hi * 1.05);
  const yMax = ticks[ticks.length - 1];
  const y = (v: number) => PAD.top + (1 - v / yMax) * IH;
  const slot = IW / days.length;
  const bw = Math.max(4, Math.min(28, slot - 2));
  const every = labelEvery(days.length);

  return (
    <div className={styles.chart} onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Calories eaten each day against that day's target">
        <YGrid ticks={ticks} y={y} />
        {days.map((d, i) => {
          const cx = PAD.left + slot * (i + 0.5);
          const top = y(d.cal);
          const h = PAD.top + IH - top;
          const r = Math.min(4, bw / 2, h);
          const show = () =>
            setTip({
              x: cx,
              y: Math.min(top, y(d.target)),
              title: day(d.date, { weekday: "short", month: "short", day: "numeric" }) + (d.today ? " (so far)" : ""),
              lines: [
                `${fmt(d.cal)} eaten`,
                `${fmt(d.target)} target`,
                `${d.cal > d.target ? "+" : "−"}${fmt(Math.abs(d.cal - d.target))} ${d.cal > d.target ? "over" : "under"}`,
              ],
            });
          return (
            <g key={d.date}>
              {h > 0 && (
                <path
                  d={`M${cx - bw / 2},${PAD.top + IH}V${top + r}a${r},${r} 0 0 1 ${r},${-r}H${cx + bw / 2 - r}a${r},${r} 0 0 1 ${r},${r}V${PAD.top + IH}Z`}
                  className={d.today ? styles.barToday : styles.barFill}
                />
              )}
              <line
                x1={cx - bw / 2 - 2}
                x2={cx + bw / 2 + 2}
                y1={y(d.target)}
                y2={y(d.target)}
                className={styles.tick}
              />
              {i % every === 0 && (
                <text x={cx} y={H - 8} textAnchor="middle" className={styles.axis}>
                  {day(d.date, { month: "short", day: "numeric" })}
                </text>
              )}
              <rect
                x={cx - slot / 2}
                y={PAD.top}
                width={slot}
                height={IH}
                fill="transparent"
                onMouseEnter={show}
                onClick={show}
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </div>
  );
}

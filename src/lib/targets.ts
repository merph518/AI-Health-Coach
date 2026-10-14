// Calorie target math. Pure functions, shared by server code and scripts.

export const LB_PER_KG = 2.2046226218;
export const CM_PER_IN = 2.54;
export const KCAL_PER_LB = 3500;
export const FLOOR_KCAL = { male: 1500, female: 1320 } as const;

export type Sex = "male" | "female";

/** Mifflin-St Jeor resting metabolic rate. */
export function bmr(sex: Sex, weightLb: number, heightIn: number, age: number) {
  const base = 10 * (weightLb / LB_PER_KG) + 6.25 * heightIn * CM_PER_IN - 5 * age;
  return base + (sex === "male" ? 5 : -161);
}

export function maintenance(
  sex: Sex,
  weightLb: number,
  heightIn: number,
  age: number,
  activityFactor = 1.2,
) {
  return bmr(sex, weightLb, heightIn, age) * activityFactor;
}

/**
 * Daily target for a weekly loss pace, held at or above the floor.
 * Pace is capped at 1% of body weight per week.
 */
export function dailyTarget(opts: {
  sex: Sex;
  weightLb: number;
  heightIn: number;
  age: number;
  activityFactor?: number;
  paceLbPerWeek: number;
}) {
  const { sex, weightLb, heightIn, age, activityFactor = 1.2 } = opts;
  const pace = Math.min(opts.paceLbPerWeek, weightLb * 0.01);
  const tdee = maintenance(sex, weightLb, heightIn, age, activityFactor);
  const raw = tdee - (pace * KCAL_PER_LB) / 7;
  const floor = FLOOR_KCAL[sex];
  return {
    tdee: Math.round(tdee),
    target: Math.round(Math.max(raw, floor)),
    pace,
    floored: raw < floor,
  };
}

/** Noom-style zone: a range around the target instead of a single number. */
export function zone(target: number, sex: Sex, bmrKcal: number) {
  const floor = Math.max(FLOOR_KCAL[sex], Math.round(bmrKcal));
  return { low: Math.max(target - 150, floor), high: target + 150 };
}

export function ageOn(
  date: string,
  p: { birthdate: string | null; age: number | null; ageAsOf: string | null },
) {
  const d = new Date(date + "T12:00:00Z");
  if (p.birthdate) {
    const b = new Date(p.birthdate + "T12:00:00Z");
    let a = d.getUTCFullYear() - b.getUTCFullYear();
    if (
      d.getUTCMonth() < b.getUTCMonth() ||
      (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate())
    )
      a--;
    return a;
  }
  if (p.age != null && p.ageAsOf) {
    const years = (d.getTime() - new Date(p.ageAsOf + "T12:00:00Z").getTime()) / (365.25 * 864e5);
    return p.age + Math.floor(Math.max(0, years));
  }
  return p.age;
}

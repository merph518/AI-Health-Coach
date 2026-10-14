# Fagerteam Weight Loss Coach (Claude artifact)

Live page: https://claude.ai/artifact/HsXvPzyvfoNbwfW9s5TF7y

`coach.html` is the whole app: one page published as a Claude artifact. It runs on the
viewer's own Claude plan (no API key): the coach uses the `sample` capability with page
functions as tools, and the log lives in the artifact's `db`. Leah and Eve use their own
free Claude accounts, invited from the Share menu as Editors (no public link).

Capabilities: `{ db: {}, sample: { images: true }, user: {} }`

## Data layout (artifact db)

- `people/{michael|leah|eve}`: profile (name, mode noom|classic, activity, eatBackPct,
  timezone, sex, age, ageAsOf, heightIn, startWeight, startDate, goalWeight, pace,
  bigPicture, coachTier, targets: [{from, kcal, basis}])
- `people/{pid}/days/{YYYY-MM-DD}`: items [{id, meal, item, qty, kcal, p, c, f, grams?,
  color?, note?}] (nutrition per unit), weight, active, steps, partial
- `people/{pid}/meta/library`: foods [{name, kcal, p, c, f, grams?, color?, note?, uses, last}]
- `people/{pid}/chat/{YYYY-MM-DD}`: messages [{role, text, at, kind?, tools?, photo?, error?}],
  checkins [slot times already shown]

Michael's history was seeded once from `data/app.db` (the Next.js app's import of the
Cowork tracker log). The page never contains seed data.

## Updating

Edit `coach.html`, then ask Claude Code to publish it to the URL above (Artifact publish
with `url`, so the link and data stay the same).

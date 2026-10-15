# Fagerteam Weight Loss Coach (Claude artifact)

Live page: https://claude.ai/artifact/HsXvPzyvfoNbwfW9s5TF7y

`coach.html` is the whole app: one page published as a Claude artifact. It runs on the
viewer's own Claude plan (no API key): the coach uses the `sample` capability with page
functions as tools, and the log lives in the artifact's `db`. Leah and Eve use their own
free Claude accounts, invited from the Share menu as Contributors (can use the page and
write the log, but not edit the page). Only Michael is an Editor.

Capabilities: `{ db: {}, sample: { images: true }, user: {}, mcp: { servers: [{ server:
"Gmail", tools: ["search_threads", "get_message", "trash_message"] }] } }`. Never add
`artifact` (or `self`): without it the page, and so the in-app coach, cannot republish
itself. The coach's tools only read and write the log (including removing chat messages),
send feedback, and, for Michael, import Apple Health from Gmail; app changes go through the
Feedback tab or the coach's `send_feedback` tool.

## Data layout (artifact db)

- `people/{michael|leah|eve}`: profile (name, mode noom|classic, activity, eatBackPct,
  timezone, sex, birthDate (YYYY-MM-DD; age is computed from it, and the coach wishes them a
  happy birthday on the day), age and ageAsOf (older profiles without a birth date), heightIn, startWeight, startDate, goalWeight, pace,
  bigPicture, coachTier, coachStyle brief|balanced|detailed, coachTone warm|direct|upbeat|calm|coach,
  activityLevel sedentary|light|moderate|very (maintenance multiplier 1.2/1.375/1.55/1.725),
  stepGoal (Activity tab; default 6000, step task shows only when activity tracking is on),
  waterUnit glass|s16|m24|l32 (8/16/24/32 oz) and waterGoal (count a day; default about 64 oz),
  theme light|dark|system and photos (Appearance; default light with photos),
  font default|system|rounded|readable|serif and textSize s|m|l|xl (Appearance; extra fonts load from Google Fonts only when picked),
  accent and bg (#rrggbb, optional) and bgImage (JPEG data URL, longest side 1280px; Appearance),
  avatar (optional photo from Appearance: a 192px JPEG data URL, shown on their chat messages and the
  person switcher), coachAvatar (Your coach: a preset sprout|owl|bear|fox|panda|turtle|cat|dog|bunny|robot|runner|star,
  or a photo data URL; default sprout),
  coachNotes (custom instructions), onboarded (date the welcome setup deck was finished; until then
  Leah and Eve see a "Let's get you set up" card on the Coach tab, unless they closed it: onboardDismissed date), targets: [{from, kcal, basis}];
  if weight was skipped in setup, the first weigh-in sets startWeight and an automatic target). For Leah and Eve the
  prompt always adds a positive, celebrate-the-small-wins baseline under their chosen tone.
- `people/{pid}/days/{YYYY-MM-DD}`: items [{id, meal, item, qty, kcal, p, c, f, grams?,
  color? green|yellow|orange, note?}] (nutrition per unit), weight, water (count of that day's waterUnit, default glass),
  active, steps, partial, meds (time the "Take morning meds" checklist task was ticked; hidden for anyone
  whose profile has hideMeds, set from Settings → Program)
  and worklist (Leah only, Monday to Friday: time "Submit your daily list for work" was ticked)
- `people/{pid}/meta/library`: foods [{name, kcal, p, c, f, grams?, color?, note?, uses, last}]
  A food with `recipe: {id, servings, items: [{item, qty, kcal, p, c, f}], at}` is a saved recipe (Today → Daily Log →
  My recipes, or the coach's `save_recipe` tool); its kcal/p/c/f are per serving, logging never overwrites them, and
  recipes are never trimmed from the 600-food cap.
- `people/{pid}/meta/program` (Noom-style only): track standard|custom, start {trackKey: date},
  done {lessonKey: {date, at, quiz, reflection}}, progress {lessonKey: {i, n, answers, reflection, at}}
  (where an unfinished lesson was closed; also kept per device in localStorage `sp.lp.<pid>.<lessonKey>`), goals {"trackKey:wN": {text, at}}, custom {id, name,
  goals, weeks, plan: [{theme, focus, lessons?: [{title, key}]}]}. trackKey is `s` (the built-in
  16-week curriculum in the page) or `c-<id>`; lessonKey is `<trackKey>-<n>`. A custom program's
  outline is drafted by Claude from the person's goals, and each week's lessons when they reach it.
- `people/{pid}/lessons/{lessonKey}`: a lesson Claude wrote once, as tap-through screens
  {v: 2, title, at, screens: [{type text|quiz|truefalse|poll|reveal|scale|reflect, art (emoji), ...}]}.
  The page writes the day's next lesson in the background when it opens (only if Claude access
  is already granted), so it's ready before anyone taps it. Older lessons without `v: 2` are rewritten.
  The done record in the program doc also keeps {answers, quiz (correct count)}.

Stock photos are Unsplash-license images published next to the page as `photos/*.webp` (source
in `artifact/photos/`); publish them with the Artifact `files` parameter.
- `feedback/{date}-{pid}-{id}`: {pid, name, kind bug|idea|other, text, at, date, device, status new|filed|done,
  issue?, issueUrl?, photos? (count)}; up to 3 photos at `feedback/{id}/photos/{0..2}` as {pid, url (JPEG data URL,
  longest side 1280px), at}, written before the entry. See FILE_FEEDBACK.md for filing them as GitHub issues.
- `accounts/{claude user id}`: {pid, owner, first, at, seen {pid: last date}}. Written when someone opens a person.
  Only the artifact owner (Michael) gets the person switcher; any other account is tied to the person it first
  picks (never Michael) and opens straight to them. To re-link an account, delete its doc. This is an app-level
  lock, not a db access rule.
- `people/{pid}/chat/{YYYY-MM-DD}`: messages [{role, text, at, kind?, tools?, photo?, error?}],
  checkins [slot times already shown]

Michael's history was seeded once from `data/app.db` (the Next.js app's import of the
Cowork tracker log). The page never contains seed data.

## Updating

Edit `coach.html`, then ask Claude Code to publish it to the URL above (Artifact publish
with `url`, so the link and data stay the same).

## Apple Health (Michael only)

Health Auto Export on Michael's iPhone emails a daily CSV to Gmail (from
automate@mailer.healthyapps.dev). The Claude Code scheduled task
`import-michael-health-email` (every 2 hours, 8am to 10pm, while the Claude app is open)
decodes it with `scripts/hae_decode.py`, writes active calories, exercise minutes, steps and
any missing weigh-in to `people/michael/days/{date}`, then trashes the email. Michael can
also ask the coach to import it: the `import_health_data` tool does the same through his own
Gmail connector (the page asks for Gmail access on first use). The tool only exists for
Michael; Leah and Eve don't use Apple devices and are never touched.

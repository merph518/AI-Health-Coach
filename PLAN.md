# Fagerteam Health Coach: Plan

A family weight-loss coach for Michael, Leah and Eve, built on the Cowork project "Michael's Weight Loss Coach" (Scale & Plate). Leah and Eve get a Noom-style program by default. Michael keeps his current approach and gets a toggle to switch to the Noom-style one.

## 1. What exists today (Cowork project)

| Piece | How it works now |
|---|---|
| Source of truth | `tracker-log.md` in the project: Settings plus Weight Log (19 rows, 353.4 → 341.8 lb since 2026-09-25), Activity Log (21 days), Food Log (221 items, with calories, protein, carbs, fat and an estimation note per item) |
| Target | Mifflin-St Jeor (male, 46, 68 in, 350 lb) × 1.2 − 500 = **2,430 kcal**. 50% of Apple Watch Active Energy is added back each day. Recalculate every ~20 lb lost |
| Check-ins | Scheduled task runs 07:53, 11:53 and 17:53 daily (43 runs so far). Morning asks for weight and breakfast, midday for lunch, evening for dinner. Ends with a summary and one tip |
| Food estimates | Label or brand data first, then USDA components. Reuses the same basis for foods logged before. Photos are used for portion size. Assumptions are stated |
| Apple Health | Health Auto Export emails a CSV to Gmail. `decode_hae.py` parses it, then the email is trashed |
| Dashboard | `make_page.py` + `coach_template.html` rebuild the "Scale & Plate" artifact after every log. Tabs: Today, Weight, Calories, Food history |
| Extras | `build_tracker.py` (xlsx on request), `make_chart.py` (PNG, retired), a ChatGPT version of the prompts written for a female user |
| Tone | Warm, practical, honest. No scolding. No em dashes |

Weak points the new app should fix:
- The whole log is rewritten as markdown on every update.
- Apple Health data goes through Gmail.
- Updates are only as fresh as the last check-in.
- There is one user.
- Parallel sessions have needed manual merges (10/9).

## 2. Web app or artifact: recommendation is the **web app**

| | Artifact (`sample` + `db` + `user`) | Web app + Claude API key |
|---|---|---|
| Hosting and auth | Free; claude.ai handles both | You host it; auth is yours |
| Who pays for AI | Each viewer's own claude.ai plan. Leah and Eve each need a Claude account and an invite to your org | One API key, billed per token |
| Scheduled check-ins | None. A page can't wake itself up or send notifications | Cron per user timezone plus Web Push (works on iPhone for a home-screen PWA, iOS 16.4+) |
| Apple Health | No inbound endpoint; would still need the Gmail route through Cowork | Health Auto Export "REST API" automation POSTs JSON straight to the app, per user |
| Model control | A model tier, memoryless calls, rate limits you don't set | Pick a model per task, prompt caching, tool use, vision |
| Data | `db` docs (fine for 3 people) | SQLite/Postgres you own, export anytime |

The check-ins and the Apple Health feed are the core of what works today, and an artifact can do neither. A web app also removes the Claude-account requirement for Leah and Eve.

**Fallback:** if you'd rather not host anything, a `db` + `user` + `sample` artifact can cover logging, the dashboard and chat. Check-ins would stay as Cowork scheduled tasks, one per person, writing into the artifact's db.

## 3. Architecture

- **Stack:** Next.js (App Router, TypeScript) as an installable PWA, with SQLite via Drizzle. One container behind Caddy on a home server or a small VPS. SQLite is plenty for 3 users, and backups are just copying a file.
- **AI:** Anthropic TypeScript SDK.
  - `claude-sonnet-5-5` for coach chat, food estimation and photo logging.
  - `claude-haiku-5-5` for cheap jobs: color classification and nudge text.
  - `claude-opus-5-5` for the weekly review summary, if quality warrants it.
  - The system prompt plus the user's profile and recent context are prompt-cached.
- **Coach as an agent with tools:** the model does not edit a log file. It calls typed tools, and the server writes rows, which fixes the merge problem. Tools:
  - `log_food(items[])`, `log_weight`, `log_activity`
  - `lookup_food_history(query)` (to reuse the same basis)
  - `get_day_summary(date)`, `get_trend(range)`
  - Noom mode only: `set_weekly_goal`, `complete_lesson`, `classify_color`
- **Auth:** passkeys with an email magic-link fallback (better-auth or Auth.js). Exactly one household and three accounts. Michael is the admin.
- **Multi-tenancy:**
  - Every row carries `user_id`, enforced in a single data-access layer.
  - There are no cross-user queries except the opt-in family feed.
  - The AI context is built from one user's data only.
  - Each user has their own Health Auto Export ingest token.
- **Jobs:** an in-process scheduler (node-cron) or system cron hitting `/api/jobs/*`. It runs check-ins, nightly activity finalization, and the weekly review.

## 4. Two program modes (per-user `program_mode`)

| | `classic` (Michael today) | `noom` (Leah, Eve; toggle for Michael) |
|---|---|---|
| Budget | Mifflin-St Jeor × activity − 500, a single number | A **zone** of target ± 150. Pace 0.5 to 2 lb/wk, capped at 1% of body weight per week |
| Recalc | Every 20 lb | Every 5 lb |
| Eat-back | 50% of active energy | 50% of active energy (same as Noom) |
| Floor | None today; add 1,500 M / 1,320 F | 1,500 M / 1,320 F, and never below BMR |
| Food view | Calories + macros | Calories + **color** (green/yellow/orange by calorie density) + macros secondary. Shows a daily color mix against a 30/45/25 guide |
| Check-ins | 3 per day, by meal | Light: a nudge only if a meal is unlogged, plus a **weekly Sunday review** where the user proposes a goal and the coach makes it SMART |
| Lessons | None | 16-week curriculum, 1–3 five-minute cards per day, released daily, each with a 1-question quiz and a reflection prompt |
| Weight | Raw daily points | Raw points + EWMA trend (α≈0.1). The trend is the headline number. Plateau note after 2 flat weeks |
| Coach style | Practical, numbers-first | Motivational interviewing: open questions, affirmations, reflections, summaries. Ties everything to the user's "Big Picture" why. Slips are treated as data |
| Onboarding | Seeded | Intake (stats, pace, "why", health flags, eating-disorder screen) → projection curve |

Notes:
- Budget formula: both modes use Mifflin-St Jeor. Noom uses Harris-Benedict, but Mifflin is the more accurate one and is already your baseline.
- Toggling Michael between modes changes only display and coaching. The underlying logs are identical, so he can switch back and forth.

**Color rules** (calorie density in kcal/g; kcal/mL for drinks):

| Category | Green | Yellow | Orange |
|---|---|---|---|
| Solids | < 1.0 | 1.0–2.4 | > 2.4 |
| Soups, sauces, spreads | < 0.5 | 0.5–1.0 | > 1.0 |
| Drinks | < 0.4 | 0.4–0.5 | > 0.5 |

Overrides:
- Whole grains move one step greener.
- Dairy goes by fat level.
- Zero-calorie sweetened drinks are yellow.
- Alcohol and sugary drinks move one step toward orange.

The UI says "no food is off-limits" and never labels a color "bad". The known gotcha is that nuts, olive oil and salmon come out orange. The coach should explain this rather than discourage those foods.

**Lessons:** we write our own curriculum, about 100 markdown cards in the repo, drafted with Claude and reviewed by you. It follows Noom's arc without copying Noom's text:
- W1–2: Big Picture, calorie density, logging
- W3–6: behavior chains, mindful eating, thought distortions, emotional hunger
- W7–12: food environment, if-then plans, sleep and stress, plateaus
- W13–16: protein and exercise, slip-ups, identity, maintenance

## 5. Data model (Drizzle)

- `user(id, name, email, role, timezone, program_mode, created_at)`
- `profile(user_id, sex, birthdate, height_in, activity_factor, goal_weight, pace_lb_wk, big_picture, flags_json, ed_screen)`
- `target_history(user_id, effective_date, base_kcal, basis_note)`: keeps the 2,200 → 2,430 correction history
- `weight(user_id, date, lb, measured, note)`
- `activity(user_id, date, active_kcal, resting_kcal, steps, exercise_min, source, partial)`
- `food_entry(id, user_id, date, meal, item, qty, kcal, protein, carbs, fat, grams, color, note, photo_id)`: values per unit, as in today's log
- `food_library(user_id, name, basis_kcal, protein, carbs, fat, grams, category, color, note)`: saves foods for consistent reuse, seeded from the 221 rows
- `conversation`, `message(user_id, role, content, kind)`: kind is chat, check-in or weekly review
- `goal(user_id, week_start, text, status, reflection)`
- `lesson_progress(user_id, lesson_id, completed_at, quiz_answer, reflection)`
- `push_subscription(user_id, endpoint, keys)`, `ingest_token(user_id, token_hash)`
- `family_post(user_id, week, text)`: opt-in shared wins

## 6. Seeding Michael

1. Export `tracker-log.md` from the Cowork project. It is readable through the project docs API in a signed-in browser, and I've confirmed I can reach it. Save it to `seed/michael/tracker-log.md`.
2. `scripts/import-tracker.ts` reuses the table parsing from `make_page.py`:
   - Settings → `profile` + `target_history`: 2,430, 68 in, male, 46, start 353.4 lb on 2026-09-25.
   - The three tables → their matching tables. Flag 2026-10-13 activity as `partial`.
   - Distinct food items → `food_library`.
3. Michael starts in `classic` mode with today's 3 daily check-ins, so nothing changes for him on day one.
4. Leah and Eve start empty and go through Noom-mode onboarding.

## 7. Phases

1. **Skeleton.**
   - Repo, auth, the three accounts, schema, and the seed import.
   - A dashboard at parity with Scale & Plate: Today, Weight, Calories, Food history.
2. **Coach chat.**
   - Tool-using agent, text and photo food logging, food-library reuse, `classic` mode parity.
   - The current tone rules: warm, honest, one tip, no em dashes.
3. **Automation.**
   - Health Auto Export REST ingest, per user.
   - Scheduled check-ins with Web Push.
   - Nightly replacement of partial activity data with the full-day numbers.
4. **Noom mode.**
   - Intake and projection, the zone budget, the color classifier and color-mix view, EWMA trend.
   - The lesson engine and curriculum, the weekly SMART review, and the MI coach persona.
5. **Family.**
   - Onboard Leah and Eve.
   - Michael's mode toggle in settings.
   - Opt-in weekly family wins thread (the Noom "group" analog).
6. **Cutover.**
   - Run alongside Cowork for a week, then disable the Cowork scheduled task and the Gmail export rule.
   - Keep an xlsx/CSV export.

## 7a. Status (2026-10-14)

- Phase 1 done: dashboard, accounts, Google sign-in (`/auth/google`) with password fallback.
- Phase 2 coach chat done: `/coach`, Claude tool loop (`src/lib/coach/`), photo logging, food-library reuse. Needs `ANTHROPIC_API_KEY`.
- Phase 3 check-ins done: per-user times in Settings (default 07:53, 11:53, 17:53), web push via the PWA service worker, a once-a-minute timer in `src/instrumentation.ts`. Each check-in asks only about unlogged meals and is skipped if there's nothing to ask.
- Devices: Leah and Eve use Android, where Chrome web push works without installing. Michael's iPhone needs the app added to the Home Screen (iOS 16.4+) before it can subscribe.
- Not yet: Health Auto Export ingest (Michael only), Noom-mode onboarding, lessons, weekly review.

## 8. Safety rails (all modes)

- Never set a budget below the floor or BMR.
- Warn if the 3-week average loss runs above 1% of body weight per week.
- Eating-disorder screen at onboarding. Red flags pause calorie targets and point to professional help.
- **If Eve is under 18:** no deficit, no calorie budget and no weigh-in prompts. Run a habits-only Noom mode: colors as "fill up on green", lessons, and activity, with parent visibility.
- The coach gives no medical advice beyond general guidance, and defers on medications and conditions.

## 9. Open questions

1. **Eve's age.** This decides between the full Noom mode and habits-only.
2. **Hosting:** home server (behind Tailscale or a Cloudflare Tunnel) or a VPS? And which domain?
3. **Devices:** decided 2026-10-14: no activity tracking for Leah and Eve for now. `users.activity_tracking` is off for them, so their target is the zone with no eat-back. Health Auto Export ingest is Michael-only until that changes.
4. **Privacy within the family:**
   - Fully private per person, apart from the opt-in wins feed?
   - Or should Michael, as admin, see everyone's data?
5. **API key:** use a key on your personal Anthropic Console account, with a monthly spend limit set there.

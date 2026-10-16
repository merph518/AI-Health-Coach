# Fagerteam Coach for Android

A thin app around the coach artifact: a full-screen WebView that opens
https://claude.ai/artifact/HsXvPzyvfoNbwfW9s5TF7y, plus a bridge that reads **steps, active calories and
exercise minutes** from Health Connect for Leah's and Eve's phones. All data stays in the artifact db: the
page saves the numbers through its own `db` access, as the signed-in person. The app stores only whose
phone it is.

## How it works

- `MainActivity` hosts the WebView (JavaScript, DOM storage, third-party cookies for the artifact frame,
  photo picker with camera). Only `https://claude.ai` pages open inside the app; other links open in the
  phone's browser.
- `WebViewCompat.addWebMessageListener` injects `window.FagerHealth` into the page. The listener answers
  only while the top page is claude.ai, and only `health.read`.
- `HealthReader` reads per-day totals with Health Connect's aggregate API (`StepsRecord.COUNT_TOTAL`,
  `ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL`, `ExerciseSessionRecord.EXERCISE_DURATION_TOTAL`),
  which de-duplicates overlapping sources (phone, Samsung Health, a watch). Read only; at most 14 dates
  in the last 30 days.
- First run asks "Whose phone is this?" (Leah or Eve). Change it later by long-pressing the app icon →
  **Whose phone**. The page writes only when that matches the person open in the coach.
- Sync runs when the coach loads, when the app comes back to the front, and from Settings → Activity →
  **Sync now**. Today is saved as a partial day.

### Bridge messages (shared with the iPhone app)

```
page → app  {type: "health.read", id, dates: ["YYYY-MM-DD", …], ask?: bool}
app → page  {type: "health.data", id, owner, today, days: [{date, steps?, activeKcal?, exerciseMin?, weightLb?}]}
            {type: "health.error", id, owner, error, message?}
            {type: "health.wake"}
```

`today` is the phone's date. `error` is one of `permission` (not allowed yet), `permission_blocked`
(denied twice, so Android won't ask again; Sync now opens Health Connect instead), `unavailable` (needs
installing or updating), `unsupported` (no Health Connect on this phone), `no_owner`, `background` (the
app wasn't on screen; the page ignores it and syncs on the next `health.wake`) or `failed`.

The bridge answers only frames on `https://*.frame.claudeusercontent.com` (where claude.ai serves
artifacts), and only while the top page is the coach artifact itself (`COACH_URL`).

`ask: true` (Sync now) lets the app open the Health Connect permission screen or its Play Store page;
automatic syncs ask only the first time. An iPhone app can inject a `window.FagerHealth` with the same
`postMessage(string)` / `onmessage({data})` shape and the page code works unchanged.

## Building

The app is built on this machine (it's only for our household, so there's no CI). On Ubuntu:

```bash
sudo apt install openjdk-17-jdk-headless google-android-cmdline-tools-13.0-installer google-android-platform-36-installer google-android-build-tools-36.0.0-installer google-android-platform-tools-installer
```

Then in this folder, with `local.properties` holding `sdk.dir=/usr/lib/android-sdk`:

```bash
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew assembleDebug lintDebug
```

Gradle 8.14 can't run on newer JDKs, hence the `JAVA_HOME`. Lint should report no issues, and any warning
fails the build. Ubuntu's SDK packages stop at platform 36, so `androidx.core` stays at 1.18 (1.19 needs
compileSdk 37 and AGP 9.1). The wrapper fetches Gradle itself (checksum pinned in
`gradle/wrapper/gradle-wrapper.properties`).

### Releases for the phones

Every APK installed on Leah's and Eve's phones must be signed with the same key, or Android won't update
the app in place (and uninstalling loses the claude.ai sign-in). Make the key once:

```bash
./release.sh init
```

It goes in `~/.local/share/fagerteam-coach/` with its password, readable only by you. **Back that folder
up**; losing it means reinstalling the app on both phones. Then each release is:

```bash
./release.sh
```

It lints, builds the next version into `app/build/outputs/apk/release/app-release.apk`, and bumps
`version.properties`. Commit that file so the next release counts up from it.

A debug APK (`assembleDebug`) is only for a quick try on your own phone: it's signed with a different key,
so a release can't install over it.

To point a build at the private test artifact instead of the live coach, set `COACH_URL`:

```bash
COACH_URL=https://claude.ai/artifact/Dyemov2twz4ziBgDTHTZrn JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew assembleDebug
```

## Installing on Leah's and Eve's phones

1. Send the APK to the phone and open it; allow "Install unknown apps" for the app it was opened from.
2. Open Fagerteam Coach, pick whose phone it is.
3. Sign in to claude.ai with the **email code** option (Google sign-in doesn't work inside apps).
4. In the coach: Settings → Activity → turn on **Track steps and exercise**, Save, then **Sync now** and
   allow steps, active calories and exercise in Health Connect.
5. Make sure their watch's app (Samsung Health, Fitbit, Pixel Watch…) shares data with Health Connect.

## Still to check on a real phone

1. claude.ai email sign-in, the artifact's `db` and `sample`, and photo upload work inside the WebView.
2. The bridge reaches the artifact frame (logged as `health.read from <origin>`, tag `FagerCoach`). In a
   desktop browser the frame is `https://<id>.frame.claudeusercontent.com`; check the WebView matches.
3. Health Connect returns sensible numbers on their phones.

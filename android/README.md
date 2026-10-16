# Fagerteam Coach for Android

A thin app around the coach artifact (issue #8): a full-screen WebView that opens
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

### Bridge messages (shared with the iPhone app, #9)

```
page → app  {type: "health.read", id, dates: ["YYYY-MM-DD", …], ask?: bool}
app → page  {type: "health.data", id, owner, days: [{date, steps?, activeKcal?, exerciseMin?, weightLb?}]}
            {type: "health.error", id, owner, error: "permission" | "unavailable" | "failed", message?}
            {type: "health.wake"}
```

`ask: true` (Sync now) lets the app open the Health Connect permission screen or its Play Store page;
automatic syncs ask only the first time. An iPhone app can inject a `window.FagerHealth` with the same
`postMessage(string)` / `onmessage({data})` shape and the page code works unchanged.

## Building

CI builds the APK on every push that touches `android/` (Actions → **Android app** → artifact
`fagerteam-coach-apk`). Locally, on Ubuntu:

```bash
sudo apt install openjdk-17-jdk-headless google-android-cmdline-tools-13.0-installer google-android-platform-36-installer google-android-build-tools-36.0.0-installer google-android-platform-tools-installer
```

Then in this folder, with `local.properties` holding `sdk.dir=/usr/lib/android-sdk`:

```bash
JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 ./gradlew assembleDebug lintDebug
```

Gradle 8.14 can't run on newer JDKs, hence the `JAVA_HOME`. Lint should report no issues. Ubuntu's SDK
packages stop at platform 36, so `androidx.core` stays at 1.18 (1.19 needs compileSdk 37 and AGP 9.1). The wrapper fetches Gradle itself (checksum
pinned in `gradle/wrapper/gradle-wrapper.properties`). The APK lands in `app/build/outputs/apk/debug/`;
`adb install -r` it onto a phone with USB debugging on.

### Signing

Every build installed on a phone must use the same key, or Android won't update the app in place (and
uninstalling loses the claude.ai sign-in). Make a key once and keep it safe:

```bash
keytool -genkeypair -v -keystore release.jks -alias coach -keyalg RSA -keysize 4096 -validity 36500
```

Then add repo secrets `ANDROID_KEYSTORE_B64` (`base64 -w0 release.jks`), `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS` (`coach`) and `ANDROID_KEY_PASSWORD`. With the secrets set, CI builds a signed release
APK; without them, a debug APK.

## Installing on Leah's and Eve's phones

1. Send the APK to the phone and open it; allow "Install unknown apps" for the app it was opened from.
2. Open Fagerteam Coach, pick whose phone it is.
3. Sign in to claude.ai with the **email code** option (Google sign-in doesn't work inside apps).
4. In the coach: Settings → Activity → turn on **Track steps and exercise**, Save, then **Sync now** and
   allow steps, active calories and exercise in Health Connect.
5. Make sure their watch's app (Samsung Health, Fitbit, Pixel Watch…) shares data with Health Connect.

## Still to check on a real phone (the spike in #8)

1. claude.ai email sign-in, the artifact's `db` and `sample`, and photo upload work inside the WebView.
2. Which origin the artifact frame runs on (logged as `health.read from <origin>`, tag `FagerCoach`), so
   the listener's `"*"` origin rule can be narrowed to it.
3. Health Connect returns sensible numbers on their phones.

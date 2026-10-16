plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Release signing comes from the environment (release.sh reads the key kept outside the repo). Every build
// must use the same key, or Android refuses to install the update over the old app (and the claude.ai
// sign-in is lost).
val keystorePath: String? = System.getenv("SIGNING_KEYSTORE")

android {
    namespace = "com.fagerteam.coach"
    compileSdk = 36
    buildToolsVersion = "36.0.0"

    defaultConfig {
        applicationId = "com.fagerteam.coach"
        minSdk = 28
        targetSdk = 36
        // release.sh counts up from the last released version, kept in version.properties.
        versionCode = (System.getenv("VERSION_CODE")
            ?: rootProject.file("version.properties").readLines().firstNotNullOfOrNull { it.substringAfter("versionCode=", "").ifBlank { null } }
            ?: "1").toInt()
        versionName = "0.1.$versionCode"
        // The coach artifact the app opens. COACH_URL in the environment points a build at another copy
        // (the private test artifact) without touching the live one.
        val coachUrl = System.getenv("COACH_URL") ?: "https://claude.ai/artifact/HsXvPzyvfoNbwfW9s5TF7y"
        buildConfigField("String", "COACH_URL", "\"$coachUrl\"")
    }

    signingConfigs {
        if (keystorePath != null) {
            create("release") {
                storeFile = file(keystorePath)
                storePassword = System.getenv("SIGNING_STORE_PASSWORD")
                keyAlias = System.getenv("SIGNING_KEY_ALIAS")
                keyPassword = System.getenv("SIGNING_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (keystorePath != null) signingConfig = signingConfigs.getByName("release")
        }
    }

    buildFeatures {
        buildConfig = true
    }

    lint {
        // Any lint warning fails the build, so new ones get fixed or explicitly suppressed.
        warningsAsErrors = true
        abortOnError = true
        // "A newer version is available" depends on what Google publishes that day, not on this code, so it is
        // reported without failing the build.
        informational += setOf("GradleDependency", "AndroidGradlePluginVersion", "NewerVersionAvailable")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
}

dependencies {
    // core 1.19+ needs compileSdk 37 and AGP 9.1, and Ubuntu's apt SDK packages stop at platform 36.
    //noinspection GradleDependency
    implementation("androidx.core:core-ktx:1.18.0")
    implementation("androidx.activity:activity-ktx:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.11.0")
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("androidx.health.connect:connect-client:1.1.0")
}

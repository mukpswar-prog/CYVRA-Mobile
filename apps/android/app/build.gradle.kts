plugins {
    // AGP 9 has built-in Kotlin. Do not apply org.jetbrains.kotlin.android —
    // that plugin loads the removed BaseVariant API and Studio sync fails.
    id("com.android.application")
}

android {
    namespace = "cyvra.mobile"
    compileSdk = 35

    defaultConfig {
        applicationId = "co.in.cyvra.mobile"
        minSdk = 29
        targetSdk = 35
        versionCode = 1
        versionName = "0.0.0-g5"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
    }
}

dependencies {
    implementation(project(":core"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.12.0")
}

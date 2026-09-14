plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "cyvra.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "co.in.cyvra.mobile"
        // APK install floor (Android 8.0+). Not the Windows-host device-service floor.
        minSdk = 26
        targetSdk = 36
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

plugins {
    id("com.android.application")
    kotlin("android")
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
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    implementation(project(":core"))
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.12.0")
}

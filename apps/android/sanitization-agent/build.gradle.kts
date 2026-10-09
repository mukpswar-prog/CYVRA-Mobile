plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "com.cyvra.sanitization"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.cyvra.sanitization"
        // Matrix floor (CYVRA_CAPABILITY_MATRIX_V1.md): the wipe proof runs on the same
        // Android 8.0+ floor as the evidence app, so the proof exercises the real floor.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.0.1-poc"
    }

    // PROOF OF CONCEPT.
    //
    // No release signingConfig is declared anywhere in this module, so an assembled
    // release artifact is unsigned and cannot be installed. The only installable
    // output is the debug build, signed with the platform debug keystore.
    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_21
        targetCompatibility = JavaVersion.VERSION_21
    }

    // Lets the JVM unit tests exercise the receiver's decision logic without a device.
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
    }
}

// Runtime dependencies: none. The POC UI uses framework widgets only, which keeps this
// module inside the commissioned "no dependencies beyond AndroidX core" ceiling — indeed
// strictly below it — and keeps the wipe proof build hermetic.
dependencies {
    testImplementation(kotlin("test-junit"))
}

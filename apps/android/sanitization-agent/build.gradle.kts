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
        versionName = "1.0.0"
    }

    signingConfigs {
        create("release") {
            val keystorePath = System.getenv("CYVRA_RELEASE_KEYSTORE") ?: (project.findProperty("cyvra.release.keystore") as? String)
            val keystorePassword = System.getenv("CYVRA_RELEASE_KEYSTORE_PASSWORD") ?: (project.findProperty("cyvra.release.keystore.password") as? String)
            val keyAlias = System.getenv("CYVRA_RELEASE_KEY_ALIAS") ?: (project.findProperty("cyvra.release.key.alias") as? String)
            val keyPassword = System.getenv("CYVRA_RELEASE_KEY_PASSWORD") ?: (project.findProperty("cyvra.release.key.password") as? String)

            if (keystorePath != null && file(keystorePath).exists()) {
                storeFile = file(keystorePath)
                storePassword = keystorePassword
                this.keyAlias = keyAlias
                this.keyPassword = keyPassword
            } else {
                // For development and test environments without the Chief Engineer's production key,
                // fallback to the debug signing configuration so release builds assemble signed and installable
                // rather than failing with unresolvable signing errors or producing an uninstallable unsigned APK.
                initWith(getByName("debug"))
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("release")
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

import java.io.File

plugins {
    id("com.android.application")
    kotlin("android")
    kotlin("plugin.serialization")
}

android {
    namespace = "cyvra.mobile"
    compileSdk = 36

    defaultConfig {
        applicationId = "co.in.cyvra.mobile"
        // APK install floor (Android 8.0+). Not the Windows-host device-service floor.
        minSdk = 26
        targetSdk = 36
        versionCode = 3
        versionName = "2.1.2"
    }

    val signingMode = (project.findProperty("cyvra.signing.mode") as? String)?.trim()?.lowercase()
        ?: System.getenv("CYVRA_SIGNING_MODE")?.trim()?.lowercase()
        ?: if (!System.getenv("CYVRA_RELEASE_KEYSTORE").isNullOrBlank() || project.hasProperty("cyvra.release.keystore")) "production" else "unsigned"

    signingConfigs {
        when (signingMode) {
            "production" -> {
                val keystorePath = System.getenv("CYVRA_RELEASE_KEYSTORE") ?: (project.findProperty("cyvra.release.keystore") as? String)
                val keystorePassword = System.getenv("CYVRA_RELEASE_KEYSTORE_PASSWORD") ?: (project.findProperty("cyvra.release.keystore.password") as? String)
                val keyAlias = System.getenv("CYVRA_RELEASE_KEY_ALIAS") ?: (project.findProperty("cyvra.release.key.alias") as? String)
                val keyPassword = System.getenv("CYVRA_RELEASE_KEY_PASSWORD") ?: (project.findProperty("cyvra.release.key.password") as? String)

                val missing = mutableListOf<String>()
                if (keystorePath.isNullOrBlank()) missing.add("CYVRA_RELEASE_KEYSTORE")
                if (keystorePassword.isNullOrBlank()) missing.add("CYVRA_RELEASE_KEYSTORE_PASSWORD")
                if (keyAlias.isNullOrBlank()) missing.add("CYVRA_RELEASE_KEY_ALIAS")
                if (keyPassword.isNullOrBlank()) missing.add("CYVRA_RELEASE_KEY_PASSWORD")

                if (missing.isNotEmpty()) {
                    throw GradleException("PRODUCTION_SIGNING_CONFIG_MISSING: Production signing requires credentials. Missing: ${missing.joinToString(", ")}")
                }

                val keystoreFile = file(keystorePath!!)
                if (!keystoreFile.exists()) {
                    throw GradleException("PRODUCTION_KEYSTORE_NOT_FOUND: The specified keystore file does not exist: '${keystoreFile.absolutePath}'")
                }

                create("release") {
                    storeFile = keystoreFile
                    storePassword = keystorePassword
                    this.keyAlias = keyAlias
                    this.keyPassword = keyPassword
                }
            }
            "test" -> {
                val customTestKeystore = (System.getenv("CYVRA_TEST_KEYSTORE") ?: (project.findProperty("cyvra.test.keystore") as? String))?.let { file(it) }
                val defaultDebugKeystore = File(System.getProperty("user.home"), ".android/debug.keystore")
                val targetTestKeystore = customTestKeystore
                    ?: if (defaultDebugKeystore.exists()) defaultDebugKeystore
                    else layout.buildDirectory.file("keystore/cyvra-test.keystore").get().asFile

                if (!targetTestKeystore.exists()) {
                    targetTestKeystore.parentFile?.mkdirs()
                    val javaHome = System.getProperty("java.home")
                    val isWindows = System.getProperty("os.name").lowercase().contains("windows")
                    val keytoolBin = if (isWindows) "keytool.exe" else "keytool"
                    val keytool = File(javaHome, "bin/$keytoolBin").takeIf { it.exists() }
                        ?: File("keytool")
                    val cmd = listOf(
                        keytool.absolutePath,
                        "-genkeypair",
                        "-keystore", targetTestKeystore.absolutePath,
                        "-storepass", "androiddebugkey",
                        "-alias", "cyvra-test-key",
                        "-keypass", "androiddebugkey",
                        "-dname", "CN=CYVRA Mobile Test Signer, OU=Engineering, O=CYVRA, C=US",
                        "-keyalg", "RSA",
                        "-keysize", "2048",
                        "-validity", "10000"
                    )
                    val process = ProcessBuilder(cmd).redirectErrorStream(true).start()
                    val exitCode = process.waitFor()
                    if (exitCode != 0) {
                        val out = process.inputStream.bufferedReader().readText()
                        throw GradleException("FAILED_TO_GENERATE_TEST_KEYSTORE (exit $exitCode): $out")
                    }
                }

                create("release") {
                    if (targetTestKeystore == defaultDebugKeystore && defaultDebugKeystore.exists()) {
                        initWith(getByName("debug"))
                    } else {
                        storeFile = targetTestKeystore
                        storePassword = "androiddebugkey"
                        keyAlias = "cyvra-test-key"
                        keyPassword = "androiddebugkey"
                    }
                }
            }
            "unsigned" -> {
                // Standing Hold H4: Release build remains unsigned for installer staging.
            }
            else -> {
                throw GradleException("UNKNOWN_SIGNING_MODE: Unsupported cyvra.signing.mode '$signingMode'. Allowed modes: unsigned, test, production.")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            if (signingMode == "test" || signingMode == "production") {
                signingConfig = signingConfigs.getByName("release")
            }
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
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("com.google.android.material:material:1.12.0")
}

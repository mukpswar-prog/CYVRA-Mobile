pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    plugins {
        kotlin("jvm") version "2.3.21"
        kotlin("plugin.serialization") version "2.3.21"
        kotlin("android") version "2.3.21"
        // Otter 2 supports AGP 4.1–8.13 only. 9.0.1 removes BaseVariant and
        // Studio's KotlinAndroidTarget then crashes on sync.
        id("com.android.application") version "8.13.2"
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "cyvra-mobile-android"

println(
    "cyvra-mobile-android: Java ${System.getProperty("java.version")} (Codespaces is often 25; Gradle 9.1+ required)",
)

include(":core")
include(":host")
project(":host").projectDir = file("../host")

val androidHome = System.getenv("ANDROID_HOME") ?: System.getenv("ANDROID_SDK_ROOT")
val hasLocalSdk = file("local.properties").exists()
if (!androidHome.isNullOrBlank() || hasLocalSdk) {
    include(":app")
}

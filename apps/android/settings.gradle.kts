pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
    plugins {
        kotlin("jvm") version "2.2.10"
        kotlin("plugin.serialization") version "2.2.10"
        id("com.android.application") version "9.0.1"
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

val androidHome = System.getenv("ANDROID_HOME") ?: System.getenv("ANDROID_SDK_ROOT")
val hasLocalSdk = file("local.properties").exists()
if (!androidHome.isNullOrBlank() || hasLocalSdk) {
    include(":app")
}

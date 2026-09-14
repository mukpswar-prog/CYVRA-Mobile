plugins {
    kotlin("jvm") version "2.3.21" apply false
    kotlin("plugin.serialization") version "2.3.21" apply false
    // Same classpath as :app. Without AGP here, kotlin-android 2.3.21
    // throws ClassNotFoundException: com.android.build.gradle.BaseExtension
    // as soon as local.properties exists and :app is included.
    kotlin("android") version "2.3.21" apply false
    id("com.android.application") version "8.13.2" apply false
}

tasks.register("test") {
    dependsOn(":core:test")
}

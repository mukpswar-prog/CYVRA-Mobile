plugins {
    application
    kotlin("jvm")
    kotlin("plugin.serialization")
}

group = "cyvra.mobile.host"
version = "0.0.0"

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

dependencies {
    implementation(project(":core"))
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    testImplementation(kotlin("test"))
    /*
     * Property-based testing for the §14 transaction state.
     *
     * Jqwik supplies its own JUnit Platform engine, so the existing
     * `useJUnitPlatform()` picks its tests up with no further configuration.
     * Test-scope only: nothing here reaches the shipped Host, and it touches
     * no JavaScript, so it is outside the pnpm lockfile's reach entirely.
     */
    testImplementation("net.jqwik:jqwik:1.9.0")
}

tasks.test {
    useJUnitPlatform()
}

application {
    mainClass.set("cyvra.mobile.host.protocol.HostMain")
    applicationName = "cyvra-mobile-host"
}

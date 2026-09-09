plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
}

group = "cyvra.mobile"
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
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    testImplementation(kotlin("test"))
}

tasks.test {
    useJUnitPlatform()
}

val catalogJson = rootProject.layout.projectDirectory
    .file("../../packages/evidence/schema/s1-catalog.v1.json")

sourceSets {
    named("main") {
        resources.srcDir(layout.buildDirectory.dir("generated/s1-resources"))
    }
}

val syncCatalog = tasks.register<Copy>("syncCatalog") {
    from(catalogJson)
    into(layout.buildDirectory.dir("generated/s1-resources"))
    rename { "s1-catalog.v1.json" }
}

tasks.named("processResources") {
    dependsOn(syncCatalog)
}

tasks.named("processTestResources") {
    dependsOn(syncCatalog)
}

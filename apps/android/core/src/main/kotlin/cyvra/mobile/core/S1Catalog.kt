package cyvra.mobile.core

import kotlinx.serialization.json.Json

object S1Catalog {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    val file: CatalogFile by lazy {
        val stream = checkNotNull(
            S1Catalog::class.java.classLoader.getResourceAsStream("s1-catalog.v1.json"),
        ) { "s1-catalog.v1.json missing from classpath (run Gradle syncCatalog)" }
        json.decodeFromString<CatalogFile>(stream.bufferedReader().readText())
    }

    val tests: List<TestDefinition> get() = file.catalog
    val contract: CapabilityContract get() = file.contract

    fun definition(testId: String): TestDefinition? = tests.find { it.testId == testId }
}

import groovy.json.JsonOutput
import groovy.json.JsonSlurper

plugins {
    id("com.android.application") version "8.13.2"
    id("org.jetbrains.kotlin.android") version "2.2.21"
}

val projectInfo = JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>
val readboxVersion = projectInfo["version"] as String
val (major, minor, patch) = readboxVersion.split(".").map(String::toInt)
require(major in 0..2099 && minor in 0..999 && patch in 0..999)
val keyPath = providers.environmentVariable("READBOX_KEYSTORE").orNull

android {
    namespace = "io.github.suyh1.readbox"
    compileSdk = 36
    buildToolsVersion = "36.0.0"
    defaultConfig {
        applicationId = "io.github.suyh1.readbox"
        minSdk = 26
        targetSdk = 36
        versionCode = major * 1000000 + minor * 1000 + patch + 1
        versionName = readboxVersion
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    if (keyPath != null) {
        signingConfigs.create("distribution") {
            storeFile = file(keyPath)
            storePassword = System.getenv("READBOX_STORE_PASSWORD")
            keyAlias = System.getenv("READBOX_KEY_ALIAS")
            keyPassword = System.getenv("READBOX_KEY_PASSWORD")
        }
        buildTypes.getByName("release").signingConfig = signingConfigs.getByName("distribution")
    }
    buildTypes.getByName("debug") { applicationIdSuffix = ".debug" }
    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/readboxAssets"))
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

// A built-in extension gives the offline UI a stable origin for its modules and CSS.
val webDist = rootProject.file("../dist")
val bundleWeb by tasks.registering(Sync::class) {
    inputs.property("version", readboxVersion)
    from(webDist)
    val extensionDir = layout.buildDirectory.dir("generated/readboxAssets/ui")
    into(extensionDir)
    doFirst { check(webDist.resolve("index.html").isFile) { "请先在仓库根目录运行 npm run build" } }
    doLast {
        extensionDir.get().file("manifest.json").asFile.writeText(JsonOutput.toJson(mapOf(
            "manifest_version" to 2, "name" to "ReadBox", "version" to readboxVersion,
            "browser_specific_settings" to mapOf("gecko" to mapOf("id" to "ui@readbox.local"))
        )))
    }
}
tasks.named("preBuild") {
    dependsOn(bundleWeb)
    doLast { check(webDist.resolve("index.html").isFile) { "缺少 dist/index.html，请运行 npm run build" } }
}

dependencies {
    implementation("org.mozilla.geckoview:geckoview:157.0.20261005135250")
}

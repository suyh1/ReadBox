import groovy.json.JsonOutput
import groovy.json.JsonSlurper

buildscript {
    dependencies { classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.20") }
}

plugins {
    id("com.android.application") version "9.4.0"
}

val projectInfo = JsonSlurper().parse(rootProject.file("../package.json")) as Map<*, *>
val readboxVersion = projectInfo["version"] as String
val (major, minor, patch) = readboxVersion.split(".").map(String::toInt)
require(major in 0..2099 && minor in 0..999 && patch in 0..999)
val keyPath = providers.environmentVariable("READBOX_KEYSTORE").orNull

android {
    namespace = "io.github.suyh1.readbox"
    compileSdk { version = release(37) { minorApiLevel = 1 } }
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
}


// GeckoView loads this built-in extension from the APK without a web server.
abstract class BundleReadBoxUi : DefaultTask() {
    @get:InputDirectory
    @get:PathSensitive(PathSensitivity.RELATIVE)
    abstract val webDist: DirectoryProperty
    @get:Input abstract val appVersion: Property<String>
    @get:OutputDirectory abstract val assets: DirectoryProperty
    @get:Inject abstract val files: FileSystemOperations

    @TaskAction
    fun bundle() {
        val source = webDist.get().asFile
        check(source.resolve("index.html").isFile) { "请先在仓库根目录运行 npm run build" }
        val extensionDir = assets.get().dir("ui").asFile
        files.sync { from(source); into(extensionDir) }
        extensionDir.resolve("manifest.json").writeText(JsonOutput.toJson(mapOf(
            "manifest_version" to 2, "name" to "ReadBox", "version" to appVersion.get(),
            "browser_specific_settings" to mapOf("gecko" to mapOf("id" to "ui@readbox.local"))
        )))
    }
}

androidComponents.onVariants { variant ->
    val bundle = tasks.register<BundleReadBoxUi>("bundle" + variant.name.replaceFirstChar { it.uppercase() } + "Web") {
        webDist.set(rootProject.layout.projectDirectory.dir("../dist"))
        appVersion.set(readboxVersion)
    }
    variant.sources.assets?.addGeneratedSourceDirectory(bundle, BundleReadBoxUi::assets)
}

dependencies {
    implementation("org.mozilla.geckoview:geckoview:157.0.20261005135250")
}

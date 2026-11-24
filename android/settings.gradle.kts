pluginManagement {
    repositories {
        google()
        if (System.getenv("GITHUB_ACTIONS") == "true") {
            maven("https://maven-central.storage-download.googleapis.com/maven2/")
        }
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        if (System.getenv("GITHUB_ACTIONS") == "true") {
            maven("https://maven-central.storage-download.googleapis.com/maven2/")
        }
        mavenCentral()
        maven("https://maven.mozilla.org/maven2/") {
            content { includeGroupByRegex("org\\.mozilla(\\..*)?") }
        }
    }
}
rootProject.name = "ReadBox"
include(":app")

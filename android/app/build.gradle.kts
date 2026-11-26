plugins { id("com.android.application") }

android {
 namespace = "studio.ergon.smerp"
 compileSdk = 36
 defaultConfig {
  applicationId = "studio.ergon.smerp"
  minSdk = 26
  targetSdk = 36
  versionCode = 1
  versionName = "1.0"
  ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
 }
 signingConfigs {
  create("localRelease") {
   storeFile = rootProject.file(".local/release.jks")
   storePassword = providers.fileContents(rootProject.layout.projectDirectory.file(".local/signing-password")).asText.orNull?.trim()
   keyAlias = "smerp"
   keyPassword = storePassword
  }
 }
 buildTypes {
  release {
   signingConfig = signingConfigs.getByName("localRelease")
   isMinifyEnabled = false
  }
 }
 sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/notices").get().asFile)
 compileOptions {
  sourceCompatibility = JavaVersion.VERSION_17
  targetCompatibility = JavaVersion.VERSION_17
 }
}

dependencies {
 implementation(files("libs/workshop.aar"))
 implementation("androidx.activity:activity:1.13.0")
}

val copyNotices by tasks.registering(Copy::class) {
 from(rootProject.file("../licenses"))
 into(layout.buildDirectory.dir("generated/notices/licenses"))
}
tasks.named("preBuild") { dependsOn(copyNotices) }

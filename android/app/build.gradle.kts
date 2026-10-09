import java.net.URI
import java.security.MessageDigest
import java.util.zip.ZipInputStream

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
}

android {
    namespace = "ai.yumi.android"
    compileSdk = 36

    defaultConfig {
        applicationId = "ai.yumi.android"
        // Android 12 is the first version with the on-device speech recognizer (SPEC-10).
        minSdk = 31
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"

        ndk {
            // Both phones and the Android emulator on Apple silicon are arm64.
            // ONNX Runtime adds 34 to 41 MB per ABI, so the others are left out.
            abiFilters += listOf("arm64-v8a")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    sourceSets {
        // The protocol's generated Kotlin types (protocol/README.md, "Using the types"). Never hand-write them here.
        getByName("main").java.srcDir(rootProject.file("../protocol/generated/kotlin"))
    }

    testOptions {
        unitTests.all {
            // The error copy test compares the code with the table in SPEC-11.
            it.systemProperty("yumi.specsDir", rootProject.file("../specs").absolutePath)
            // Declared as an input so editing a spec reruns the test instead of reusing a cached pass.
            it.inputs.dir(rootProject.file("../specs")).withPropertyName("specs")
            // The wake word parity test runs the real models from the app's assets.
            it.systemProperty("yumi.assetsDir", file("src/main/assets").absolutePath)
            // The bridge crypto test reproduces the protocol's cross-language vectors.
            it.systemProperty("yumi.protocolDir", rootProject.file("../protocol").absolutePath)
            it.inputs.dir(rootProject.file("../protocol/vectors")).withPropertyName("protocolVectors")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.process)
    implementation(libs.androidx.lifecycle.service)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.kotlinx.coroutines.android)

    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.core)
    debugImplementation(libs.androidx.compose.ui.tooling)

    implementation(libs.onnxruntime.android)
    implementation(libs.vosk.android)
    implementation(libs.jna) { artifact { type = "aar" } }

    // lazysodium-android asks for the JNA jar; the app already has JNA as an AAR with its Android native libraries.
    implementation(libs.lazysodium.android) { exclude(group = "net.java.dev.jna", module = "jna") }
    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.androidx.camera.camera2)
    implementation(libs.androidx.camera.lifecycle)
    implementation(libs.androidx.camera.view)
    implementation(libs.zxing.core)

    testImplementation(libs.junit)
    testImplementation(libs.lazysodium.java)
    testImplementation(libs.okhttp.mockwebserver)
    testImplementation(libs.onnxruntime.jvm)
    testImplementation(libs.kotlinx.coroutines.test)
}

// Unit tests run on the JVM, so they use the desktop build of ONNX Runtime (same version, same Java API)
// instead of the Android one, whose native libraries only load on Android.
configurations.configureEach {
    if (name.endsWith("UnitTestRuntimeClasspath")) {
        exclude(group = "com.microsoft.onnxruntime", module = "onnxruntime-android")
        // Same for lazysodium: the desktop build carries libsodium for the computer running the tests.
        exclude(group = "com.goterl", module = "lazysodium-android")
    }
}

/**
 * Puts Vosk's small English model (Apache 2.0, from https://alphacephei.com/vosk/models) in the app's assets, so the
 * app ships with it and never downloads anything at run time. The zip is downloaded once per machine into Gradle's
 * cache and checked against its SHA-256, which keeps 70 MB of model files out of git.
 */
abstract class FetchVoskModel : DefaultTask() {
    @get:Input abstract val modelName: Property<String>
    @get:Input abstract val sha256: Property<String>
    @get:Internal abstract val cacheDir: DirectoryProperty
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction
    fun fetch() {
        val name = modelName.get()
        val zip = cacheDir.file("$name.zip").get().asFile
        if (!zip.isFile || sha256Of(zip) != sha256.get()) {
            zip.parentFile.mkdirs()
            val partial = File(zip.path + ".partial")
            logger.lifecycle("Downloading $name")
            URI("https://alphacephei.com/vosk/models/$name.zip").toURL().openStream().use { input ->
                partial.outputStream().use { input.copyTo(it) }
            }
            val actual = sha256Of(partial)
            check(actual == sha256.get()) { "$name.zip has SHA-256 $actual, expected ${sha256.get()}" }
            check(partial.renameTo(zip)) { "Could not move $partial into place" }
        }
        val out = outputDir.get().asFile
        out.deleteRecursively()
        val target = File(out, "vosk")
        ZipInputStream(zip.inputStream().buffered()).use { entries ->
            generateSequence { entries.nextEntry }.filterNot { it.isDirectory }.forEach { entry ->
                val file = File(target, entry.name)
                check(file.canonicalPath.startsWith(target.canonicalPath + File.separator)) { "Bad zip entry ${entry.name}" }
                file.parentFile.mkdirs()
                file.outputStream().use { entries.copyTo(it) }
            }
        }
    }

    private fun sha256Of(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().buffered().use { input ->
            val buffer = ByteArray(1 shl 16)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                digest.update(buffer, 0, n)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }
}

val fetchVoskModel = tasks.register<FetchVoskModel>("fetchVoskModel") {
    // Must match VoskSpotter.MODEL_NAME.
    modelName = "vosk-model-small-en-us-0.15"
    sha256 = "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498"
    cacheDir = File(gradle.gradleUserHomeDir, "caches/yumi")
    outputDir = layout.buildDirectory.dir("generated/voskModel")
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(fetchVoskModel, FetchVoskModel::outputDir)
    }
}

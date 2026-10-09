plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
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

    testOptions {
        unitTests.all {
            // The error copy test compares the code with the table in SPEC-11.
            it.systemProperty("yumi.specsDir", rootProject.file("../specs").absolutePath)
            // Declared as an input so editing a spec reruns the test instead of reusing a cached pass.
            it.inputs.dir(rootProject.file("../specs")).withPropertyName("specs")
            // The wake word parity test runs the real models from the app's assets.
            it.systemProperty("yumi.assetsDir", file("src/main/assets").absolutePath)
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

    testImplementation(libs.junit)
    testImplementation(libs.onnxruntime.jvm)
    testImplementation(libs.kotlinx.coroutines.test)
}

// Unit tests run on the JVM, so they use the desktop build of ONNX Runtime (same version, same Java API)
// instead of the Android one, whose native libraries only load on Android.
configurations.configureEach {
    if (name.endsWith("UnitTestRuntimeClasspath")) {
        exclude(group = "com.microsoft.onnxruntime", module = "onnxruntime-android")
    }
}

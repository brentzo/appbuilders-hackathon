// Compiles the generated Swift or Kotlin in Docker, then decodes and re-encodes every example file with the
// generated types and checks the JSON is unchanged. Usage: tsx scripts/compile-check.ts swift|kotlin
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { KOTLIN_PACKAGE, kotlinTypeName, swiftTypeName } from "../generator/index.ts";

const SWIFT_IMAGE = "swift:6.0.3-jammy";
const GRADLE_IMAGE = "gradle:8.11.1-jdk21";
const KOTLIN_VERSION = "2.0.21";
const SERIALIZATION_VERSION = "1.7.3";

const root = fileURLToPath(new URL("../", import.meta.url));
const language = process.argv[2];
const examples = readdirSync(root + "examples")
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((file) => ({ file, type: file.split(".")[0]! }));

function prepare(dir: string, files: Record<string, string>): void {
  rmSync(dir, { recursive: true, force: true });
  for (const [name, content] of Object.entries(files)) {
    const path = `${dir}/${name}`;
    mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    writeFileSync(path, content);
  }
}

function docker(args: string[]): void {
  execFileSync("docker", ["run", "--rm", "-v", `${root}:/work`, ...args], { stdio: "inherit" });
}

if (language === "swift") {
  const cases = examples.map((e) => `    (${JSON.stringify(e.file)}, { try roundTrip(${swiftTypeName(e.type)}.self, $0) }),`);
  prepare(root + ".compile-check/swift", {
    "main.swift": `import Foundation

/// Any JSON value, so two documents can be compared without caring about key order or number spelling.
indirect enum JSONValue: Decodable, Equatable {
    case null, bool(Bool), number(Double), string(String), array([JSONValue]), object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(Double.self) { self = .number(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode([JSONValue].self) { self = .array(v) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }
}

func roundTrip<T: Codable>(_ type: T.Type, _ data: Data) throws -> Bool {
    let decoded = try JSONDecoder().decode(T.self, from: data)
    let encoded = try JSONEncoder().encode(decoded)
    return try JSONDecoder().decode(JSONValue.self, from: data) == JSONDecoder().decode(JSONValue.self, from: encoded)
}

let cases: [(String, (Data) throws -> Bool)] = [
${cases.join("\n")}
]

var failures = 0
for (file, check) in cases {
    do {
        let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1] + "/" + file))
        if try check(data) { print("ok      \\(file)") } else { print("CHANGED \\(file)"); failures += 1 }
    } catch {
        print("FAILED  \\(file): \\(error)")
        failures += 1
    }
}
print("\\(cases.count - failures)/\\(cases.count) examples round-trip")
exit(failures == 0 ? 0 : 1)
`,
  });
  docker([
    "-w", "/work/.compile-check/swift", SWIFT_IMAGE, "bash", "-c",
    "swiftc -swift-version 6 -warnings-as-errors /work/generated/swift/YumiProtocol.swift main.swift -o roundtrip && ./roundtrip /work/examples",
  ]);
} else if (language === "kotlin") {
  const cases = examples.map((e) => `    ${JSON.stringify(e.file)} to { text: String -> roundTrip<${kotlinTypeName(e.type)}>(text) },`);
  prepare(root + ".compile-check/kotlin", {
    "settings.gradle.kts": `rootProject.name = "protocol-check"\n`,
    "build.gradle.kts": `plugins {
    kotlin("jvm") version "${KOTLIN_VERSION}"
    kotlin("plugin.serialization") version "${KOTLIN_VERSION}"
    application
}

repositories { mavenCentral() }

dependencies { implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:${SERIALIZATION_VERSION}") }

kotlin {
    sourceSets["main"].kotlin.srcDirs("src", "/work/generated/kotlin")
    compilerOptions { allWarningsAsErrors.set(true) }
}

application { mainClass.set("check.MainKt") }
`,
    "src/check/Main.kt": `package check

import ${KOTLIN_PACKAGE}.*
import java.io.File
import kotlin.system.exitProcess
import kotlinx.serialization.json.*
import kotlinx.serialization.serializer

val json = Json { explicitNulls = false }

/** Compares JSON without caring about key order or number spelling (1 vs 1.0). */
fun canonical(e: JsonElement): JsonElement = when (e) {
    is JsonObject -> JsonObject(e.mapValues { canonical(it.value) })
    is JsonArray -> JsonArray(e.map(::canonical))
    is JsonNull -> e
    is JsonPrimitive -> if (e.isString || e.booleanOrNull != null) e else JsonPrimitive(e.content.toBigDecimal().stripTrailingZeros())
}

inline fun <reified T> roundTrip(text: String): Boolean {
    val value = json.decodeFromString(serializer<T>(), text)
    val back = json.encodeToString(serializer<T>(), value)
    return canonical(json.parseToJsonElement(text)) == canonical(json.parseToJsonElement(back))
}

val cases: List<Pair<String, (String) -> Boolean>> = listOf(
${cases.join("\n")}
)

fun main(args: Array<String>) {
    var failures = 0
    for ((file, check) in cases) {
        try {
            if (check(File(args[0], file).readText())) println("ok      $file") else { println("CHANGED $file"); failures++ }
        } catch (e: Exception) {
            println("FAILED  $file: \${e.message}")
            failures++
        }
    }
    println("\${cases.size - failures}/\${cases.size} examples round-trip")
    exitProcess(if (failures == 0) 0 else 1)
}
`,
  });
  docker([
    "-v", "yumi-gradle-cache:/gradle-cache", "-e", "GRADLE_USER_HOME=/gradle-cache",
    "-w", "/work/.compile-check/kotlin", GRADLE_IMAGE, "gradle", "--no-daemon", "-q", "run", "--args=/work/examples",
  ]);
} else {
  console.error("Usage: tsx scripts/compile-check.ts swift|kotlin");
  process.exit(2);
}

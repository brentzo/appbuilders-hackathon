// Writes generated types from the schemas. With --check, fails instead if any generated file is out of date.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { GENERATED_DIR, generateAll } from "../generator/index.ts";
import { loadSchemaFiles } from "../src/schemas.ts";

const check = process.argv.includes("--check");
const stale: string[] = [];

for (const [path, content] of generateAll(loadSchemaFiles())) {
  const target = GENERATED_DIR + path;
  let current: string | undefined;
  try {
    current = readFileSync(target, "utf8");
  } catch {
    current = undefined;
  }
  if (current === content) continue;
  if (check) {
    stale.push(path);
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    console.log(`wrote generated/${path}`);
  }
}

if (stale.length) {
  console.error(`Generated files are out of date: ${stale.join(", ")}. Run npm run generate.`);
  process.exit(1);
}

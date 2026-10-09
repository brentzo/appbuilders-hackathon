import { build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.mjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  nodePaths: ["node_modules"],
  external: ["better-sqlite3", "ws"],
});

await mkdir("schemas", { recursive: true });
await cp("../protocol/schemas", "schemas", { recursive: true });

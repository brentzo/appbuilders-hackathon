import { setTimeout as sleep } from "node:timers/promises";
import { PROTOCOL_VERSION } from "@yumi/protocol/types";
import { liveScenarios, runLiveCheck } from "./scenarios.ts";

// Runs the relay side of the SPEC-08 scenarios against a deployed relay and prints a Markdown report (OBJ-30).
// Usage: npm run live-check -- [--url wss://yumibridge.studiokova.co] [--skip-slow]
// It registers a few throwaway device ids on the relay and unpairs every pairing it makes.

const args = process.argv.slice(2);
const url = valueOf("--url") ?? "wss://yumibridge.studiokova.co";
const skipSlow = args.includes("--skip-slow");

if (!url.startsWith("wss://") && !url.startsWith("ws://127.0.0.1") && !url.startsWith("ws://localhost")) {
  console.error("The relay URL must use wss://, or ws:// on this machine.");
  process.exit(2);
}

const health = await readHealth(url);
const started = new Date();
const results = await runLiveCheck(url, { advance: (ms) => sleep(ms) }, undefined, { skipSlow });
const skipped = liveScenarios.filter((s) => skipSlow && s.slow).map((s) => s.name);

console.log(`# Relay live check\n`);
console.log(`- Relay: \`${url}\``);
console.log(`- Health: \`${health}\``);
console.log(`- Client protocol version: ${PROTOCOL_VERSION}`);
console.log(`- Started: ${started.toISOString()}\n`);
console.log("| Scenario | Checks | Result | Time |");
console.log("|---|---|---|---|");
for (const r of results) {
  const outcome = r.ok ? "Passed" : `**Failed:** ${r.detail.replace(/\|/g, "\\|").replace(/\s+/g, " ")}`;
  console.log(`| ${r.name} | ${r.spec.replace(/\|/g, "\\|")} | ${outcome} | ${(r.ms / 1000).toFixed(1)} s |`);
}
for (const name of skipped) console.log(`| ${name} | | Skipped (--skip-slow) | |`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} passed${skipped.length ? `, ${skipped.length} skipped` : ""}.`);
process.exitCode = failed === 0 ? 0 : 1;

function valueOf(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function readHealth(relayUrl: string): Promise<string> {
  const healthUrl = relayUrl.replace(/^ws/, "http").replace(/\/$/, "") + "/health";
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(5000) });
    return `${response.status} ${(await response.text()).trim()}`;
  } catch (error) {
    return `unreachable (${error instanceof Error ? error.name : "error"})`;
  }
}

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadRpcContract, validate } from "../src/index.ts";

const SEQUENCE_DIR = fileURLToPath(new URL("../examples/rpc-sequences/", import.meta.url));
const files = readdirSync(SEQUENCE_DIR).filter((file) => file.endsWith(".json"));
const contract = loadRpcContract();

type Step =
  | { call: string; params: unknown; result?: unknown; error?: unknown }
  | { event: string; payload: unknown };

interface Sequence {
  spec: string;
  scenario: string;
  steps: Step[];
}

const read = (file: string) => JSON.parse(readFileSync(SEQUENCE_DIR + file, "utf8")) as Sequence;

/** Scenario names under one Gherkin feature of a spec. */
function scenariosOf(specFile: string, feature: string): string[] {
  const spec = readFileSync(new URL(`../../specs/${specFile}`, import.meta.url), "utf8");
  const section = spec.split(`Feature: ${feature}\n`)[1]!.split(/\n```|\nFeature: /)[0]!;
  return [...section.matchAll(/^\s+Scenario: (.+)$/gm)].map((m) => m[1]!.trim());
}

describe("local RPC example sequences", () => {
  it.each(files)("%s uses only contract methods and events, with valid messages", (file) => {
    const sequence = read(file);
    expect(sequence.steps.length).toBeGreaterThan(0);
    for (const [i, step] of sequence.steps.entries()) {
      const at = `${sequence.scenario}, step ${i}`;
      if ("call" in step) {
        const method = contract.methods[step.call];
        expect(method, `${at}: unknown method ${step.call}`).toBeDefined();
        expect(validate(method!.params, step.params).errors, `${at} params`).toEqual([]);
        if (step.result !== undefined) expect(validate(method!.result, step.result).errors, `${at} result`).toEqual([]);
        if (step.error !== undefined) expect(validate(contract.errorData, step.error).errors, `${at} error`).toEqual([]);
      } else {
        const type = contract.events[step.event];
        expect(type, `${at}: unknown event ${step.event}`).toBeDefined();
        expect(validate(type!, step.payload).errors, `${at} payload`).toEqual([]);
      }
    }
  });

  it("cover every SPEC-06 \"Changing the goal mid-task\" scenario", () => {
    const covered = files.map(read).filter((s) => s.spec === "SPEC-06").map((s) => s.scenario);
    expect(covered.sort()).toEqual(scenariosOf("06-user-control.md", "Changing the goal mid-task").sort());
  });
});

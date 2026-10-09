import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateMessagePayload } from "../src/messages.ts";

const SEQUENCE_DIR = fileURLToPath(new URL("../examples/sequences/", import.meta.url));
const files = readdirSync(SEQUENCE_DIR).filter((file) => file.endsWith(".json"));

describe("cross-device example sequences", () => {
  it.each(files)("%s uses valid payloads and matches replyTo to its command", (file) => {
    const sequence = JSON.parse(readFileSync(SEQUENCE_DIR + file, "utf8")) as {
      name: string;
      steps: { id?: string; envelopeType: "command" | "result" | "event"; replyTo?: string; payload: unknown }[];
    };
    const commands = new Set<string>();
    expect(sequence.steps.length).toBeGreaterThan(0);
    for (const step of sequence.steps) {
      expect(validateMessagePayload(step.payload, step.envelopeType).errors, `${sequence.name}: ${JSON.stringify(step.payload)}`).toEqual([]);
      if (step.envelopeType === "command") {
        expect(step.id).toBeDefined();
        commands.add(step.id!);
      }
      if (step.envelopeType === "result") expect(commands.has(step.replyTo ?? "")).toBe(true);
    }
  });
});

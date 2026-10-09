import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validate } from "../src/index.ts";
import { validateMessagePayload } from "../src/messages.ts";

const SEQUENCE_DIR = fileURLToPath(new URL("../examples/sequences/", import.meta.url));
const files = readdirSync(SEQUENCE_DIR).filter((file) => file.endsWith(".json"));

describe("cross-device example sequences", () => {
  it("writes each SPEC-09 edge case as a sequence (OBJ-76)", () => {
    expect(files).toEqual(
      expect.arrayContaining(["mac-offline.json", "mac-busy.json", "approval-timeout.json", "mac-wakes-locked.json", "stop-mac-unreachable.json"]),
    );
  });

  it.each(files)("%s uses valid payloads and matches replyTo to its command", (file) => {
    const sequence = JSON.parse(readFileSync(SEQUENCE_DIR + file, "utf8")) as {
      name: string;
      steps: (
        | { id?: string; envelopeType: "command" | "result" | "event"; replyTo?: string; payload: unknown }
        | { from: "relay"; frame: { messageId?: string } }
      )[];
    };
    const commands = new Set<string>();
    expect(sequence.steps.length).toBeGreaterThan(0);
    for (const step of sequence.steps) {
      // The relay answers some sends itself, for example targetOffline when the other device is away.
      if ("frame" in step) {
        expect(validate("BridgeFrame", step.frame).errors, `${sequence.name}: ${JSON.stringify(step.frame)}`).toEqual([]);
        expect(commands.has(step.frame.messageId ?? "")).toBe(true);
        continue;
      }
      expect(validateMessagePayload(step.payload, step.envelopeType).errors, `${sequence.name}: ${JSON.stringify(step.payload)}`).toEqual([]);
      if (step.envelopeType === "command") {
        expect(step.id).toBeDefined();
        commands.add(step.id!);
      }
      if (step.envelopeType === "result") expect(commands.has(step.replyTo ?? "")).toBe(true);
    }
  });
});

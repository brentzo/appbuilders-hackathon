import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadSchemaFiles, validate } from "../src/index.ts";

const SPEC_11 = new URL("../../specs/11-user-facing-errors.md", import.meta.url);

/** The "Failure" column of the SPEC-11 error copy table, read from the spec itself. */
function spec11Rows(): string[] {
  const section = readFileSync(SPEC_11, "utf8").split("## Error copy")[1]?.split("\n## ")[0] ?? "";
  return section
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| Failure") && !line.startsWith("|---"))
    .map((line) => line.split("|")[1]!.trim());
}

function errorKindSchema() {
  const errors = loadSchemaFiles().find((f) => f.file === "errors.json");
  return errors?.defs["ErrorKind"] as { enum: string[]; "x-specRows": Record<string, string> };
}

describe("ErrorKind", () => {
  it("reads a non-empty table from SPEC-11", () => {
    expect(spec11Rows()).toContain("Other device offline");
    expect(spec11Rows()).toContain("Unexpected");
  });

  it("has a kind for every row of the SPEC-11 error table", () => {
    const covered = Object.values(errorKindSchema()["x-specRows"]);
    expect([...covered].sort()).toEqual([...spec11Rows()].sort());
  });

  it("maps only kinds that exist", () => {
    const kind = errorKindSchema();
    for (const value of Object.keys(kind["x-specRows"])) expect(kind.enum).toContain(value);
  });

  it("is what user-facing errors carry, never raw text", () => {
    expect(validate("UserError", { kind: "otherDeviceOffline", device: "mac-1" }).valid).toBe(true);
    expect(validate("UserError", { kind: "ECONNRESET" }).valid).toBe(false);
    expect(validate("UserError", { kind: "unexpected", message: "TypeError: x is undefined" }).valid).toBe(false);
  });

  it("tells a phone without on-device speech apart from speech in another language", () => {
    expect(validate("UserError", { kind: "speechRecognitionNotSetUp" }).valid).toBe(true);
    expect(errorKindSchema()["x-specRows"]["speechRecognitionNotSetUp"]).toBe("Speech recognition not set up on this phone");
    expect(errorKindSchema()["x-specRows"]["languageNotSupported"]).toBe("Language not supported on this phone");
  });

  it("has a Mac-only kind for a voice that did not load", () => {
    expect(validate("UserError", { kind: "voiceFailedToLoad" }).valid).toBe(true);
    expect(errorKindSchema()["x-specRows"]["voiceFailedToLoad"]).toBe("Voice didn't load (Mac)");
  });

  it("carries the step that could not finish as plain, bounded text", () => {
    expect(validate("UserError", { kind: "stepFailed", step: "Export the deck as a PDF" }).valid).toBe(true);
    expect(validate("UserError", { kind: "stepFailed" }).valid).toBe(true);
    expect(validate("UserError", { kind: "stepFailed", step: "" }).valid).toBe(false);
    expect(validate("UserError", { kind: "stepFailed", step: "x".repeat(201) }).valid).toBe(false);
  });

  it("names the skipped action of a blocked action, optionally (SPEC-07 r5)", () => {
    expect(validate("UserError", { kind: "blockedAction", skippedAction: "click File in Keynote" }).valid).toBe(true);
    // An older harness sends none, and the copy then says "I can't do that".
    expect(validate("UserError", { kind: "blockedAction" }).valid).toBe(true);
    expect(validate("UserError", { kind: "blockedAction", skippedAction: "" }).valid).toBe(false);
    expect(validate("UserError", { kind: "blockedAction", skippedAction: "x".repeat(201) }).valid).toBe(false);
  });
});

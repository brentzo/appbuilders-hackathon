import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Lane } from "@yumi/protocol/types";
import { MemoryLogger } from "../src/log.ts";
import { ModelClient } from "../src/model/client.ts";
import type { ChatRequest } from "../src/model/openai.ts";
import { KEYSTROKE_ACTIONS, LANE_ACTIONS, LANE_COST } from "../src/router/lanes.ts";
import { ACTION } from "../src/worker/actions.ts";
import { workerSystemPrompt } from "../src/worker/prompt.ts";
import { workerOutputSchemaFor } from "../src/worker/schema.ts";
import { runWorkerStep } from "../src/worker/step.ts";
import { checkWorkerOutput } from "../src/worker/validate.ts";
import { exampleWorkerInput, modelConfig } from "./helpers.ts";
import { startMockModelServer, type MockModelServer } from "./mock-model-server.ts";

const LANES: Lane[] = ["helper", "ghost", "main"];
const TYPE = { action: { kind: "type", text: "Lunch with the team" } };
const KEY = { action: { kind: "key", combo: "cmd+s" } };
const SET_VALUE = { action: { kind: "setValue", element: 4, text: "Lunch with the team" } };

function compile(schema: object) {
  const ajv = new Ajv2020.default({ strict: false, allErrors: true });
  addFormats.default(ajv);
  return ajv.compile(schema);
}

describe("lane tool sets (SPEC-03 r7)", () => {
  it("orders lanes by cost: helper, ghost, main", () => {
    expect([...LANES].sort((a, b) => LANE_COST[a] - LANE_COST[b])).toEqual(["helper", "ghost", "main"]);
  });

  it("gives keystroke actions to main only", () => {
    expect(KEYSTROKE_ACTIONS).toEqual([ACTION.type, ACTION.key]);
    for (const lane of LANES) {
      for (const kind of KEYSTROKE_ACTIONS) expect(LANE_ACTIONS[lane].includes(kind)).toBe(lane === "main");
    }
    expect(LANE_ACTIONS.main).toEqual(Object.values(ACTION));
  });

  it("lets a ghost set text through accessibility, and keeps every UI action from a helper", () => {
    expect(LANE_ACTIONS.ghost).toEqual([ACTION.click, ACTION.setValue, ACTION.scroll, ACTION.tool, ACTION.ask, ACTION.finish]);
    expect(LANE_ACTIONS.helper).toEqual([ACTION.tool, ACTION.ask, ACTION.finish]);
  });

  it("never offers a ghost a keystroke in the schema sent to the model", () => {
    const input = exampleWorkerInput();
    const ghost = compile(workerOutputSchemaFor(input, "ghost"));
    expect(ghost(TYPE)).toBe(false);
    expect(ghost(KEY)).toBe(false);
    expect(ghost(SET_VALUE)).toBe(true);

    const main = compile(workerOutputSchemaFor(input, "main"));
    expect(main(TYPE)).toBe(true);
    expect(main(KEY)).toBe(true);
  });

  it("never lists keystrokes in a ghost's prompt", () => {
    expect(workerSystemPrompt("ghost")).not.toMatch(/"kind": "(type|key)"/);
    expect(workerSystemPrompt("ghost")).toContain(`"kind": "${ACTION.setValue}"`);
    expect(workerSystemPrompt("main")).toContain(`"kind": "${ACTION.type}"`);
    expect(workerSystemPrompt("helper")).not.toMatch(/"kind": "(click|setValue|scroll|type|key)"/);
  });

  it("rejects a keystroke from a ghost and points it at setValue", () => {
    for (const reply of [TYPE, KEY]) {
      const check = checkWorkerOutput(JSON.stringify(reply), exampleWorkerInput(), "ghost");
      expect(check.ok).toBe(false);
      if (!check.ok) expect(check.error).toContain(ACTION.setValue);
    }
    expect(checkWorkerOutput(JSON.stringify(KEY), exampleWorkerInput(), "main").ok).toBe(true);
  });
});

describe("a ghost's worker step", () => {
  let server: MockModelServer;
  let logger: MemoryLogger;
  let client: ModelClient;

  beforeEach(async () => {
    server = await startMockModelServer();
    logger = new MemoryLogger();
    client = new ModelClient(modelConfig(server.baseUrl), logger);
  });

  afterEach(async () => {
    await server.close();
  });

  it("never runs a keystroke, even when the model sends one twice", async () => {
    // A server that ignores response_format can still return a keystroke; validation catches it.
    server.reply({ kind: "content", content: JSON.stringify(TYPE) });
    server.reply({ kind: "content", content: JSON.stringify(KEY) });

    const result = await runWorkerStep(exampleWorkerInput(), { client, logger }, { lane: "ghost" });

    expect(result.outcome).toBe("invalidOutput");
    const request = server.requests[0] as unknown as ChatRequest;
    const schema = JSON.stringify(request.response_format?.json_schema.schema);
    expect(schema).not.toContain("TypeTextAction");
    expect(schema).not.toContain("KeyAction");
  });

  it("returns a setValue", async () => {
    server.reply({ kind: "content", content: JSON.stringify(SET_VALUE) });
    const result = await runWorkerStep(exampleWorkerInput(), { client, logger }, { lane: "ghost" });
    expect(result.outcome).toBe("ok");
  });
});

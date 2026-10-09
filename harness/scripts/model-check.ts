// Checks the harness against the real local model server.
//   npm run model:check                    send the protocol's example step and print the validated action
//   npm run model:check -- --image a.png   send an image and print what the model sees, to confirm vision works
//   npm run model:check -- --print-schema  print the WorkerOutput schema sent for the example step, then exit
// The server must already be running (see harness/README.md). Configuration comes from the same environment
// variables as the harness (src/config.ts). Log lines go to stderr.
import { readFileSync } from "node:fs";
import type { WorkerInput } from "@yumi/protocol/types";
import { loadConfig } from "../src/config.ts";
import type { LogEntry, Logger } from "../src/log.ts";
import { imagePart, ModelClient } from "../src/model/client.ts";
import { runWorkerStep } from "../src/worker/step.ts";
import { workerOutputSchemaFor } from "../src/worker/schema.ts";

const args = process.argv.slice(2);
const flag = (name: string) => args.indexOf(name);

const stderrLogger: Logger = {
  info: (event, fields) => log("info", event, fields),
  warn: (event, fields) => log("warn", event, fields),
  error: (event, fields) => log("error", event, fields),
};
function log(level: LogEntry["level"], event: string, fields: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ time: new Date().toISOString(), level, event, ...fields }));
}

const input = JSON.parse(
  readFileSync(new URL("../../protocol/examples/WorkerInput.keynote-export.json", import.meta.url), "utf8"),
) as WorkerInput;
/** The main lane offers every action, so the check covers the whole action schema. */
const LANE = "main";

if (flag("--print-schema") >= 0) {
  console.log(JSON.stringify(workerOutputSchemaFor(input, LANE), null, 2));
  process.exit(0);
}

const config = loadConfig();
const client = new ModelClient(config.model, stderrLogger);
console.error(`Model server: ${config.model.baseUrl}, model: ${config.model.model}`);

const imageAt = flag("--image");
if (imageAt >= 0) {
  const path = args[imageAt + 1];
  if (!path) throw new Error("--image needs a PNG, JPEG, or WebP file");
  const reply = await client.chat({
    messages: [
      {
        role: "user",
        content: [await imagePart({ path }), { type: "text", text: "Describe this image in one or two sentences." }],
      },
    ],
    purpose: "visionCheck",
  });
  if (!reply.ok) {
    console.error(`FAILED: ${reply.failure.kind}`);
    process.exit(1);
  }
  console.log(reply.content);
  console.error(`OK in ${reply.durationMs} ms, ${reply.usage.promptTokens} prompt tokens (an image adds hundreds).`);
  process.exit(0);
}

const result = await runWorkerStep(input, { client, logger: stderrLogger }, { lane: LANE });
console.log(JSON.stringify(result, null, 2));
if (result.outcome !== "ok") {
  console.error(`FAILED: ${result.outcome}`);
  process.exit(1);
}
console.error(`OK: validated action ${result.output.action.kind} after ${result.attempts.length} attempt(s).`);

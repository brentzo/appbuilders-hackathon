import { describe, expect, it } from "vitest";
import { liveScenarios, runLiveCheck } from "../scripts/live-check/scenarios.ts";
import { openRelayFixture } from "./support/relay-fixture.ts";

// The live check (`npm run live-check`) runs these scenarios against the deployed relay for OBJ-30.
// Here they run against a local relay whose clock the test moves, so the check itself is tested.
describe("live check (OBJ-30)", () => {
  it("passes every scenario against a relay that follows protocol/docs/pairing.md", async () => {
    let offset = 0;
    const fixture = await openRelayFixture(undefined, () => new Date(Date.now() + offset));
    try {
      const results = await runLiveCheck(fixture.relay.url(), {
        advance: async (ms) => {
          offset += ms;
        },
      });
      expect(results.map(({ name, ok, detail }) => ({ name, ok, detail }))).toEqual(
        liveScenarios.map(({ name }) => ({ name, ok: true, detail: "" })),
      );
    } finally {
      await fixture.close();
    }
  }, 60_000);

  it("reports a relay it cannot reach as a failed scenario, never a crash", async () => {
    const results = await runLiveCheck("ws://127.0.0.1:9/", { advance: async () => undefined }, ["Devices authenticate"]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: "Devices authenticate", ok: false });
    expect(results[0]!.detail).not.toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { liveScenarios, runLiveCheck, type Scenario } from "../scripts/live-check/scenarios.ts";
import { openRelayFixture } from "./support/relay-fixture.ts";

// The live check (`npm run live-check`) runs these scenarios against the deployed relay for OBJ-30.
// Here they run against a local relay whose clock the test moves, so the check itself is tested.
describe("live check (OBJ-30)", () => {
  it("passes every scenario against a relay that follows protocol/docs/pairing.md, and leaves nothing behind", async () => {
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
      expect(fixture.relay.store.queuedCount()).toBe(0);
    } finally {
      await fixture.close();
    }
  }, 120_000);

  it("reports a relay it cannot reach as a failed scenario, never a crash", async () => {
    const results = await runLiveCheck("ws://127.0.0.1:9/", { advance: async () => undefined }, { only: ["Devices authenticate"] });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: "Devices authenticate", ok: false });
    expect(results[0]!.detail).not.toBe("");
  });

  it("reports when cleanup cannot remove a test pairing", async () => {
    // The relay's clock runs two minutes ahead, so it drops the cleanup's unpair as older than the pairing (OBJ-48).
    const fixture = await openRelayFixture(undefined, () => new Date(Date.now() + 120_000));
    const pairsAndStops: Scenario = { name: "pairs and stops", spec: "cleanup", run: async (run) => void (await run.paired()) };
    try {
      const results = await runLiveCheck(fixture.relay.url(), { advance: async () => undefined }, { scenarios: [pairsAndStops] });
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({ ok: false });
      expect(results[0]!.detail).toMatch(/cleanup failed/i);
    } finally {
      await fixture.close();
    }
  });
});

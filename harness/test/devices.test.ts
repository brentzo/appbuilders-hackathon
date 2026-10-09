import { describe, expect, it } from "vitest";
import { describePhoneTool } from "../src/bridge-client/phone-tools.ts";
import { appScreenLock, wakeAddresses } from "../src/device.ts";
import { describeToolRun } from "../src/scheduler/describe.ts";

/** The small parts of SPEC-09 on the Mac: the phone's log lines, the `phone` tool, and what the Mac says about itself. */

describe("phone calls in the action log (SPEC-07 r18, SPEC-09 r2)", () => {
  it("names each phone tool in plain language, with times in am and pm", () => {
    const phone = (call: Record<string, unknown>, ok = true) =>
      describeToolRun({ tool: "phone", call } as unknown as Parameters<typeof describeToolRun>[0], ok);
    expect(phone({ tool: "set_alarm", time: "06:30" })).toBe("Set an alarm for 6:30 am on your phone");
    expect(phone({ tool: "set_alarm", time: "18:05" })).toBe("Set an alarm for 6:05 pm on your phone");
    expect(phone({ tool: "set_alarm", time: "00:15" })).toBe("Set an alarm for 12:15 am on your phone");
    expect(phone({ tool: "set_alarm", time: "12:00" })).toBe("Set an alarm for 12:00 pm on your phone");
    expect(phone({ tool: "set_timer", seconds: 600 })).toBe("Started a timer for 10 minutes on your phone");
    expect(phone({ tool: "set_timer", seconds: 3600 })).toBe("Started a timer for 1 hour on your phone");
    expect(phone({ tool: "set_timer", seconds: 90 })).toBe("Started a timer for 90 seconds on your phone");
    expect(phone({ tool: "open_app", app: "Spotify" })).toBe("Opened Spotify on your phone");
    expect(phone({ tool: "set_alarm", time: "06:30" }, false)).toBe("Tried to set an alarm for 6:30 am on your phone");
  });

  it("describes the one phone tool from the phone's own list", () => {
    const text = describePhoneTool([
      {
        name: "set_alarm",
        description: "Set an alarm on this phone.",
        arguments: [
          { name: "time", type: "string", required: true, description: "Time.", format: "HH:MM" },
          { name: "label", type: "string", required: false, description: "Label." },
        ],
      },
    ]);
    expect(text).toContain("set_alarm(time: string (HH:MM), label?: string): Set an alarm on this phone.");
  });
});

describe("what this Mac tells the phone (SPEC-09 r19, r20)", () => {
  it("offers the hardware addresses of its Wi-Fi and Ethernet ports, never loopback, virtual, or zero ones", () => {
    const entry = (mac: string, internal = false) => ({
      address: "192.168.1.5",
      netmask: "255.255.255.0",
      family: "IPv4" as const,
      mac,
      internal,
      cidr: null,
    });
    expect(
      wakeAddresses({
        lo0: [entry("00:00:00:00:00:00", true)],
        en0: [entry("A4:83:E7:1C:2B:9F"), { ...entry("a4:83:e7:1c:2b:9f"), family: "IPv6" as const, scopeid: 0 }],
        en5: [entry("00:00:00:00:00:00")],
        en1: [entry("3c:22:fb:00:12:ab")],
        awdl0: [entry("de:ad:be:ef:00:01")],
        utun3: [entry("ff:ff:ff:ff:ff:ff")],
      }),
    ).toEqual(["a4:83:e7:1c:2b:9f", "3c:22:fb:00:12:ab"]);
  });

  it("asks the Mac app whether the screen is locked, and runs nothing itself (SPEC-07 r3)", async () => {
    const asked: string[] = [];
    const lock = (locked: boolean) =>
      appScreenLock({
        request: (method) => {
          asked.push(method);
          return Promise.resolve({ locked });
        },
      });
    expect(await lock(true).isLocked()).toBe(true);
    expect(await lock(false).isLocked()).toBe(false);
    expect(asked).toEqual(["getScreenLock", "getScreenLock"]);
  });
});

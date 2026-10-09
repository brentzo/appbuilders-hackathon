import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import type { ScreenLockState } from "@yumi/protocol/types";

/**
 * The device id the Mac app and the harness used for this Mac before they knew its bridge device id (OBJ-17,
 * OBJ-64). Tasks and action log lines saved with it are still this Mac's, and the app sends it until the harness
 * reports the real id.
 */
export const LEGACY_MAC_DEVICE_ID = "mac-local";

const ZERO = "00:00:00:00:00:00";

/**
 * The hardware addresses of this Mac's Wi-Fi and Ethernet ports (`en0`, `en1`, and so on), which the phone can wake it
 * on with Wake-on-LAN over the same network (SPEC-09 r19, OBJ-80). Loopback, virtual, and all-zero addresses are left
 * out.
 */
export function wakeAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const found = new Set<string>();
  for (const [name, entries] of Object.entries(interfaces)) {
    if (!/^en\d+$/.test(name)) continue;
    for (const entry of entries ?? []) {
      const mac = entry.mac.toLowerCase();
      if (entry.internal || mac === ZERO || !/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) continue;
      found.add(mac);
    }
  }
  return [...found];
}

/** Whether this Mac's screen is locked, so the cursor cannot work (SPEC-09 r20). */
export interface ScreenLock {
  isLocked(): Promise<boolean>;
}

/**
 * The screen lock, as the Mac app reads it from the console session (`getScreenLock`, OBJ-80). The harness runs
 * nothing itself to find out (SPEC-07 r3), and never reads, stores, or types a password.
 */
export function appScreenLock(app: { request(method: string, params: unknown): Promise<unknown> }): ScreenLock {
  return { isLocked: async () => ((await app.request("getScreenLock", {})) as ScreenLockState).locked };
}

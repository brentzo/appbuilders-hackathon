/**
 * The device id the Mac app and the harness used for this Mac before they knew its bridge device id (OBJ-17,
 * OBJ-64). Tasks and action log lines saved with it are still this Mac's, and the app sends it until the harness
 * reports the real id.
 */
export const LEGACY_MAC_DEVICE_ID = "mac-local";

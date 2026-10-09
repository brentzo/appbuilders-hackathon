import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { BridgeFrame, Envelope } from "@yumi/protocol/types";

export interface PendingDelivery {
  rowid: number;
  recipient: string;
  sender: string;
  messageId: string;
  category: "envelope" | "notice";
  frame: string;
  expiresAt: string;
}

export class RelayStore {
  private readonly db: Database.Database;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("busy_timeout = 5000");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS devices (
        device_id TEXT PRIMARY KEY,
        signing_key TEXT NOT NULL,
        registered_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pairings (
        device_a TEXT NOT NULL REFERENCES devices(device_id),
        device_b TEXT NOT NULL REFERENCES devices(device_id),
        paired_at TEXT NOT NULL,
        PRIMARY KEY (device_a, device_b),
        CHECK (device_a < device_b)
      );
      CREATE TABLE IF NOT EXISTS pending_pairs (
        from_device TEXT NOT NULL REFERENCES devices(device_id),
        to_device TEXT NOT NULL,
        sealed TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (from_device, to_device)
      );
      CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipient TEXT NOT NULL REFERENCES devices(device_id),
        sender TEXT NOT NULL,
        message_id TEXT NOT NULL,
        category TEXT NOT NULL CHECK (category IN ('envelope', 'notice')),
        frame TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (recipient, message_id, category)
      );
      CREATE INDEX IF NOT EXISTS deliveries_recipient_order ON deliveries(recipient, created_at, id);
      CREATE TABLE IF NOT EXISTS seen_messages (
        sender TEXT NOT NULL,
        message_id TEXT NOT NULL,
        recipient TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (sender, message_id)
      );
      CREATE TABLE IF NOT EXISTS pending_unpairs (
        from_device TEXT NOT NULL REFERENCES devices(device_id),
        to_device TEXT NOT NULL REFERENCES devices(device_id),
        frame TEXT NOT NULL,
        at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged IN (0, 1)),
        PRIMARY KEY (from_device, to_device)
      );
    `);
    const unpairColumns = this.db.prepare("PRAGMA table_info(pending_unpairs)").all() as Array<{ name: string }>;
    if (!unpairColumns.some(({ name }) => name === "acknowledged"))
      this.db.exec("ALTER TABLE pending_unpairs ADD COLUMN acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged IN (0, 1))");
    if (process.platform !== "win32") chmodSync(path, 0o600);
  }

  close(): void {
    if (this.db.open) this.db.close();
  }

  registerDevice(deviceId: string, signingKey: string, now: string): boolean {
    const existing = this.signingKey(deviceId);
    if (existing !== undefined) return existing === signingKey;
    this.db.prepare("INSERT INTO devices (device_id, signing_key, registered_at) VALUES (?, ?, ?)").run(deviceId, signingKey, now);
    return true;
  }

  signingKey(deviceId: string): string | undefined {
    return (this.db.prepare("SELECT signing_key FROM devices WHERE device_id = ?").get(deviceId) as { signing_key: string } | undefined)?.signing_key;
  }

  isPaired(a: string, b: string): boolean {
    const [deviceA, deviceB] = sortPair(a, b);
    return this.db.prepare("SELECT 1 FROM pairings WHERE device_a = ? AND device_b = ?").get(deviceA, deviceB) !== undefined;
  }

  pairedAt(a: string, b: string): string | undefined {
    const [deviceA, deviceB] = sortPair(a, b);
    return (this.db.prepare("SELECT paired_at FROM pairings WHERE device_a = ? AND device_b = ?").get(deviceA, deviceB) as { paired_at: string } | undefined)?.paired_at;
  }

  pair(a: string, b: string, at: string): void {
    const [deviceA, deviceB] = sortPair(a, b);
    this.db.transaction(() => {
      this.db.prepare("INSERT INTO pairings (device_a, device_b, paired_at) VALUES (?, ?, ?) ON CONFLICT(device_a, device_b) DO UPDATE SET paired_at = excluded.paired_at").run(deviceA, deviceB, at);
      this.deletePairDeliveries(a, b);
      this.db.prepare("DELETE FROM pending_unpairs WHERE (from_device = ? AND to_device = ?) OR (from_device = ? AND to_device = ?)").run(a, b, b, a);
    })();
  }

  unpair(a: string, b: string): void {
    const [deviceA, deviceB] = sortPair(a, b);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM pairings WHERE device_a = ? AND device_b = ?").run(deviceA, deviceB);
      this.deletePairDeliveries(a, b);
      this.db.prepare("DELETE FROM pending_pairs WHERE (from_device = ? AND to_device = ?) OR (from_device = ? AND to_device = ?)").run(a, b, b, a);
    })();
  }

  revokeAndRememberUnpair(from: string, to: string, frame: Extract<BridgeFrame, { frame: "unpair" }>, createdAt: string): void {
    const [deviceA, deviceB] = sortPair(from, to);
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM pairings WHERE device_a = ? AND device_b = ?").run(deviceA, deviceB);
      this.deletePairDeliveries(from, to);
      this.db.prepare("DELETE FROM pending_pairs WHERE (from_device = ? AND to_device = ?) OR (from_device = ? AND to_device = ?)").run(from, to, to, from);
      this.db.prepare("INSERT INTO pending_unpairs (from_device, to_device, frame, at, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(from_device, to_device) DO UPDATE SET frame = excluded.frame, at = excluded.at, created_at = excluded.created_at, acknowledged = 0")
        .run(from, to, JSON.stringify(frame), frame.at, createdAt);
    })();
  }

  private deletePairDeliveries(a: string, b: string): void {
    this.db.prepare("DELETE FROM deliveries WHERE (recipient = ? AND sender = ?) OR (recipient = ? AND sender = ?)").run(a, b, b, a);
    this.db.prepare("DELETE FROM seen_messages WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)").run(a, b, b, a);
  }

  rememberPairRequest(from: string, to: string, sealed: string, createdAt: string, expiresAt: string): void {
    this.db.prepare("INSERT INTO pending_pairs VALUES (?, ?, ?, ?, ?) ON CONFLICT(from_device, to_device) DO UPDATE SET sealed = excluded.sealed, created_at = excluded.created_at, expires_at = excluded.expires_at")
      .run(from, to, sealed, createdAt, expiresAt);
  }

  pendingPairRequest(from: string, to: string, now: string): { sealed: string; createdAt: string } | undefined {
    const row = this.db.prepare("SELECT sealed, created_at FROM pending_pairs WHERE from_device = ? AND to_device = ? AND expires_at > ?")
      .get(from, to, now) as { sealed: string; created_at: string } | undefined;
    return row ? { sealed: row.sealed, createdAt: row.created_at } : undefined;
  }

  pendingPairRequests(to: string, now: string): Array<{ fromDevice: string; sealed: string }> {
    return this.db.prepare("SELECT from_device AS fromDevice, sealed FROM pending_pairs WHERE to_device = ? AND expires_at > ? ORDER BY created_at, rowid")
      .all(to, now) as Array<{ fromDevice: string; sealed: string }>;
  }

  /** Deletes a pairing request, open or past its window. Returns whether there was one. */
  finishPairRequest(from: string, to: string): boolean {
    return this.db.prepare("DELETE FROM pending_pairs WHERE from_device = ? AND to_device = ?").run(from, to).changes > 0;
  }

  /** Holds a pairing verdict for a device that is offline. One per pair of devices: the newest replaces the last. */
  queuePairingNotice(recipient: string, frame: Extract<BridgeFrame, { frame: "paired" | "pairExpired" }>, expiresAt: string, createdAt: string): void {
    this.queueNotice(recipient, frame.device, pairingNoticeId(frame.device), frame, expiresAt, createdAt);
  }

  /**
   * Forgets the pairExpired verdicts held for either device about the other, so an old one cannot close a new
   * attempt. A held paired verdict stays: the two are paired, and the Mac must still learn it.
   */
  clearPairingNotices(a: string, b: string): void {
    this.db.prepare("DELETE FROM deliveries WHERE category = 'notice' AND json_extract(frame, '$.frame') = 'pairExpired' AND ((recipient = ? AND message_id = ?) OR (recipient = ? AND message_id = ?))")
      .run(a, pairingNoticeId(b), b, pairingNoticeId(a));
  }

  /** Whether the device has ever authenticated, so the relay can hold frames for it. */
  isRegistered(deviceId: string): boolean {
    return this.signingKey(deviceId) !== undefined;
  }

  hasSeen(sender: string, messageId: string): boolean {
    return this.db.prepare("SELECT 1 FROM seen_messages WHERE sender = ? AND message_id = ?").get(sender, messageId) !== undefined;
  }

  markSeen(envelope: Envelope): void {
    this.db.prepare("INSERT OR REPLACE INTO seen_messages VALUES (?, ?, ?, ?)").run(envelope.from, envelope.id, envelope.to, envelope.expiresAt);
  }

  queueEnvelope(envelope: Envelope, frame: BridgeFrame, createdAt: string): boolean {
    const result = this.db.prepare("INSERT OR IGNORE INTO deliveries (recipient, sender, message_id, category, frame, expires_at, created_at) VALUES (?, ?, ?, 'envelope', ?, ?, ?)")
      .run(envelope.to, envelope.from, envelope.id, JSON.stringify(frame), envelope.expiresAt, createdAt);
    return result.changes > 0;
  }

  queueNotice(recipient: string, sender: string, messageId: string, frame: BridgeFrame, expiresAt: string, createdAt: string): void {
    this.db.prepare("INSERT INTO deliveries (recipient, sender, message_id, category, frame, expires_at, created_at) VALUES (?, ?, ?, 'notice', ?, ?, ?) ON CONFLICT(recipient, message_id, category) DO UPDATE SET frame = excluded.frame, expires_at = excluded.expires_at, created_at = excluded.created_at")
      .run(recipient, sender, messageId, JSON.stringify(frame), expiresAt, createdAt);
  }

  queued(recipient: string): PendingDelivery[] {
    return this.db.prepare("SELECT id AS rowid, recipient, sender, message_id AS messageId, category, frame, expires_at AS expiresAt FROM deliveries WHERE recipient = ? ORDER BY created_at, id")
      .all(recipient) as PendingDelivery[];
  }

  findEnvelopeDelivery(recipient: string, messageId: string): PendingDelivery | undefined {
    return this.db.prepare("SELECT id AS rowid, recipient, sender, message_id AS messageId, category, frame, expires_at AS expiresAt FROM deliveries WHERE recipient = ? AND message_id = ? AND category = 'envelope'")
      .get(recipient, messageId) as PendingDelivery | undefined;
  }

  deleteDelivery(rowid: number): void {
    this.db.prepare("DELETE FROM deliveries WHERE id = ?").run(rowid);
  }

  pendingUnpairs(to: string): string[] {
    return (this.db.prepare("SELECT frame FROM pending_unpairs WHERE to_device = ? AND acknowledged = 0 ORDER BY created_at, from_device").all(to) as { frame: string }[]).map(({ frame }) => frame);
  }

  pendingUnpair(from: string, to: string): { frame: string; acknowledged: boolean } | undefined {
    const row = this.db.prepare("SELECT frame, acknowledged FROM pending_unpairs WHERE from_device = ? AND to_device = ?")
      .get(from, to) as { frame: string; acknowledged: number } | undefined;
    return row ? { frame: row.frame, acknowledged: row.acknowledged === 1 } : undefined;
  }

  acknowledgeUnpair(from: string, to: string, messageId: string): boolean {
    const row = this.pendingUnpair(from, to);
    if (!row || (JSON.parse(row.frame) as Extract<BridgeFrame, { frame: "unpair" }>).id !== messageId) return false;
    this.db.prepare("UPDATE pending_unpairs SET acknowledged = 1 WHERE from_device = ? AND to_device = ?").run(from, to);
    return true;
  }

  queuedCount(): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM deliveries").get() as { count: number }).count;
  }

  isPendingPair(from: string, to: string): boolean {
    return this.pendingPairRequest(from, to, new Date(0).toISOString()) !== undefined;
  }

  sweep(now: string): { expiredDeliveries: PendingDelivery[]; expiredPairRequests: PairRoute[]; deleted: number } {
    return this.db.transaction(() => {
      const expiredDeliveries = this.db.prepare("SELECT id AS rowid, recipient, sender, message_id AS messageId, category, frame, expires_at AS expiresAt FROM deliveries WHERE expires_at <= ? ORDER BY created_at, id")
        .all(now) as PendingDelivery[];
      const expiredPairRequests = this.db.prepare("SELECT from_device AS fromDevice, to_device AS toDevice FROM pending_pairs WHERE expires_at <= ? ORDER BY created_at, rowid")
        .all(now) as PairRoute[];
      this.db.prepare("DELETE FROM deliveries WHERE expires_at <= ?").run(now);
      this.db.prepare("DELETE FROM pending_pairs WHERE expires_at <= ?").run(now);
      this.db.prepare("DELETE FROM seen_messages WHERE expires_at <= ?").run(now);
      return { expiredDeliveries, expiredPairRequests, deleted: expiredDeliveries.length };
    })();
  }
}

export interface PairRoute {
  fromDevice: string;
  toDevice: string;
}

function sortPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/** Pairing verdicts share the notice queue, keyed by the other device instead of a message id. */
function pairingNoticeId(other: string): string {
  return `pairing:${other}`;
}

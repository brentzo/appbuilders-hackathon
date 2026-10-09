import { basename, dirname } from "node:path";
import type { FileSummary } from "@yumi/protocol/types";

/**
 * The approval text the user hears and sees on a card (SPEC-07 r10, r13, and the "Draft copy" table), in one place
 * so the draft can change here alone. Built only from what the harness read itself: the real To and Cc fields and
 * the real file list. Never from model text.
 *
 * The SPEC-07 "Draft copy" table is a draft for Patrick's review (SPEC-07 Open questions); the forms below follow
 * it until it is final.
 */

/** What is being sent: an email (Mail) or a message (Messages and other chat apps). */
export type SendKind = "email" | "message";

/**
 * Recipients as the user would say them (SPEC-07 "Draft copy"): "Ana", "Ana and Ben", "Ana, Ben, and Carla", and
 * for more than 3, "Ana, Ben, and 3 others".
 */
export function listNames(names: readonly string[]): string {
  if (names.length === 0) throw new Error("listNames needs at least one name");
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]}, and ${names[2]}`;
  return `${names[0]}, ${names[1]}, and ${names.length - 2} others`;
}

/**
 * "I'm about to send this email to Ana. Should I send it?" (SPEC-07 r13), with "with a copy to {cc names}" when Cc
 * has anyone (email only), and "this message" for Messages.
 */
export function sendText(kind: SendKind, to: readonly string[], cc: readonly string[] = []): string {
  const what = kind === "email" ? "this email" : "this message";
  const copy = kind === "email" && cc.length > 0 ? `, with a copy to ${listNames(cc)}` : "";
  return `I'm about to send ${what} to ${listNames(to)}${copy}. Should I send it?`;
}

/**
 * The delete card's text (SPEC-07 "Strict delete" and "Draft copy"), from the real file list:
 *
 * - one file: "I'm about to move old-invoice.pdf from Downloads to the Trash. Should I delete it?"
 * - files in one folder: "I'm about to move 12 files from Downloads to the Trash, starting with old-invoice.pdf.
 *   Should I delete them?"
 * - files in several folders: "I'm about to move 12 files from 3 folders to the Trash, starting with
 *   old-invoice.pdf in Downloads. Should I delete them?"
 *
 * A folder is named by its own name, as Finder shows it. The first file is the first of `allPaths`, which is also
 * the first name the card lists.
 */
export function deleteText(files: FileSummary): string {
  const first = files.allPaths[0]!;
  const folders = new Set(files.allPaths.map((path) => dirname(path)));
  if (files.count === 1) {
    return `I'm about to move ${basename(first)} from ${folderName(dirname(first))} to the Trash. Should I delete it?`;
  }
  if (folders.size === 1) {
    return `I'm about to move ${files.count} files from ${folderName(dirname(first))} to the Trash, starting with ${basename(first)}. Should I delete them?`;
  }
  return `I'm about to move ${files.count} files from ${folders.size} folders to the Trash, starting with ${basename(first)} in ${folderName(dirname(first))}. Should I delete them?`;
}

function folderName(folder: string): string {
  return basename(folder) || folder;
}

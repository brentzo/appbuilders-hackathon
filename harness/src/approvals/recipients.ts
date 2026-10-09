import type { AXRole, Observation } from "@yumi/protocol/types";
import { normalizeLabel } from "../safety/rules.ts";
import type { SendKind } from "./copy.ts";

/**
 * Where the recipients of a send are, and how to read them (SPEC-07 r13, r14). The harness finds the To and Cc
 * fields in the real accessibility tree by role and label, reads their values through the Mac app's
 * `readFieldValues`, and builds the approval from those values. Nothing here reads model text.
 */

/** Apps whose sends the harness can approve, what each sends, and which fields hold its recipients. */
export const SEND_APPS: readonly { app: string; kind: SendKind; cc: boolean }[] = [
  { app: "Mail", kind: "email", cc: true },
  { app: "Messages", kind: "message", cc: false },
];

/** The roles an address field can have in the trimmed tree. */
const FIELD_ROLES: readonly AXRole[] = ["textField", "textArea", "comboBox"];

/**
 * The element numbers of the To and Cc fields in an observation, matched by role and by a label of "To" or "Cc",
 * with or without a colon. The step loop resolves them to element paths, as it does for the element it acts on.
 */
export function findRecipientFields(observation: Observation): { to: number[]; cc: number[] } {
  const fields = observation.elements.filter((element) => FIELD_ROLES.includes(element.role));
  const labelled = (name: string) =>
    fields.filter((element) => normalizeLabel(element.label).replace(/:$/, "").trim() === name).map((element) => element.n);
  return { to: labelled("to"), cc: labelled("cc") };
}

/** What a send in this app is, or undefined for an app whose recipients the harness cannot read. */
export function sendApp(app: string | undefined): (typeof SEND_APPS)[number] | undefined {
  return app === undefined ? undefined : SEND_APPS.find((entry) => normalizeLabel(entry.app) === normalizeLabel(app));
}

/**
 * The recipients in one field's text, in order. The Mac app reads Mail's address tokens joined with ", "
 * (`GuiExecutor.fieldText`), and people type commas or semicolons between addresses. Each recipient is kept as the
 * field shows it, so an address the model did not mention is named exactly as it is (SPEC-07 "Approval text comes
 * from the real recipients").
 */
export function parseRecipients(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(/[,;\n]/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);
}

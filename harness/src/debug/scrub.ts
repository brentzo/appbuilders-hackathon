import type { Observation } from "@yumi/protocol/types";
import { ACTION } from "../worker/actions.ts";

/**
 * Keeps password text out of the debug log (SPEC-07 r20 and r22). The Mac app never reads a secure field's value,
 * and the step validation refuses to type or set text into one, but the model's reply that asked for it still holds
 * the text, and so can a later prompt that lists it as a recent step. So for one subtask, the scrubber learns the
 * text of every `type` or `setValue` that could reach a password field, and removes it from every debug log line
 * written for that subtask, in plain and JSON-escaped form.
 *
 * Could reach a password field: `setValue` on a `secureTextField`, or `type` while one has focus, or while focus is
 * unknown and one is on screen.
 */

export const PASSWORD_REMOVED = "[password field text removed]";

export class PasswordScrubber {
  private readonly secrets = new Set<string>();

  /** Learns the text of `action` if it could go into a password field on this screen. */
  learn(action: unknown, observation: Observation): void {
    const text = passwordFieldText(action, observation);
    if (text !== undefined && text !== "") this.secrets.add(text);
  }

  /**
   * A model reply for the debug log: learns from it, then removes what it learned. A reply that is not JSON while a
   * password field is on screen could hold anything, so only its length is kept.
   */
  reply(content: string | null, observation: Observation): string | null {
    if (content === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(content);
    } catch {
      return hasPasswordField(observation)
        ? `[reply not logged: it is not JSON and a password field is on screen; ${content.length} characters]`
        : this.scrub(content);
    }
    this.learn((value as { action?: unknown } | null)?.action, observation);
    return this.scrub(content);
  }

  /** Removes every learned text from a line or a reply. */
  readonly scrub = (line: string): string => {
    let out = line;
    for (const secret of this.secrets) {
      for (const form of escapedForms(secret)) out = out.split(form).join(PASSWORD_REMOVED);
    }
    return out;
  };
}

/** The text a `type` or `setValue` would put into a password field on this screen, or undefined. */
export function passwordFieldText(action: unknown, observation: Observation): string | undefined {
  if (!action || typeof action !== "object") return undefined;
  const { kind, text, element } = action as { kind?: unknown; text?: unknown; element?: unknown };
  if (typeof text !== "string") return undefined;
  const roleOf = (n: unknown) => observation.elements.find((e) => e.n === n)?.role;
  if (kind === ACTION.setValue) return roleOf(element) === "secureTextField" ? text : undefined;
  if (kind === ACTION.type) {
    const focused = observation.focused === undefined ? undefined : roleOf(observation.focused);
    if (focused === "secureTextField") return text;
    if (focused === undefined && hasPasswordField(observation)) return text;
  }
  return undefined;
}

export function hasPasswordField(observation: Observation): boolean {
  return observation.elements.some((e) => e.role === "secureTextField");
}

/** The text as written, inside one JSON string, and inside a JSON string that is itself inside one (a prompt). */
function escapedForms(text: string): string[] {
  const once = JSON.stringify(text).slice(1, -1);
  const twice = JSON.stringify(once).slice(1, -1);
  return [...new Set([twice, once, text])];
}

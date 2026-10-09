/**
 * The words `gui_act` says to the user, in one place. Each line is copied exactly from its spec, and a test checks
 * it still matches. The harness sends them as the text of a `questionAsked` event; the app shows and speaks them.
 */

/**
 * SPEC-07 "Draft copy", "Asking the user to type a password" (SPEC-05 r7). A draft until Patrick reviews it. The
 * app shows the "Done" and "Stop" buttons.
 */
export const PASSWORD_QUESTION =
  "This needs your password, so please type it yourself. I won't read it. Tell me when you're done.";

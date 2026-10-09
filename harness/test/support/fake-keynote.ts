import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelAction } from "@yumi/protocol/types";
import type { ActResult, FakeAppModel, FakeElement, FakeScreen } from "./fake-mac.ts";

/**
 * Keynote as the OBJ-26 round 3 smoke test saw it ("Round 3" in models/gui/SMOKE-TEST.md): File, Export To, PDF…,
 * the "Export Your Presentation" sheet with "Save…" as its default button, then the save panel with its "Save As:"
 * field and "Export". After Export the save sheet stays in the tree, with only its Cancel button, for a few looks
 * while it closes, and pressing that Cancel fails because the sheet is already gone.
 */

export const KEYNOTE = "com.apple.Keynote";

const MENU_BAR = ["Apple", "Keynote", "File", "Edit", "Insert", "Slide", "Format", "Arrange", "View", "Play", "Window", "Help"];
const FILE_MENU = ["New…", "Open…", "Open Recent", "Close", "Save", "Duplicate", "Export To"];
const EXPORT_MENU = ["PDF…", "PowerPoint…", "Movie…", "Animated GIF…", "Images…"];

type State = "deck" | "fileMenu" | "exportMenu" | "exportSheet" | "savePanel";

export interface FakeKeynoteOptions {
  home: string;
  /** Where Export saves, under the home folder. */
  folder?: string;
  /** How many looks after Export still show the closing save sheet. Round 3 saw it 1 second after Export. */
  closingLooks?: number;
  /** The deck's name, which is the window title and the save panel's first name. Defaults to "Quarterly Review". */
  deck?: string;
  /** More elements in the deck window, for example to reach the 200-element cap. */
  extra?: FakeElement[];
}

export class FakeKeynote implements FakeAppModel {
  readonly bundleId = KEYNOTE;
  readonly name = "Keynote";
  state: State = "deck";
  saveAs: string;
  presenterNotes = false;
  closing = 0;
  readonly exported: string[] = [];

  constructor(private readonly options: FakeKeynoteOptions) {
    this.saveAs = options.deck ?? "Quarterly Review";
  }

  screen(): FakeScreen {
    const title = this.options.deck ?? "Quarterly Review";
    const bar = MENU_BAR.map((label): FakeElement => ({ role: "menuBarItem", label }));
    if (this.closing > 0) {
      this.closing--;
      return {
        app: "Keynote",
        title,
        layer: { kind: "sheet", cancelButton: "Cancel" },
        elements: [{ role: "button", label: "Cancel" }, ...bar],
      };
    }
    switch (this.state) {
      case "deck":
        return {
          app: "Keynote",
          title,
          layer: { kind: "window" },
          elements: [
            { role: "button", label: "Play" },
            { role: "button", label: "Add Slide" },
            { role: "checkbox", label: "Include presenter notes", value: this.presenterNotes ? "on" : "off" },
            ...(this.options.extra ?? []),
            ...bar,
          ],
        };
      case "fileMenu":
      case "exportMenu":
        return {
          app: "Keynote",
          title,
          layer: { kind: "menu", title: "File" },
          elements: [
            ...FILE_MENU.map((label): FakeElement => ({ role: "menuItem", label })),
            ...(this.state === "exportMenu" ? EXPORT_MENU.map((label): FakeElement => ({ role: "menuItem", label })) : []),
            ...bar,
          ],
        };
      case "exportSheet":
        return {
          app: "Keynote",
          title,
          layer: { kind: "sheet", defaultButton: "Save…", cancelButton: "Cancel" },
          elements: [
            { role: "radioButton", label: "PDF", value: "on" },
            { role: "radioButton", label: "PowerPoint", value: "off" },
            { role: "checkbox", label: "Include presenter notes", value: "off" },
            { role: "button", label: "Save…" },
            { role: "button", label: "Cancel" },
            ...bar,
          ],
        };
      case "savePanel":
        return {
          app: "Keynote",
          title,
          // The save panel runs in another process and has no AXDefaultButton (round 3).
          layer: { kind: "sheet", cancelButton: "Cancel" },
          focused: "Save As:",
          elements: [
            { role: "textField", label: "Save As:", value: this.saveAs },
            { role: "popUpButton", label: "Where:", value: this.options.folder ?? "Downloads" },
            { role: "button", label: "Cancel" },
            { role: "button", label: "Export" },
            ...bar,
          ],
        };
    }
  }

  onElement(action: ModelAction, element: FakeElement): ActResult | undefined {
    if (action.kind === "setValue" && element.label === "Save As:") {
      this.saveAs = action.text;
      return undefined;
    }
    if (action.kind !== "click") return undefined;
    // The closing sheet's Cancel is already gone: AXPress fails with an invalid element (round 3, failure 1).
    if (this.state === "deck" && element.role === "button" && element.label === "Cancel") {
      return { outcome: "error", observation: 'The button "Cancel" is no longer on screen.' };
    }
    const next: Partial<Record<State, Record<string, () => void>>> = {
      deck: {
        File: () => (this.state = "fileMenu"),
        "Include presenter notes": () => (this.presenterNotes = !this.presenterNotes),
      },
      fileMenu: { "Export To": () => (this.state = "exportMenu"), File: () => (this.state = "deck") },
      exportMenu: { "PDF…": () => (this.state = "exportSheet"), File: () => (this.state = "deck") },
      exportSheet: { "Save…": () => (this.state = "savePanel"), Cancel: () => (this.state = "deck") },
      savePanel: { Export: () => this.export(), Cancel: () => (this.state = "deck") },
    };
    next[this.state]?.[element.label]?.();
    return undefined;
  }

  private export(): void {
    const path = join(this.options.home, this.options.folder ?? "Downloads", `${this.saveAs}.pdf`);
    writeFileSync(path, "%PDF-1.7\n");
    this.exported.push(path);
    this.state = "deck";
    this.closing = this.options.closingLooks ?? 0;
  }
}

/** An app with one static window, for direct tools, password fields, and actions that change nothing. */
export function staticApp(bundleId: string, screen: FakeScreen, onElement?: FakeAppModel["onElement"]): FakeAppModel {
  return { bundleId, name: screen.app, screen: () => structuredClone(screen), ...(onElement ? { onElement } : {}) };
}

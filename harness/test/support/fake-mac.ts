import { connect, type Socket } from "node:net";
import { RpcFailure, RpcPeer, loadRpcContract, type Handler } from "@yumi/protocol";
import {
  PROTOCOL_VERSION,
  type AppCapability,
  type AXRole,
  type ExecuteActionParams,
  type ExecuteActionResult,
  type Layer,
  type ListWindowsParams,
  type ModelAction,
  type Observation,
  type ObserveWindowParams,
  type ReadFieldValuesParams,
  type StepOutcome,
  type TreeElement,
  type UserError,
  type WindowInfo,
} from "@yumi/protocol/types";

/**
 * A scripted Mac app for `gui_act` tests: it connects to the harness's socket like the real Mac app (OBJ-39) and the
 * protocol's mock Mac app, says hello, and serves `observeWindow` and `executeAction` over an app model whose screen
 * changes as it is used. Every params and result is checked against the protocol contract by `RpcPeer`, so it can
 * only send what the real app can.
 *
 * It behaves like `mac/Yumi/GUI/GuiExecutor.swift` where the harness can tell: element numbers resolve against the
 * last observation of the window, an element that is gone or changed role answers outcome `error` with one line, a
 * click on a text field only focuses it, a password field is never filled (`blockedAction`), keystrokes from a ghost
 * cursor are refused (`blockedAction`), and failures are -32000 errors carrying a `UserError`.
 */

export interface FakeElement {
  role: AXRole;
  label: string;
  value?: string;
  enabled?: boolean;
}

export interface FakeScreen {
  app: string;
  title: string;
  layer?: { kind: Layer["kind"]; title?: string; defaultButton?: string; cancelButton?: string };
  /** The label of the focused element. */
  focused?: string;
  /** A screenshot the real Mac app captured because the window has no accessible content (OBJ-75). */
  screenshotPath?: string;
  /** The window frame, in global top-left points, for the moved-window check (SPEC-05 r13). */
  windowFrame?: { x: number; y: number; width: number; height: number };
  elements: FakeElement[];
}

export interface ActResult {
  outcome: StepOutcome;
  observation: string;
}

/** One app as the fake Mac sees it. */
export interface FakeAppModel {
  bundleId: string;
  /** The app's name as the user sees it, for `resolveApp` and `listWindows`, which never look at the screen. */
  name: string;
  /** The screen right now. Called once per `observeWindow`. */
  screen(): FakeScreen;
  /** A click, setValue, or scroll on an element of the last look. Undefined means it ran with the default line. */
  onElement?(action: ModelAction, element: FakeElement): ActResult | undefined;
  /** A key press or typed text from the main cursor. */
  onKeys?(action: ModelAction): ActResult | undefined;
}

export interface ExecutedCall {
  params: ExecuteActionParams;
  /** The element the number resolved to, if any. */
  element?: FakeElement;
}

export interface FakeMac {
  peer: RpcPeer;
  observes: ObserveWindowParams[];
  executed: ExecutedCall[];
  events: { event: string; payload: unknown }[];
  /** Makes the next observeWindow calls fail with this kind (`count` times, default every time). */
  failObserve(kind: UserError["kind"], count?: number): void;
  /** Called with each executeAction before it runs. */
  onExecute?: (params: ExecuteActionParams) => void;
  close(): void;
}

export async function connectFakeMac(socketPath: string, apps: FakeAppModel[]): Promise<FakeMac> {
  const byBundle = new Map(apps.map((app) => [app.bundleId, app]));
  const snapshots = new Map<string, TreeElement[]>();
  const sources = new Map<string, FakeElement[]>();
  const observes: ObserveWindowParams[] = [];
  const executed: ExecutedCall[] = [];
  const events: { event: string; payload: unknown }[] = [];
  const cursors = new Map<string, "main" | "ghost">();
  let observeFailure: { kind: UserError["kind"]; left: number } | undefined;

  const fail = (kind: UserError["kind"], why: string): never => {
    throw new RpcFailure({ kind }, `Fake Mac: ${why}`);
  };
  const appFor = (bundleId: string) => byBundle.get(bundleId) ?? fail("stuckOnScreen", `${bundleId} is not running`);

  const observe = (params: ObserveWindowParams): Observation => {
    observes.push(params);
    if (observeFailure && observeFailure.left !== 0) {
      observeFailure.left--;
      fail(observeFailure.kind, "observe failure on purpose");
    }
    const screen = appFor(params.target.bundleId).screen();
    const elements: TreeElement[] = screen.elements.slice(0, 200).map((element, i) => ({
      n: i + 1,
      role: element.role,
      label: element.label,
      ...(element.value !== undefined && element.role !== "secureTextField" ? { value: element.value } : {}),
      enabled: element.enabled ?? true,
    }));
    const numberOf = (label: string | undefined) =>
      label === undefined ? undefined : elements.find((element) => element.label === label)?.n;
    snapshots.set(params.target.bundleId, elements);
    sources.set(params.target.bundleId, screen.elements.slice(0, 200));
    const focused = numberOf(screen.focused);
    const layer = screen.layer;
    const defaultButton = numberOf(layer?.defaultButton);
    const cancelButton = numberOf(layer?.cancelButton);
    return {
      app: screen.app,
      windowTitle: screen.title,
      ...(focused !== undefined ? { focused } : {}),
      ...(screen.screenshotPath !== undefined ? { screenshotPath: screen.screenshotPath } : {}),
      ...(screen.windowFrame !== undefined ? { windowFrame: screen.windowFrame } : {}),
      ...(layer
        ? {
            layer: {
              kind: layer.kind,
              ...(layer.title !== undefined ? { title: layer.title } : {}),
              ...(defaultButton !== undefined ? { defaultButton } : {}),
              ...(cancelButton !== undefined ? { cancelButton } : {}),
            },
          }
        : {}),
      elements,
    };
  };

  const execute = (params: ExecuteActionParams): ExecuteActionResult => {
    fake.onExecute?.(params);
    const { action } = params.action;
    const app = appFor(params.target.bundleId);
    const result = (outcome: StepOutcome, observation: string) => ({ outcome, observation });
    if (params.action.element?.role === "secureTextField" && (action.kind === "setValue" || action.kind === "type")) {
      fail("blockedAction", "password field");
    }
    switch (action.kind) {
      case "click":
      case "setValue":
      case "scroll": {
        const kept = snapshots.get(params.target.bundleId)?.find((element) => element.n === action.element);
        const source = sources.get(params.target.bundleId)?.[action.element - 1];
        executed.push({ params, ...(source ? { element: source } : {}) });
        if (!kept || !source) return result("error", `Element ${action.element} is not in the last look at this window.`);
        if (params.action.element && params.action.element.role !== kept.role) {
          return result("error", `Element ${action.element} is no longer a ${params.action.element.role}.`);
        }
        const name = `the ${kept.role} "${kept.label}"`;
        if (action.kind === "setValue" && kept.role === "secureTextField") fail("blockedAction", "password field");
        const custom = app.onElement?.(action, source);
        if (custom) return custom;
        if (action.kind === "setValue") return result("ok", `Set the text of ${name}.`);
        if (action.kind === "scroll") return result("ok", `Scrolled ${name} ${action.direction}.`);
        if (kept.role === "row" || kept.role === "cell") return result("ok", `Selected ${name}.`);
        if (["textField", "textArea", "comboBox", "secureTextField"].includes(kept.role)) {
          return result("ok", `Put the cursor in ${name}.`);
        }
        return result("ok", `Clicked ${name}.`);
      }
      case "type":
      case "key": {
        executed.push({ params });
        if (cursors.get(params.cursorId) !== "main") fail("blockedAction", "keystroke from a ghost cursor");
        return (
          app.onKeys?.(action) ??
          result("ok", action.kind === "key" ? `Pressed ${action.combo}.` : `Typed ${action.text.length} characters.`)
        );
      }
      case "tool": {
        executed.push({ params });
        const call = action.call;
        switch (call.tool) {
          case "open_app":
            return result("ok", `Opened ${call.name ?? call.bundleId}.`);
          case "open_file":
          case "reveal_in_finder":
          case "open_url":
            return result("ok", "Opened it.");
          default:
            return result("invalidOutput", "This tool runs in the harness, not the Mac app.");
        }
      }
      case "clickAt": {
        executed.push({ params });
        return result("ok", `Clicked at ${action.x}, ${action.y}.`);
      }
      default:
        executed.push({ params });
        return result("invalidOutput", "The harness handles ask and finish, not the Mac app.");
    }
  };

  const handlers: Record<string, Handler> = {
    observeWindow: (params) => observe(params as ObserveWindowParams),
    executeAction: (params) => execute(params as ExecuteActionParams),
    probeAppCapability: (params) => {
      const { bundleId } = params as { bundleId: string };
      appFor(bundleId);
      const capability: AppCapability = {
        bundleId,
        appVersion: "1.0",
        accessibility: true,
        devtools: false,
        probedAt: new Date().toISOString(),
      };
      return capability;
    },
    // The harness can only name elements by number today (`#3`), and the real Mac app resolves only the paths its
    // tree reader built (`WindowReader.resolve`), so every field comes back without a value, as it does on the Mac.
    readFieldValues: (params) => ({
      fields: (params as ReadFieldValuesParams).elementPaths.map((elementPath) => ({ elementPath })),
    }),
    getAppVersion: (params) => (byBundle.has((params as { bundleId: string }).bundleId) ? { appVersion: "1.0" } : {}),
    // Each app has one window, numbered by its place in the list, for the router's window locks (OBJ-08).
    listWindows: (params) => {
      const { bundleId } = params as ListWindowsParams;
      const windows: WindowInfo[] = apps.map((app, index) => ({
        windowId: index + 1,
        bundleId: app.bundleId,
        appName: app.name,
        title: app.name,
        frame: { x: 0, y: 0, width: 1280, height: 800 },
        minimized: false,
      }));
      return { windows: windows.filter((window) => bundleId === undefined || window.bundleId === bundleId) };
    },
    openNewWindow: () => ({ supported: false }),
    resolveApp: (params) => {
      const name = (params as { name: string }).name.toLowerCase();
      const app = apps.find((a) => a.name.toLowerCase() === name);
      return app ? { bundleId: app.bundleId } : {};
    },
  };

  const socket: Socket = await new Promise((resolve, reject) => {
    const s = connect(socketPath, () => resolve(s)).once("error", reject);
  });
  const peer = new RpcPeer({
    role: "app",
    socket,
    handlers,
    contract: loadRpcContract(),
    onEvent: (event, payload) => {
      events.push({ event, payload });
      const command = payload as { command?: string; cursorId?: string; cursorKind?: "main" | "ghost" };
      if (event === "cursorCommand" && command.command === "spawn") cursors.set(command.cursorId!, command.cursorKind!);
    },
  });
  await peer.request("hello", { protocolVersion: PROTOCOL_VERSION });
  const fake: FakeMac = {
    peer,
    observes,
    executed,
    events,
    failObserve: (kind, count = -1) => {
      observeFailure = { kind, left: count };
    },
    close: () => peer.close(),
  };
  return fake;
}

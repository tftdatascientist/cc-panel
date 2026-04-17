import * as vscode from "vscode";
import { TerminalManager } from "./terminals/TerminalManager";
import { PanelManager } from "./panel/PanelManager";
import { TerminalId, isTerminalId } from "./panel/messages";
import { StateWatcher, TerminalState } from "./state/StateWatcher";
import { installHooks } from "./hooks/installHooks";
import { ButtonStore } from "./buttons/ButtonStore";
import { Actions } from "./buttons/Actions";
import { runEditButton } from "./buttons/EditButton";

const TERMINAL_IDS: TerminalId[] = [1, 2, 3, 4];

const terminalManager = new TerminalManager();
const stateWatcher = new StateWatcher();
let panelManager: PanelManager | undefined;
let buttonStore: ButtonStore | undefined;
let actions: Actions | undefined;
let activeTerminalId: TerminalId = 1;
const lastMessageSeen = new Map<TerminalId, string>();

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(terminalManager);
  context.subscriptions.push(stateWatcher);

  buttonStore = new ButtonStore(context.extensionUri);
  context.subscriptions.push(buttonStore);
  actions = new Actions(terminalManager);

  panelManager = new PanelManager(context.extensionUri, {
    onSelectTerminal: (id) => {
      if (!terminalManager.get(id)) return;
      activeTerminalId = id;
      const term = terminalManager.get(id);
      if (term) term.show(false);
      panelManager?.setActive(id);
    },
    onAddTerminal: (id) => {
      void addTerminal(id);
    },
    onInvokeButton: (index) => {
      const btn = buttonStore?.current()[index];
      if (!btn) return;
      void (async () => {
        const result = await actions?.execute(btn, activeTerminalId);
        if (result === "noTerminal") {
          vscode.window.showWarningMessage(
            `CC Panel: terminal T${activeTerminalId} nieaktywny — przycisk "${btn.label}" nie wysłany.`
          );
        }
      })();
    },
  });
  context.subscriptions.push(panelManager);

  buttonStore.onChange((buttons) => {
    panelManager?.setButtons(
      buttons.map(({ label, icon, section }) => ({ label, icon, section }))
    );
  });

  stateWatcher.onChange((state) => onStateChange(state));
  stateWatcher.start();

  terminalManager.onTerminalsChanged((ids) => {
    const filtered = ids.filter(isTerminalId) as TerminalId[];
    panelManager?.setTerminals(filtered);
    if (filtered.length === 0) return;
    if (!filtered.includes(activeTerminalId)) {
      activeTerminalId = filtered[0];
      panelManager?.setActive(activeTerminalId);
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.open", async () => {
      const firstOpen = !terminalManager.get(1);
      panelManager!.openOrReveal();
      if (firstOpen) {
        await vscode.commands.executeCommand("workbench.action.newGroupBelow");
      }
      await ensureTerminal(1);
      activeTerminalId = 1;
      panelManager!.setActive(1);
      panelManager!.setButtons(
        (buttonStore?.current() ?? []).map(({ label, icon, section }) => ({
          label,
          icon,
          section,
        }))
      );
      panelManager!.reveal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.addTerminal", async () => {
      const next = nextFreeTerminalId();
      if (!next) {
        vscode.window.showInformationMessage(
          "CC Panel: już działają wszystkie 4 terminale."
        );
        return;
      }
      await addTerminal(next);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.cycleActive", () => {
      cycleActiveTerminal();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.editButton", async () => {
      if (!buttonStore) return;
      await runEditButton(buttonStore);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.installHooks", async () => {
      await installHooks(context.extensionUri);
    })
  );
}

export function deactivate(): void {
  panelManager?.dispose();
  panelManager = undefined;
  terminalManager.dispose();
  void stateWatcher.dispose();
}

async function ensureTerminal(id: TerminalId): Promise<void> {
  const existing = terminalManager.get(id);
  if (existing) {
    existing.show(true);
    return;
  }
  const terminal = terminalManager.create(id, vscode.ViewColumn.Two);
  terminal.show(true);
}

async function addTerminal(id: TerminalId): Promise<void> {
  if (terminalManager.get(id)) {
    activeTerminalId = id;
    panelManager?.setActive(id);
    terminalManager.get(id)?.show(false);
    return;
  }
  const parent = terminalManager.get(1);
  const terminal = parent
    ? terminalManager.create(id, { parentTerminal: parent })
    : terminalManager.create(id, vscode.ViewColumn.Two);
  terminal.show(false);
  activeTerminalId = id;
  panelManager?.setActive(id);
}

function nextFreeTerminalId(): TerminalId | undefined {
  for (const id of TERMINAL_IDS) {
    if (!terminalManager.get(id)) return id;
  }
  return undefined;
}

function cycleActiveTerminal(): void {
  const ids = terminalManager.activeIds().filter(isTerminalId) as TerminalId[];
  if (ids.length === 0) return;
  const currentIdx = ids.indexOf(activeTerminalId);
  const next = currentIdx === -1 ? ids[0] : ids[(currentIdx + 1) % ids.length];
  if (next === activeTerminalId && ids.length === 1) return;
  activeTerminalId = next;
  terminalManager.get(next)?.show(false);
  panelManager?.setActive(next);
}

function onStateChange(state: TerminalState): void {
  if (!panelManager) return;
  const id = state.terminal_id;
  if (!isTerminalId(id)) return;

  panelManager.setMetrics(id, {
    model: state.model,
    cost:
      typeof state.cost_usd === "number"
        ? `$${state.cost_usd.toFixed(2)}`
        : undefined,
    ctx:
      typeof state.ctx_pct === "number" ? `${state.ctx_pct}%` : undefined,
    ctxPct: typeof state.ctx_pct === "number" ? state.ctx_pct : undefined,
    mode: state.mode,
  });

  if (state.phase) {
    const sinceMs = state.phase_changed_at
      ? Date.parse(state.phase_changed_at)
      : undefined;
    panelManager.setPhase(
      id,
      state.phase,
      Number.isFinite(sinceMs) ? (sinceMs as number) : undefined
    );
  }

  if (state.last_message && state.last_message_at) {
    const prev = lastMessageSeen.get(id);
    if (prev === undefined) {
      // pierwszy odczyt po starcie rozszerzenia — hydruj bez pushowania
      lastMessageSeen.set(id, state.last_message_at);
    } else if (prev !== state.last_message_at) {
      lastMessageSeen.set(id, state.last_message_at);
      panelManager.addMessage({
        terminalId: id,
        text: state.last_message,
        at: state.last_message_at,
      });
    }
  }
}

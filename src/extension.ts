import * as vscode from "vscode";
import { TerminalManager } from "./terminals/TerminalManager";
import { PanelManager } from "./panel/PanelManager";
import {
  DashboardMapDTO,
  KeystrokeName,
  TerminalId,
  isTerminalId,
} from "./panel/messages";

import { installHooks } from "./hooks/installHooks";
import { UserListsStore } from "./settings/UserListsStore";
import { SLASH_COMMANDS } from "./settings/slashCommands";
import {
  runEditMessages,
  runEditUserCommands,
} from "./settings/editUserLists";
import { StateWatcher, TerminalDashboardSnapshot } from "./state/StateWatcher";

const TERMINAL_IDS: TerminalId[] = [1, 2, 3, 4];

const KEYSTROKES: Record<KeystrokeName, string> = {
  esc: "\u001b",
  ctrlC: "\u0003",
  shiftTab: "\u001b[Z",
};

const terminalManager = new TerminalManager();
let panelManager: PanelManager | undefined;
let userListsStore: UserListsStore | undefined;
let stateWatcher: StateWatcher | undefined;
let activeTerminalId: TerminalId = 1;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(terminalManager);

  userListsStore = new UserListsStore();
  context.subscriptions.push(userListsStore);

  panelManager = new PanelManager(context.extensionUri, {
    onReady: () => {
      pushUserLists();
    },
    onSelectTerminal: (id) => {
      if (!terminalManager.get(id)) return;
      activeTerminalId = id;
      terminalManager.get(id)?.show(false);
      panelManager?.setActive(id);
    },
    onAddTerminal: (id) => {
      void addTerminal(id);
    },
    onSendKeystroke: (name) => {
      const bytes = KEYSTROKES[name];
      if (!bytes) return;
      writeAndWarn(bytes, name);
    },
    onSendRaw: (text) => {
      writeAndWarn(text, text.slice(0, 40));
    },
  });

  context.subscriptions.push(panelManager);

  stateWatcher = new StateWatcher();
  context.subscriptions.push(stateWatcher);
  stateWatcher.onChange((map) => {
    panelManager?.setDashboard(toDashboardDTO(map));
  });
  stateWatcher.start();

  panelManager.setSlashCommands(SLASH_COMMANDS.map((s) => ({ ...s })));
  userListsStore.onChange(() => pushUserLists());

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
      try {
        await panelManager!.openOrReveal();
        await ensureTerminal(1);
        activeTerminalId = 1;
        panelManager!.setActive(1);
      } catch (err) {
        const msg = err instanceof Error ? err.stack ?? err.message : String(err);
        console.error("[cc-panel] ccPanel.open ERROR:", msg);
        void vscode.window.showErrorMessage(`CC Panel open failed: ${msg.split("\n")[0]}`);
      }
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

  for (const id of TERMINAL_IDS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`ccPanel.selectTerminal${id}`, () => {
        selectTerminal(id);
      })
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.editUserCommands", async () => {
      if (!userListsStore) return;
      await runEditUserCommands(userListsStore);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.editMessages", async () => {
      if (!userListsStore) return;
      await runEditMessages(userListsStore);
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.reloadUserLists", () => {
      userListsStore?.reload();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.installHooks", async () => {
      await installHooks(context.extensionUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.setProjectFolder", async () => {
      if (!userListsStore) return;
      const TERMINAL_LABELS: Record<number, string> = {
        1: "$(circle-filled) T1 — teal",
        2: "$(circle-filled) T2 — amber",
        3: "$(circle-filled) T3 — purple",
        4: "$(circle-filled) T4 — coral",
      };
      const paths = userListsStore.current().projectPaths;
      const pick = await vscode.window.showQuickPick(
        ([1, 2, 3, 4] as const).map((id) => ({
          label: TERMINAL_LABELS[id],
          description: paths[id - 1] || "(nieustawiony)",
          id,
        })),
        { title: "CC Panel: dla którego terminala ustawić folder projektu?" }
      );
      if (!pick) return;

      const defaultUri = paths[pick.id - 1]
        ? vscode.Uri.file(paths[pick.id - 1])
        : vscode.workspace.workspaceFolders?.[0]?.uri;
      const uris = await vscode.window.showOpenDialog({
        title: `CC Panel: folder projektu dla T${pick.id}`,
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        defaultUri,
      });
      if (!uris || uris.length === 0) return;
      const chosen = uris[0].fsPath;
      await userListsStore.saveProjectPath(pick.id, chosen);
      void vscode.window.showInformationMessage(
        `CC Panel: T${pick.id} → ${chosen}`
      );
    })
  );
}

export function deactivate(): void {
  stateWatcher?.dispose();
  stateWatcher = undefined;
  panelManager?.dispose();
  panelManager = undefined;
  terminalManager.dispose();
}

function toDashboardDTO(
  map: Partial<Record<TerminalId, TerminalDashboardSnapshot>>
): DashboardMapDTO {
  const out: DashboardMapDTO = {};
  for (const id of [1, 2, 3, 4] as TerminalId[]) {
    const snap = map[id];
    if (!snap) continue;
    out[id] = {
      id: snap.id,
      model: snap.model,
      ctxPct: snap.ctxPct,
      totalTokens: snap.totalTokens,
      costUsd: snap.costUsd,
      lastMessage: snap.lastMessage,
      lastMessageAt: snap.lastMessageAt,
      phase: snap.phase,
    };
  }
  return out;
}

function pushUserLists(): void {
  if (!panelManager || !userListsStore) return;
  const lists = userListsStore.current();
  panelManager.setUserLists(
    lists.slashDropdown.map((c) => ({ ...c })),
    lists.userCommands.map((c) => ({ ...c })),
    lists.messages.map((m) => ({ ...m }))
  );
  panelManager.setProjectPaths([...lists.projectPaths] as [string, string, string, string]);
}

function writeAndWarn(data: string, label: string): boolean {
  const ok = terminalManager.write(activeTerminalId, data);
  if (!ok) {
    void vscode.window.showWarningMessage(
      `CC Panel: terminal T${activeTerminalId} nieaktywny — "${label}" nie wysłane.`
    );
  }
  return ok;
}

function projectPathFor(id: TerminalId): string | undefined {
  return userListsStore?.current().projectPaths[id - 1] || undefined;
}

async function ensureTerminal(id: TerminalId): Promise<void> {
  const existing = terminalManager.get(id);
  if (existing) {
    existing.show(true);
    return;
  }
  const terminal = terminalManager.create(id, projectPathFor(id));
  terminal.show(true);
}

async function addTerminal(id: TerminalId): Promise<void> {
  if (terminalManager.get(id)) {
    activeTerminalId = id;
    panelManager?.setActive(id);
    terminalManager.get(id)?.show(false);
    return;
  }
  const terminal = terminalManager.create(id, projectPathFor(id));
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

function selectTerminal(id: TerminalId): void {
  const term = terminalManager.get(id);
  if (!term) {
    void addTerminal(id);
    return;
  }
  activeTerminalId = id;
  term.show(false);
  panelManager?.setActive(id);
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

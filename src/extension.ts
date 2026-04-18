import * as vscode from "vscode";
import { TerminalManager } from "./terminals/TerminalManager";
import { PanelManager } from "./panel/PanelManager";
import {
  KeystrokeName,
  SendInputOptions,
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

const TERMINAL_IDS: TerminalId[] = [1, 2, 3, 4];

const KEYSTROKES: Record<KeystrokeName, string> = {
  esc: "\u001b",
  ctrlC: "\u0003",
  shiftTab: "\u001b[Z",
};

const terminalManager = new TerminalManager();
let panelManager: PanelManager | undefined;
let userListsStore: UserListsStore | undefined;
let activeTerminalId: TerminalId = 1;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(terminalManager);

  userListsStore = new UserListsStore();
  context.subscriptions.push(userListsStore);

  panelManager = new PanelManager(context.extensionUri, {
    onSelectTerminal: (id) => {
      if (!terminalManager.get(id)) return;
      activeTerminalId = id;
      terminalManager.get(id)?.show(false);
      panelManager?.setActive(id);
    },
    onAddTerminal: (id) => {
      void addTerminal(id);
    },
    onSendSlash: (index, extra) => {
      const item = SLASH_COMMANDS[index];
      if (!item) return;
      const cmd = extra ? `${item.value} ${extra}` : item.value;
      writeAndWarn(`${cmd}\r`, item.label);
    },
    onSendUserCommand: (index, extra) => {
      const item = userListsStore?.current().userCommands[index];
      if (!item) return;
      const cmd = extra ? `${item.value} ${extra}` : item.value;
      writeAndWarn(`${cmd}\r`, item.label);
    },
    onSendMessage: (index) => {
      const item = userListsStore?.current().messages[index];
      if (!item) return;
      writeAndWarn(`${item.text}\r`, item.label);
    },
    onSendInput: (opts) => {
      void sendInputWithModifiers(opts);
    },
    onSendKeystroke: (name) => {
      const bytes = KEYSTROKES[name];
      if (!bytes) return;
      writeAndWarn(bytes, name);
    },
    onSendChar: (data) => {
      terminalManager.write(activeTerminalId, data);
    },
  });
  context.subscriptions.push(panelManager);

  panelManager.setSlashCommands(SLASH_COMMANDS.map((s) => ({ ...s })));
  pushUserLists();

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
      const firstOpen = !terminalManager.get(1);
      panelManager!.openOrReveal();
      if (firstOpen) {
        await vscode.commands.executeCommand("workbench.action.newGroupBelow");
      }
      await ensureTerminal(1);
      activeTerminalId = 1;
      panelManager!.setActive(1);
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
}

export function deactivate(): void {
  panelManager?.dispose();
  panelManager = undefined;
  terminalManager.dispose();
}

function pushUserLists(): void {
  if (!panelManager || !userListsStore) return;
  const lists = userListsStore.current();
  panelManager.setUserLists(
    lists.userCommands.map((c) => ({ ...c })),
    lists.messages.map((m) => ({ ...m }))
  );
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

async function sendInputWithModifiers(opts: SendInputOptions): Promise<void> {
  const trimmed = opts.text;
  if (!trimmed || trimmed.trim().length === 0) return;

  if (opts.plan) {
    if (!writeAndWarn(KEYSTROKES.shiftTab + KEYSTROKES.shiftTab, "plan mode (⇧Tab×2)")) return;
    await sleep(60);
  }

  if (opts.model) {
    if (!writeAndWarn(`/model ${opts.model}\r`, `/model ${opts.model}`)) return;
    await sleep(120);
  }

  if (opts.effort) {
    if (!writeAndWarn(`/effort ${opts.effort}\r`, `/effort ${opts.effort}`)) return;
    await sleep(120);
  }

  // think: "" | "think" | "think harder" → prefix do tekstu
  const thinkPrefix = opts.think ? `${opts.think}: ` : "";
  const body = `${thinkPrefix}${trimmed}`;
  writeAndWarn(`${body}\r`, previewLabel(body));
}

function previewLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? flat.slice(0, 57) + "…" : flat;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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

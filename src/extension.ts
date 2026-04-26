import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TerminalManager } from "./terminals/TerminalManager";
import { PanelManager } from "./panel/PanelManager";
import {
  AutoAcceptStatusDTO,
  DashboardMapDTO,
  KeystrokeName,
  TerminalId,
  isTerminalId,
} from "./panel/messages";
import type { AutoAcceptStatus } from "./auto-accept/types";

import { installHooks, syncHookPaths } from "./hooks/installHooks";
import { UserListsStore } from "./settings/UserListsStore";
import { SLASH_COMMANDS } from "./settings/slashCommands";
import {
  runEditMessages,
  runEditUserCommands,
} from "./settings/editUserLists";
import { StateWatcher, TerminalDashboardSnapshot } from "./state/StateWatcher";
import { readRecentMessages } from "./state/TranscriptReader";
import { AutoAcceptSession } from "./auto-accept/AutoAcceptSession";
import { TriggerDetector } from "./auto-accept/TriggerDetector";
import { invokeHaiku } from "./auto-accept/HaikuHeadlessClient";
import { readRecentSessions } from "./auto-accept/SessionLogger";
import { runStartWizard } from "./auto-accept/startWizard";

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
let autoAcceptSession: AutoAcceptSession | undefined;
let activeTerminalId: TerminalId = 1;

export function activate(context: vscode.ExtensionContext): void {
  syncHookPaths(context.extensionUri);
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
      const clean = text.replace(/\r$/, "").trim();
      if (clean.length > 0) void userListsStore?.recordCommand(clean);
    },
    onRecordCommand: (value) => {
      void userListsStore?.recordCommand(value);
    },
    onStopAutoAccept: () => {
      if (autoAcceptSession?.isActive()) {
        autoAcceptSession.stop("user-stop");
        void vscode.window.showInformationMessage("Auto-Accept zatrzymany z panelu.");
      }
    },
    onShowContextMenu: (chipId) => {
      void showTerminalQuickPick(chipId);
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
        terminalManager.scanAndReconnect();
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
      terminalManager.scanAndReconnect();
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
    vscode.commands.registerCommand("ccPanel.syncTerminals", () => {
      const reconnected = terminalManager.scanAndReconnect();
      const ids = terminalManager.activeIds().filter(isTerminalId) as TerminalId[];
      panelManager?.setTerminals(ids);
      if (reconnected.length > 0) {
        void vscode.window.showInformationMessage(
          `CC Panel: podłączono ${reconnected.map((id) => `T${id}`).join(", ")}.`
        );
      } else {
        void vscode.window.showInformationMessage(
          "CC Panel: brak otwartych terminali CC #1–4 do podłączenia."
        );
      }
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

  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.startAutoAccept", async () => {
      await startAutoAccept();
    }),
    vscode.commands.registerCommand("ccPanel.stopAutoAccept", () => {
      if (!autoAcceptSession?.isActive()) {
        void vscode.window.showInformationMessage("Auto-Accept nie jest aktywny.");
        return;
      }
      autoAcceptSession.stop("user-stop");
      void vscode.window.showInformationMessage("Auto-Accept zatrzymany.");
    }),
    vscode.commands.registerCommand("ccPanel.autoAcceptStatus", () => {
      showAutoAcceptStatus();
    }),
    vscode.commands.registerCommand("ccPanel.showAutoAcceptHistory", async () => {
      const sessions = readRecentSessions(20);
      if (sessions.length === 0) {
        void vscode.window.showInformationMessage("Brak historii Auto-Accept (log pusty).");
        return;
      }
      const items = sessions.map((s) => ({
        label: `T${s.terminalId} — ${new Date(s.t).toLocaleString()}`,
        description: `cost: $${s.config.costLimitUsd ?? "∞"} · iter: ${s.config.maxIterations ?? "∞"} · time: ${s.config.timeLimitMs ? `${Math.round(s.config.timeLimitMs / 60000)}min` : "∞"}`,
        session: s,
      }));
      const pick = await vscode.window.showQuickPick(items, {
        title: `Auto-Accept: historia (${sessions.length} sesji)`,
        placeHolder: "Wybierz sesję aby zobaczyć sessionId (log: ~/.claude/cc-panel/aa-sessions.jsonl)",
      });
      if (pick) {
        void vscode.window.showInformationMessage(`sessionId: ${pick.session.sessionId}`);
      }
    }),
    vscode.commands.registerCommand("ccPanel.editAutoAcceptSystemPrompt", async () => {
      const cfg = vscode.workspace.getConfiguration("ccPanel");
      const current = cfg.get<string>("autoAcceptSystemPrompt") ?? "";
      const edited = await vscode.window.showInputBox({
        title: "Auto-Accept: system prompt (persisted in settings)",
        value: current,
        prompt: "Zmiana zostanie zapisana w ustawieniach VS Code (ccPanel.autoAcceptSystemPrompt).",
      });
      if (edited === undefined) return;
      await cfg.update("autoAcceptSystemPrompt", edited, vscode.ConfigurationTarget.Global);
      void vscode.window.showInformationMessage("Auto-Accept system prompt zapisany.");
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("ccPanel.launchSlot", async () => {
      try { await handleLaunchSlot(); }
      catch (err) {
        const msg = err instanceof Error ? err.stack ?? err.message : String(err);
        console.error("[cc-panel] ccPanel.launchSlot ERROR:", msg);
        void vscode.window.showErrorMessage(`CC Panel launchSlot failed: ${msg.split("\n")[0]}`);
      }
    })
  );

  // Startup check: CEM writes launch-request.json before opening VS Code.
  // The --command flag is unreliable for new windows (races extension activation).
  // We poll after 1500ms so panelManager and terminalManager are fully ready.
  setTimeout(() => { void handleLaunchSlot(); }, 1500);
}

const LAUNCH_REQUEST_PATH = path.join(os.homedir(), ".claude", "cc-panel", "launch-request.json");

interface LaunchRequest {
  slotId: number;
  projectPath?: string;
  terminalCount?: number;
  vibePrompt?: string;
}

async function handleLaunchSlot(): Promise<void> {
  if (!fs.existsSync(LAUNCH_REQUEST_PATH)) return;
  let req: LaunchRequest;
  try { req = JSON.parse(fs.readFileSync(LAUNCH_REQUEST_PATH, "utf8")); }
  catch { try { fs.unlinkSync(LAUNCH_REQUEST_PATH); } catch {} return; }
  try { fs.unlinkSync(LAUNCH_REQUEST_PATH); } catch {}

  if (!isTerminalId(req.slotId)) return;
  const startId = req.slotId as TerminalId;
  const count = Math.max(1, Math.min(4, req.terminalCount ?? 1));

  await panelManager!.openOrReveal();

  const created: TerminalId[] = [];
  for (let i = 0; i < count; i++) {
    const id = (startId + i) as TerminalId;
    if (!isTerminalId(id)) break;
    if (terminalManager.get(id)) continue;
    const terminal = terminalManager.create(id, projectPathFor(id) || req.projectPath);
    terminal.show(false);
    created.push(id);
  }
  if (created.length > 0) {
    activeTerminalId = created[0];
    panelManager?.setActive(created[0]);
  }

  if (req.vibePrompt?.trim()) {
    for (const id of created) schedulePromptInjection(id, req.vibePrompt);
  }
}

function schedulePromptInjection(id: TerminalId, prompt: string): void {
  const statePath = path.join(os.homedir(), ".claude", "cc-panel", `state.${id}.json`);
  let done = false;
  const send = () => {
    if (done) return;
    done = true;
    clearInterval(poll);
    clearTimeout(fallback);
    setTimeout(() => terminalManager.write(id, prompt + "\r"), 2500);
  };
  const poll = setInterval(() => { if (fs.existsSync(statePath)) send(); }, 500);
  const fallback = setTimeout(send, 20_000);
}

export function deactivate(): void {
  autoAcceptSession?.dispose();
  autoAcceptSession = undefined;
  stateWatcher?.dispose();
  stateWatcher = undefined;
  panelManager?.dispose();
  panelManager = undefined;
  terminalManager.dispose();
}

async function startAutoAccept(): Promise<void> {
  if (!stateWatcher) {
    void vscode.window.showErrorMessage("Auto-Accept: StateWatcher niedostępny.");
    return;
  }
  if (autoAcceptSession?.isActive()) {
    const pick = await vscode.window.showWarningMessage(
      "Auto-Accept już działa. Zatrzymać bieżący i wystartować nowy?",
      "Tak, restart",
      "Anuluj",
    );
    if (pick !== "Tak, restart") return;
    autoAcceptSession.stop("user-stop");
    autoAcceptSession.dispose();
    autoAcceptSession = undefined;
  }

  const activeIds = terminalManager.activeIds().filter(isTerminalId) as TerminalId[];
  const cfg = vscode.workspace.getConfiguration("ccPanel");
  const defaultSystemPrompt = cfg.get<string>("autoAcceptSystemPrompt") ?? "";
  const defaultMetaPrompt = cfg.get<string>("autoAcceptMetaPrompt") ?? "";

  const config = await runStartWizard({
    availableTerminals: activeIds,
    defaultSystemPrompt,
    defaultMetaPrompt,
  });
  if (!config) return;

  const watcher = stateWatcher;
  const triggerDetector = new TriggerDetector(watcher);
  autoAcceptSession = new AutoAcceptSession({
    triggerDetector,
    haikuClient: { invokeHaiku },
    writeToTerminal: (id, text) => terminalManager.write(id, text),
    getRecentMessages: async (id, limit) => {
      const p = watcher.getTranscriptPath(id);
      if (!p) return [];
      try {
        return await readRecentMessages(p, limit);
      } catch {
        return [];
      }
    },
    getCcCostUsd: (id) => watcher.getSnapshot(id)?.costUsd ?? 0,
  });
  autoAcceptSession.onStatus((status) => {
    panelManager?.setAutoAccept(toAutoAcceptDTO(status));
    if (!status.active && status.lastError) {
      void vscode.window.showWarningMessage(`Auto-Accept zatrzymany: ${status.lastError}`);
    }
  });
  autoAcceptSession.start(config);
  void vscode.window.showInformationMessage(
    `Auto-Accept start: T${config.terminalId} · time:${fmtTime(config.timeLimitMs)} · cost:${fmtCost(config.costLimitUsd)} · iter:${config.maxIterations ?? "∞"}`,
  );
}

function showAutoAcceptStatus(): void {
  if (!autoAcceptSession || !autoAcceptSession.isActive()) {
    void vscode.window.showInformationMessage("Auto-Accept nieaktywny.");
    return;
  }
  const s = autoAcceptSession.getStatus();
  void vscode.window.showInformationMessage(
    `AA T${s.terminalId}: iter ${s.iterationsUsed}/${s.config?.maxIterations ?? "∞"} · cost $${s.cumulativeCostUsd.toFixed(2)}/${fmtCost(s.config?.costLimitUsd ?? null)}`,
  );
}

function fmtTime(ms: number | null): string {
  if (ms === null) return "∞";
  return `${Math.round(ms / 60000)}min`;
}

function fmtCost(usd: number | null): string {
  if (usd === null) return "∞";
  return `$${usd.toFixed(2)}`;
}

function toAutoAcceptDTO(status: AutoAcceptStatus): AutoAcceptStatusDTO {
  return {
    active: status.active,
    terminalId: status.terminalId,
    startedAt: status.startedAt,
    iterationsUsed: status.iterationsUsed,
    maxIterations: status.config?.maxIterations ?? null,
    cumulativeCostUsd: status.cumulativeCostUsd,
    costLimitUsd: status.config?.costLimitUsd ?? null,
    timeLimitMs: status.config?.timeLimitMs ?? null,
    lastError: status.lastError,
  };
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
    lists.messages.map((m) => ({ ...m })),
    [...lists.history],
    { ...lists.usageStats }
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

async function showTerminalQuickPick(chipId: TerminalId): Promise<void> {
  if (!userListsStore) return;
  const lists = userListsStore.current();
  const items: vscode.QuickPickItem[] = [];

  if (lists.pickHistory.length > 0) {
    items.push({ label: "Ostatnie", kind: vscode.QuickPickItemKind.Separator });
    for (const v of lists.pickHistory) {
      items.push({ label: v });
    }
  }
  if (lists.history.length > 0) {
    items.push({ label: "Historia (bar)", kind: vscode.QuickPickItemKind.Separator });
    for (const v of lists.history.slice(0, 20)) {
      items.push({ label: v });
    }
  }
  if (lists.slashDropdown.length > 0 || SLASH_COMMANDS.length > 0) {
    items.push({ label: "Slash commands", kind: vscode.QuickPickItemKind.Separator });
    const slash = lists.slashDropdown.length > 0 ? lists.slashDropdown : SLASH_COMMANDS;
    for (const it of slash.slice(0, 35)) {
      items.push({ label: it.value, description: it.label !== it.value ? it.label : undefined });
    }
  }
  if (lists.userCommands.length > 0) {
    items.push({ label: "Komendy", kind: vscode.QuickPickItemKind.Separator });
    for (const it of lists.userCommands) {
      items.push({ label: it.value, description: it.label !== it.value ? it.label : undefined });
    }
  }
  if (lists.messages.length > 0) {
    items.push({ label: "Wiadomości", kind: vscode.QuickPickItemKind.Separator });
    for (const it of lists.messages) {
      items.push({ label: it.text, description: it.label !== it.text ? it.label : undefined });
    }
  }

  const pick = await vscode.window.showQuickPick(items, {
    title: `CC Panel: T${chipId}`,
    placeHolder: "Wybierz komendę lub wiadomość…",
    matchOnDescription: true,
  });
  if (!pick || pick.kind === vscode.QuickPickItemKind.Separator) return;

  const text = pick.label;
  const ok = terminalManager.write(chipId, text + "\r");
  if (!ok) {
    void vscode.window.showWarningMessage(`CC Panel: terminal T${chipId} nieaktywny.`);
    return;
  }
  void userListsStore?.recordCommand(text);
  void userListsStore?.recordPickHistory(text);
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

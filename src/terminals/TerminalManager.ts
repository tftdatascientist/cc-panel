import * as vscode from "vscode";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";

interface ManagedTerminal {
  id: number;
  terminal: vscode.Terminal;
  subscriptions: vscode.Disposable[];
}

// Mapowanie slotów T1-T4 na kolory CC CLI
const TERMINAL_COLOR_MAP = {
  1: "/color cyan",    // T1 teal (#14b8a6) → cyan
  2: "/color orange",  // T2 amber (#f59e0b) → orange (jedyny żółtawy w CC CLI)
  3: "/color purple",  // T3 fiolet (#a78bfa) → purple
  4: "/color pink",    // T4 coral (#fb7185) → pink
} as const;

const STATE_DIR = path.join(os.homedir(), ".claude", "cc-panel");
// Po pojawieniu się state.{id}.json (sygnał od statusline hooka = CC załadowane) czekamy jeszcze
// chwilę żeby CC zdążył wyświetlić prompt przed przyjęciem /color.
const COLOR_AFTER_READY_MS = 600;
// Fallback: jeśli state.{id}.json nie pojawi się w tym czasie, wysyłamy /color z opóźnieniem.
const COLOR_FALLBACK_TIMEOUT_MS = 15_000;

export class TerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<number, ManagedTerminal>();
  private readonly changedEmitter = new vscode.EventEmitter<number[]>();
  readonly onTerminalsChanged = this.changedEmitter.event;

  activeIds(): number[] {
    return [...this.terminals.keys()].sort((a, b) => a - b);
  }

  create(id: number, projectPath?: string): vscode.Terminal {
    const existing = this.terminals.get(id);
    if (existing) {
      existing.terminal.show(true);
      return existing.terminal;
    }

    const rawCwd =
      (projectPath && projectPath.trim().length > 0 ? projectPath.trim() : null) ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ??
      os.homedir();
    const cwd = process.platform === "win32"
      ? rawCwd.replace(/^\/([a-zA-Z]):/, "$1:").replace(/\//g, "\\")
      : rawCwd;

    const command =
      vscode.workspace.getConfiguration("ccPanel").get<string>("command")?.trim() || "claude";
    const bypassPerms = vscode.workspace
      .getConfiguration("ccPanel")
      .get<boolean>("bypassPermissions", true);
    const fullCommand = bypassPerms ? `${command} --dangerously-skip-permissions` : command;

    const shellCommand = buildShellCommand(id, fullCommand);
    console.log(`[cc-panel] createTerminal(id=${id}) shell=${vscode.env.shell} cmd=${shellCommand} cwd=${cwd}`);

    // Usuń stary state.{id}.json PRZED spawnem. Dwa powody:
    //  1) polling poniżej (`fs.existsSync(statePath)`) wykryłby plik z poprzedniej sesji
    //     i wysłał /color ZANIM CC wystartuje — komenda wpadłaby do buforu cmd.exe.
    //  2) StateWatcher (chokidar) emituje `unlink` → czyści snapshot + resetCache(transcript),
    //     więc webview dostaje czysty dashboard dla tego terminala zamiast stare metryki.
    const statePath = path.join(STATE_DIR, `state.${id}.json`);
    try {
      fs.unlinkSync(statePath);
      console.log(`[cc-panel] createTerminal(id=${id}) usunięto stary state: ${statePath}`);
    } catch {
      // plik nie istniał — OK, pierwszy spawn
    }

    const terminal = vscode.window.createTerminal({
      name: `CC #${id}`,
      cwd,
      iconPath: new vscode.ThemeIcon("terminal", new vscode.ThemeColor(`ccPanel.terminal.t${id}`)),
      color: new vscode.ThemeColor(`ccPanel.terminal.t${id}`),
      location: vscode.TerminalLocation.Panel,
    });
    console.log(`[cc-panel] createTerminal(id=${id}) created OK`);

    // Krótkie opóźnienie — terminal musi zainicjować powłokę przed przyjęciem komendy
    setTimeout(() => terminal.sendText(shellCommand, true), 300);
    // Auto-color: wysyłamy /color dopiero gdy CC załaduje prompt (statusline hook zapisze state.{id}.json).
    // Polling co 500ms na pojawienie się pliku; fallback po 15s jeśli hook nie wystrzelił.
    const colorCmd = TERMINAL_COLOR_MAP[id as keyof typeof TERMINAL_COLOR_MAP];
    if (colorCmd) {
      let sent = false;
      const sendColor = () => {
        if (sent) return;
        sent = true;
        clearInterval(poll);
        clearTimeout(fallback);
        setTimeout(() => terminal.sendText(colorCmd, true), COLOR_AFTER_READY_MS);
      };
      const poll = setInterval(() => {
        if (fs.existsSync(statePath)) sendColor();
      }, 500);
      const fallback = setTimeout(sendColor, COLOR_FALLBACK_TIMEOUT_MS);
    }

    const closeSub = vscode.window.onDidCloseTerminal((t) => {
      if (t !== terminal) return;
      this.terminals.delete(id);
      closeSub.dispose();
      this.changedEmitter.fire(this.activeIds());
    });

    this.terminals.set(id, {
      id,
      terminal,
      subscriptions: [closeSub],
    });

    this.changedEmitter.fire(this.activeIds());
    return terminal;
  }

  get(id: number): vscode.Terminal | undefined {
    return this.terminals.get(id)?.terminal;
  }

  /**
   * Podłącza istniejący terminal VS Code (stworzony w poprzedniej sesji) pod dany slot.
   * Nie spawnuje nowego procesu — terminal ma już działające CC z właściwym env.
   */
  reconnect(id: number, terminal: vscode.Terminal): void {
    if (this.terminals.has(id)) return;
    const closeSub = vscode.window.onDidCloseTerminal((t) => {
      if (t !== terminal) return;
      this.terminals.delete(id);
      closeSub.dispose();
      this.changedEmitter.fire(this.activeIds());
    });
    this.terminals.set(id, { id, terminal, subscriptions: [closeSub] });
    this.changedEmitter.fire(this.activeIds());
  }

  /**
   * Skanuje vscode.window.terminals w poszukiwaniu `CC #1`–`CC #4` i reconnectuje
   * te które nie są jeszcze śledzone. Zwraca listę ID które zostały podłączone.
   */
  scanAndReconnect(): number[] {
    const reconnected: number[] = [];
    for (let id = 1; id <= 4; id++) {
      if (this.terminals.has(id)) continue;
      const name = `CC #${id}`;
      const found = vscode.window.terminals.find((t) => t.name === name);
      if (found) {
        this.reconnect(id, found);
        reconnected.push(id);
      }
    }
    return reconnected;
  }

  write(id: number, data: string): boolean {
    const terminal = this.terminals.get(id)?.terminal;
    if (!terminal) return false;
    try {
      // addNewLine=true gdy data kończy się \r — VS Code dodaje platform-native newline
      // zamiast przekazywać \r bezpośrednio do PTY (nie zawsze triggeruje Enter w CC)
      const endsWithCR = data.endsWith("\r");
      const text = endsWithCR ? data.slice(0, -1) : data;
      terminal.sendText(text, endsWithCR);
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    for (const managed of this.terminals.values()) {
      for (const sub of managed.subscriptions) sub.dispose();
      managed.terminal.dispose();
    }
    this.terminals.clear();
    this.changedEmitter.dispose();
  }
}

function buildShellCommand(id: number, command: string): string {
  const shell = vscode.env.shell.toLowerCase();
  const isPowerShell = shell.includes("powershell") || shell.includes("pwsh");
  const isCmdExe = !isPowerShell && shell.includes("cmd.exe");
  if (isPowerShell) {
    // PowerShell: $env:VAR="val"; command
    return `$env:CC_PANEL_TERMINAL_ID="${id}"; ${command}`;
  }
  if (isCmdExe) {
    // cmd.exe: set VAR=val && command
    return `cmd /k "set CC_PANEL_TERMINAL_ID=${id} && ${command}"`;
  }
  // bash / git bash / zsh / sh: VAR=val command
  return `CC_PANEL_TERMINAL_ID=${id} ${command}`;
}

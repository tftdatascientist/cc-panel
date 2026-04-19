import * as vscode from "vscode";
import * as os from "os";

interface ManagedTerminal {
  id: number;
  terminal: vscode.Terminal;
  subscriptions: vscode.Disposable[];
}

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

  write(id: number, data: string): boolean {
    const terminal = this.terminals.get(id)?.terminal;
    if (!terminal) return false;
    try {
      // sendText(text, addNewLine=false) — newline wstawiamy sami przez \r gdy trzeba
      terminal.sendText(data, false);
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

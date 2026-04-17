import * as vscode from "vscode";
import * as os from "os";
import * as pty from "node-pty";

interface ManagedTerminal {
  id: number;
  terminal: vscode.Terminal;
  getPty: () => pty.IPty | undefined;
  subscriptions: vscode.Disposable[];
}

export class TerminalManager implements vscode.Disposable {
  private readonly terminals = new Map<number, ManagedTerminal>();
  private readonly changedEmitter = new vscode.EventEmitter<number[]>();
  readonly onTerminalsChanged = this.changedEmitter.event;

  activeIds(): number[] {
    return [...this.terminals.keys()].sort((a, b) => a - b);
  }

  create(id: number, viewColumn: vscode.ViewColumn): vscode.Terminal {
    const existing = this.terminals.get(id);
    if (existing) {
      existing.terminal.show(true);
      return existing.terminal;
    }

    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number | void>();

    let ptyProcess: pty.IPty | undefined;

    const pseudoterminal: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,
      open: (initialDimensions) => {
        const cols = initialDimensions?.columns ?? 80;
        const rows = initialDimensions?.rows ?? 30;
        const cwd =
          vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
        const env: Record<string, string> = {};
        for (const [k, v] of Object.entries(process.env)) {
          if (typeof v === "string") env[k] = v;
        }
        env.CC_PANEL_TERMINAL_ID = String(id);

        const { shellFile, shellArgs } = resolveShell();
        ptyProcess = pty.spawn(shellFile, shellArgs, {
          name: "xterm-256color",
          cols,
          rows,
          cwd,
          env,
        });

        ptyProcess.onData((data) => writeEmitter.fire(data));
        ptyProcess.onExit(({ exitCode }) => {
          closeEmitter.fire(exitCode);
          ptyProcess = undefined;
        });
      },
      close: () => {
        ptyProcess?.kill();
        ptyProcess = undefined;
      },
      handleInput: (data) => ptyProcess?.write(data),
      setDimensions: (dim) => {
        if (!ptyProcess) return;
        try {
          ptyProcess.resize(Math.max(1, dim.columns), Math.max(1, dim.rows));
        } catch {
          // pty może już nie żyć — ignoruj
        }
      },
    };

    const terminal = vscode.window.createTerminal({
      name: `CC #${id}`,
      pty: pseudoterminal,
      iconPath: new vscode.ThemeIcon("terminal"),
      location: { viewColumn, preserveFocus: true },
    });

    const closeSub = vscode.window.onDidCloseTerminal((t) => {
      if (t !== terminal) return;
      this.terminals.delete(id);
      closeSub.dispose();
      writeEmitter.dispose();
      closeEmitter.dispose();
      ptyProcess?.kill();
      ptyProcess = undefined;
      this.changedEmitter.fire(this.activeIds());
    });

    this.terminals.set(id, {
      id,
      terminal,
      getPty: () => ptyProcess,
      subscriptions: [closeSub, writeEmitter, closeEmitter],
    });

    this.changedEmitter.fire(this.activeIds());
    return terminal;
  }

  get(id: number): vscode.Terminal | undefined {
    return this.terminals.get(id)?.terminal;
  }

  write(id: number, data: string): boolean {
    const ptyProcess = this.terminals.get(id)?.getPty();
    if (!ptyProcess) return false;
    try {
      ptyProcess.write(data);
      return true;
    } catch {
      return false;
    }
  }

  dispose(): void {
    for (const managed of this.terminals.values()) {
      for (const sub of managed.subscriptions) sub.dispose();
      managed.getPty()?.kill();
      managed.terminal.dispose();
    }
    this.terminals.clear();
    this.changedEmitter.dispose();
  }
}

function resolveShell(): { shellFile: string; shellArgs: string[] } {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec ?? "cmd.exe";
    return { shellFile: comspec, shellArgs: ["/c", "cc"] };
  }
  return { shellFile: "cc", shellArgs: [] };
}

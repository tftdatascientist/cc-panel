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
  private readonly dataEmitter = new vscode.EventEmitter<{ id: number; data: string }>();
  readonly onTerminalData = this.dataEmitter.event;

  activeIds(): number[] {
    return [...this.terminals.keys()].sort((a, b) => a - b);
  }

  create(
    id: number,
    location: vscode.ViewColumn | { parentTerminal: vscode.Terminal }
  ): vscode.Terminal {
    const existing = this.terminals.get(id);
    if (existing) {
      existing.terminal.show(true);
      return existing.terminal;
    }

    const writeEmitter = new vscode.EventEmitter<string>();
    const closeEmitter = new vscode.EventEmitter<number | void>();

    let ptyProcess: pty.IPty | undefined;
    let spawnDone = false;
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

    const spawnPty = (cols: number, rows: number): void => {
      if (spawnDone) {
        // Już spawnowany — tylko resize
        if (ptyProcess) {
          try { ptyProcess.resize(Math.max(10, cols), Math.max(1, rows)); } catch { /* ignoruj */ }
        }
        return;
      }
      spawnDone = true;
      if (fallbackTimer !== undefined) {
        clearTimeout(fallbackTimer);
        fallbackTimer = undefined;
      }

      const safeCols = Math.max(10, cols);
      const safeRows = Math.max(1, rows);
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();

      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === "string") env[k] = v;
      }
      env.CC_PANEL_TERMINAL_ID = String(id);
      env.COLUMNS = String(safeCols);
      env.LINES = String(safeRows);

      const command =
        vscode.workspace.getConfiguration("ccPanel").get<string>("command")?.trim() || "claude";
      const { shellFile, shellArgs } = resolveShell(command);

      try {
        ptyProcess = pty.spawn(shellFile, shellArgs, {
          name: "xterm-256color",
          cols: safeCols,
          rows: safeRows,
          cwd,
          env,
        });
      } catch (err) {
        // Pokaż błąd w terminalu
        writeEmitter.fire(`\r\n\x1b[31mCC Panel: nie udało się uruchomić "${command}"\r\n${err}\x1b[0m\r\n`);
        closeEmitter.fire(1);
        return;
      }

      ptyProcess.onData((data) => {
        writeEmitter.fire(data);
        this.dataEmitter.fire({ id, data });
      });
      ptyProcess.onExit(({ exitCode }) => {
        closeEmitter.fire(exitCode);
        ptyProcess = undefined;
        spawnDone = false; // pozwól na re-spawn gdyby terminal był ponownie otwarty
      });
    };

    const pseudoterminal: vscode.Pseudoterminal = {
      onDidWrite: writeEmitter.event,
      onDidClose: closeEmitter.event,

      open: (initialDimensions) => {
        if (initialDimensions && initialDimensions.columns > 0 && initialDimensions.rows > 0) {
          // VS Code dał wymiary od razu — spawn natychmiast
          spawnPty(initialDimensions.columns, initialDimensions.rows);
        } else {
          // Poczekaj na setDimensions, ale nie wiecznie — fallback po 300ms
          fallbackTimer = setTimeout(() => {
            fallbackTimer = undefined;
            if (!spawnDone) spawnPty(220, 50);
          }, 300);
        }
      },

      close: () => {
        if (fallbackTimer !== undefined) {
          clearTimeout(fallbackTimer);
          fallbackTimer = undefined;
        }
        ptyProcess?.kill();
        ptyProcess = undefined;
        spawnDone = false;
      },

      handleInput: (data) => {
        ptyProcess?.write(data);
      },

      setDimensions: (dim) => {
        spawnPty(dim.columns, dim.rows);
      },
    };

    const terminalLocation =
      typeof location === "object" && "parentTerminal" in location
        ? { parentTerminal: location.parentTerminal }
        : { viewColumn: location, preserveFocus: true };

    const terminal = vscode.window.createTerminal({
      name: `CC #${id}`,
      pty: pseudoterminal,
      iconPath: new vscode.ThemeIcon("terminal"),
      color: new vscode.ThemeColor(`ccPanel.terminal.t${id}`),
      location: terminalLocation,
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
    const p = this.terminals.get(id)?.getPty();
    if (!p) return false;
    try {
      p.write(data);
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
    this.dataEmitter.dispose();
  }
}

function resolveShell(command: string): { shellFile: string; shellArgs: string[] } {
  if (process.platform === "win32") {
    // /k zamiast /c — cmd pozostaje otwarty po zakończeniu CC,
    // co pozwala na ponowne uruchomienie bez zamykania terminala
    const comspec = process.env.ComSpec ?? "cmd.exe";
    return { shellFile: comspec, shellArgs: ["/k", command] };
  }
  return { shellFile: "/bin/sh", shellArgs: ["-c", command] };
}

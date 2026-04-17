import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as chokidar from "chokidar";

export interface TerminalState {
  terminal_id: number;
  updated_at?: string;
  model?: string;
  cost_usd?: number;
  mode?: string;
  session_id?: string | null;
  token_usage?: Record<string, unknown>;
  phase?: "idle" | "working" | "waiting" | "red";
  phase_changed_at?: string;
  last_message?: string;
  last_message_at?: string;
  raw?: unknown;
}

export class StateWatcher implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<TerminalState>();
  readonly onChange = this.emitter.event;
  private watcher?: chokidar.FSWatcher;
  private readonly stateDir = path.join(os.homedir(), ".claude", "cc-panel");

  start(): void {
    if (this.watcher) return;
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
    } catch {
      // ignore — chokidar otworzy i tak
    }

    const pattern = path.join(this.stateDir, "state.*.json");
    this.watcher = chokidar.watch(pattern, {
      persistent: true,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
    });

    this.watcher.on("add", (p) => this.read(p));
    this.watcher.on("change", (p) => this.read(p));
  }

  private read(filePath: string): void {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const state = JSON.parse(raw) as TerminalState;
      if (typeof state.terminal_id === "number") {
        this.emitter.fire(state);
      }
    } catch {
      // plik jeszcze nie skompletowany / uszkodzony — chokidar zrobi następny event
    }
  }

  async dispose(): Promise<void> {
    await this.watcher?.close();
    this.watcher = undefined;
    this.emitter.dispose();
  }
}

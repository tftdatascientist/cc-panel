import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import chokidar from "chokidar";
import { readMetrics, resetCache, TranscriptMetrics } from "./TranscriptReader";
import { TerminalId, isTerminalId } from "../panel/messages";

export interface TerminalDashboardSnapshot {
  id: TerminalId;
  model: string | null;
  ctxPct: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  phase: string | null;
}

export type DashboardMap = Partial<Record<TerminalId, TerminalDashboardSnapshot>>;

interface StateFileShape {
  transcript_path?: string;
  last_message?: string;
  last_message_at?: string;
  phase?: string;
  session_id?: string | null;
  terminal_id?: number;
}

const TERMINAL_IDS: TerminalId[] = [1, 2, 3, 4];
const STATE_DIR = path.join(os.homedir(), ".claude", "cc-panel");
const DEBOUNCE_MS = 150;

export class StateWatcher implements vscode.Disposable {
  private stateWatcher: chokidar.FSWatcher | undefined;
  private transcriptWatcher: chokidar.FSWatcher | undefined;
  private readonly snapshots: DashboardMap = {};
  private readonly transcriptByTerminal = new Map<TerminalId, string>();
  private readonly terminalByTranscript = new Map<string, TerminalId>();
  private readonly emitter = new vscode.EventEmitter<DashboardMap>();
  private readonly pendingTimers = new Map<TerminalId, NodeJS.Timeout>();

  readonly onChange = this.emitter.event;

  start(): void {
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    } catch {
      // dir unavailable → watcher will silently not match anything
    }

    const statePatterns = TERMINAL_IDS.map((id) =>
      path.join(STATE_DIR, `state.${id}.json`)
    );

    this.stateWatcher = chokidar.watch(statePatterns, {
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 40 },
    });
    this.stateWatcher.on("add", (p) => this.handleStateChange(p));
    this.stateWatcher.on("change", (p) => this.handleStateChange(p));
    this.stateWatcher.on("unlink", (p) => this.handleStateUnlink(p));

    this.transcriptWatcher = chokidar.watch([], {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 40 },
    });
    this.transcriptWatcher.on("change", (p) => this.handleTranscriptChange(p));

    for (const id of TERMINAL_IDS) {
      this.scheduleRefresh(id);
    }
  }

  dispose(): void {
    void this.stateWatcher?.close();
    void this.transcriptWatcher?.close();
    for (const t of this.pendingTimers.values()) clearTimeout(t);
    this.pendingTimers.clear();
    this.emitter.dispose();
  }

  snapshot(): DashboardMap {
    return { ...this.snapshots };
  }

  private handleStateChange(p: string): void {
    const id = terminalIdFromStatePath(p);
    if (!id) return;
    this.scheduleRefresh(id);
  }

  private handleStateUnlink(p: string): void {
    const id = terminalIdFromStatePath(p);
    if (!id) return;
    delete this.snapshots[id];
    const prevTranscript = this.transcriptByTerminal.get(id);
    if (prevTranscript) {
      this.terminalByTranscript.delete(prevTranscript);
      void this.transcriptWatcher?.unwatch(prevTranscript);
      resetCache(prevTranscript);
    }
    this.transcriptByTerminal.delete(id);
    this.emitter.fire(this.snapshot());
  }

  private handleTranscriptChange(p: string): void {
    const id = this.terminalByTranscript.get(normalize(p));
    if (!id) return;
    this.scheduleRefresh(id);
  }

  private scheduleRefresh(id: TerminalId): void {
    const existing = this.pendingTimers.get(id);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this.pendingTimers.delete(id);
      void this.refresh(id);
    }, DEBOUNCE_MS);
    this.pendingTimers.set(id, t);
  }

  private async refresh(id: TerminalId): Promise<void> {
    const statePath = path.join(STATE_DIR, `state.${id}.json`);
    const state = await readStateFile(statePath);
    const transcriptPath = state?.transcript_path
      ? normalize(state.transcript_path)
      : undefined;

    this.updateTranscriptBinding(id, transcriptPath);

    let metrics: TranscriptMetrics | null = null;
    if (transcriptPath) {
      try {
        metrics = await readMetrics(transcriptPath);
      } catch (err) {
        console.error(`[cc-panel] StateWatcher T${id} readMetrics error:`, err);
        metrics = null;
      }
    }
    console.log(`[cc-panel] StateWatcher T${id} refresh: transcript=${transcriptPath ?? "none"} metrics=${metrics ? `ctx=${metrics.ctxPct}% cost=$${metrics.costUsd.toFixed(3)}` : "null"} lastMsg=${state?.last_message?.slice(0, 30) ?? "none"}`);

    this.snapshots[id] = {
      id,
      model: metrics?.model ?? null,
      ctxPct: metrics ? metrics.ctxPct : null,
      totalTokens: metrics ? metrics.totalTokens : null,
      costUsd: metrics ? metrics.costUsd : null,
      lastMessage: state?.last_message ?? null,
      lastMessageAt: state?.last_message_at ?? null,
      phase: state?.phase ?? null,
    };
    this.emitter.fire(this.snapshot());
  }

  private updateTranscriptBinding(id: TerminalId, newPath: string | undefined): void {
    const prev = this.transcriptByTerminal.get(id);
    if (prev === newPath) return;
    if (prev) {
      this.terminalByTranscript.delete(prev);
      void this.transcriptWatcher?.unwatch(prev);
      resetCache(prev);
    }
    if (newPath) {
      this.transcriptByTerminal.set(id, newPath);
      this.terminalByTranscript.set(newPath, id);
      try {
        this.transcriptWatcher?.add(newPath);
      } catch {
        // file may not exist yet — watcher retries on next emit
      }
    } else {
      this.transcriptByTerminal.delete(id);
    }
  }
}

function terminalIdFromStatePath(p: string): TerminalId | undefined {
  const base = path.basename(p);
  const match = base.match(/^state\.([1-4])\.json$/);
  if (!match) return undefined;
  const id = Number(match[1]);
  return isTerminalId(id) ? id : undefined;
}

async function readStateFile(p: string): Promise<StateFileShape | null> {
  try {
    const text = await fs.promises.readFile(p, "utf8");
    return JSON.parse(text) as StateFileShape;
  } catch {
    return null;
  }
}

function normalize(p: string): string {
  return path.normalize(p);
}

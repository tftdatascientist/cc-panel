import * as vscode from "vscode";
import type { TerminalId } from "../panel/messages";
import type { DashboardMap, StateWatcher } from "../state/StateWatcher";

/**
 * Wykrywa krawędź `working→waiting` dla jednego aktywnego terminala AA (scope D2).
 *
 * Kontrakt: subskrybuje `StateWatcher.onChange` (który emituje całą DashboardMap),
 * filtruje po `activeTerminalId`, porównuje `phase` z poprzednim stanem per-terminal.
 * Gdy `prev === "working"` i `now === "waiting"` emituje TriggerEvent.
 *
 * Debounce 3000ms (plan `docs/AUTO_ACCEPT_PLAN.md → Decyzje odłożone`) — chroni
 * przed powtórnym wyzwoleniem gdy hook statusline zapisze phase=waiting kilka razy
 * w serii, a także daje user szansę na własny wpis zanim Haiku przejmie klawiaturę.
 */

export interface TriggerEvent {
  terminalId: TerminalId;
  timestamp: number;
  /** Ile ms minęło od momentu wejścia w working (ostatnie przejście in → working). */
  reactionMs: number;
}

type Phase = "working" | "waiting";

function normalizePhase(raw: string | null | undefined): Phase | null {
  if (raw === "working" || raw === "waiting") return raw;
  return null;
}

export interface TriggerDetectorOptions {
  debounceMs?: number;
}

export class TriggerDetector implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<TriggerEvent>();
  private readonly lastPhase = new Map<TerminalId, Phase>();
  private readonly workingStartedAt = new Map<TerminalId, number>();
  private activeTerminalId: TerminalId | null = null;
  private lastEmitAt = 0;
  private readonly debounceMs: number;
  private stateSub: vscode.Disposable | null = null;

  readonly onTrigger = this.emitter.event;

  constructor(private readonly stateWatcher: StateWatcher, opts: TriggerDetectorOptions = {}) {
    this.debounceMs = opts.debounceMs ?? 3000;
  }

  /**
   * Uruchamia detekcję dla wybranego terminala. Wywołanie drugi raz bez stop()
   * przełącza target (reset lastPhase dla poprzedniego terminala byłby opcjonalny,
   * ale scope D2 = single-active, więc to edge case).
   */
  start(terminalId: TerminalId): void {
    this.activeTerminalId = terminalId;
    this.lastPhase.clear();
    this.workingStartedAt.clear();
    this.lastEmitAt = 0;

    const initial = this.stateWatcher.snapshot();
    const snap = initial[terminalId];
    const phase = normalizePhase(snap?.phase ?? null);
    if (phase) {
      this.lastPhase.set(terminalId, phase);
      if (phase === "working") this.workingStartedAt.set(terminalId, Date.now());
    }

    this.stateSub?.dispose();
    this.stateSub = this.stateWatcher.onChange((map) => this.handleChange(map));
  }

  stop(): void {
    this.activeTerminalId = null;
    this.stateSub?.dispose();
    this.stateSub = null;
    this.lastPhase.clear();
    this.workingStartedAt.clear();
  }

  dispose(): void {
    this.stop();
    this.emitter.dispose();
  }

  private handleChange(map: DashboardMap): void {
    const id = this.activeTerminalId;
    if (id === null) return;
    const snap = map[id];
    if (!snap) return;

    const now = normalizePhase(snap.phase);
    if (!now) return;

    const prev = this.lastPhase.get(id);
    this.lastPhase.set(id, now);

    if (now === "working" && prev !== "working") {
      this.workingStartedAt.set(id, Date.now());
      return;
    }

    if (prev === "working" && now === "waiting") {
      const nowMs = Date.now();
      if (nowMs - this.lastEmitAt < this.debounceMs) return;

      const startedAt = this.workingStartedAt.get(id) ?? nowMs;
      this.workingStartedAt.delete(id);
      this.lastEmitAt = nowMs;

      this.emitter.fire({
        terminalId: id,
        timestamp: nowMs,
        reactionMs: nowMs - startedAt,
      });
    }
  }
}

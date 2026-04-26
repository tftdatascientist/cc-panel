import * as vscode from "vscode";
import type { TerminalId } from "../panel/messages";
import type {
  AutoAcceptConfig,
  AutoAcceptStatus,
  AutoAcceptStopReason,
  HaikuResponse,
} from "./types";
import { BudgetEnforcer } from "./BudgetEnforcer";
import { TriggerDetector, type TriggerEvent } from "./TriggerDetector";
import { SessionLogger, newSessionId } from "./SessionLogger";

/**
 * Orkiestrator AA session. Łączy TriggerDetector → BudgetEnforcer → Haiku →
 * writeToTerminal → SessionLogger.
 *
 * Lifecycle:
 *   new → start(config) → [edges & dispatches] → stop(reason) | dispose()
 *
 * Emituje `onStatus` po każdej zmianie stanu (iteracja, dispatch start/end, stop).
 * Konsument (extension.ts) forward'uje do webview jako banner.
 *
 * Busy-skip (plan docs/AUTO_ACCEPT_PLAN.md → Semantyka interrupt): trigger
 * podczas trwającego `invokeHaiku` nie jest kolejkowany, tylko logowany jako
 * `skipped-busy` — CC i tak dostanie nową odpowiedź gdy bieżący dispatch się skończy.
 */

export interface HaikuInvoker {
  invokeHaiku(opts: {
    prompt: string;
    systemPrompt?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  }): Promise<HaikuResponse>;
}

export interface RecentMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AutoAcceptDeps {
  triggerDetector: TriggerDetector;
  haikuClient: HaikuInvoker;
  writeToTerminal: (id: TerminalId, text: string) => boolean;
  /**
   * Zwraca ostatnie N wiadomości z transcriptu CC dla aktywnego terminala (Plan
   * Decyzja 3b). Jeśli transcript nieczytelny lub brak — zwraca []; AA wtedy
   * wysyła Haiku tylko metaPrompt+systemPrompt (MVP-fallback).
   */
  getRecentMessages: (id: TerminalId, limit: number) => Promise<RecentMessage[]>;
  /**
   * Zwraca aktualny skumulowany koszt sesji CC (z TranscriptReader) dla danego
   * terminala. Używane do limitu kosztowego — liczymy koszt CC (Sonnet/Opus),
   * nie Haiku. Zwraca 0 gdy brak danych.
   */
  getCcCostUsd: (id: TerminalId) => number;
}

const CONSECUTIVE_ERROR_LIMIT = 3;
const RECENT_MESSAGES_LIMIT = 5;
const MESSAGE_SNIPPET_MAX_CHARS = 2000;

export class AutoAcceptSession implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<AutoAcceptStatus>();
  readonly onStatus = this.emitter.event;

  private sessionId: string | null = null;
  private config: AutoAcceptConfig | null = null;
  private startedAt: number | null = null;
  private budget: BudgetEnforcer | null = null;
  private logger: SessionLogger | null = null;
  private triggerSub: vscode.Disposable | null = null;
  private currentAbort: AbortController | null = null;
  private consecutiveErrors = 0;
  private lastError: string | null = null;
  private inFlight = false;
  private stopped = false;
  private stopReason: AutoAcceptStopReason | null = null;
  /** Koszt CC w momencie startu AA — baseline do obliczenia kosztu narosłego w sesji. */
  private startCostUsd = 0;
  /** Aktualny koszt CC narosły od startu AA (ostatnio odczytana wartość). */
  private cumulativeCcCostUsd = 0;

  constructor(private readonly deps: AutoAcceptDeps) {}

  isActive(): boolean {
    return this.config !== null && !this.stopped;
  }

  getStatus(): AutoAcceptStatus {
    return {
      active: this.isActive(),
      terminalId: this.config?.terminalId ?? null,
      startedAt: this.startedAt,
      iterationsUsed: this.budget?.getIterationsUsed() ?? 0,
      cumulativeCostUsd: this.cumulativeCcCostUsd,
      lastError: this.lastError,
      stopReason: this.stopReason,
      config: this.config,
    };
  }

  start(config: AutoAcceptConfig): void {
    if (this.isActive()) {
      throw new Error("AutoAcceptSession is already active. Stop it first.");
    }

    this.stopped = false;
    this.stopReason = null;
    this.sessionId = newSessionId();
    this.config = config;
    this.startedAt = Date.now();
    this.budget = new BudgetEnforcer(config, this.startedAt);
    this.logger = new SessionLogger(this.sessionId);
    this.consecutiveErrors = 0;
    this.lastError = null;
    this.inFlight = false;
    this.startCostUsd = this.deps.getCcCostUsd(config.terminalId);
    this.cumulativeCcCostUsd = 0;

    this.logger.logStart(config.terminalId, config);

    this.deps.triggerDetector.start(config.terminalId);
    this.triggerSub = this.deps.triggerDetector.onTrigger((e) => {
      void this.handleTrigger(e);
    });

    this.emitStatus();
  }

  /** Programmatic stop (user-stop / panel-dispose / itd.). Idempotent. */
  stop(reason: AutoAcceptStopReason): void {
    if (this.stopped) return;
    this.stopped = true;
    this.stopReason = reason;

    this.currentAbort?.abort();
    this.currentAbort = null;

    this.triggerSub?.dispose();
    this.triggerSub = null;
    this.deps.triggerDetector.stop();

    const iter = this.budget?.getIterationsUsed() ?? 0;
    this.logger?.logStop(reason, iter, this.cumulativeCcCostUsd);

    this.emitStatus();
  }

  dispose(): void {
    if (this.isActive()) {
      this.stop("panel-dispose");
    }
    this.emitter.dispose();
  }

  private async handleTrigger(event: TriggerEvent): Promise<void> {
    if (this.stopped || !this.config || !this.budget || !this.logger) return;

    const iter = this.budget.getIterationsUsed() + 1;

    if (this.inFlight) {
      this.logger.logTrigger(event.terminalId, iter, "skipped-busy", event.reactionMs);
      return;
    }

    const budgetDecision = this.budget.check();
    if (!budgetDecision.ok) {
      this.stop(budgetDecision.reason);
      return;
    }
    if (this.checkCostLimit()) {
      this.stop("cost-limit");
      return;
    }

    this.logger.logTrigger(event.terminalId, iter, "waiting-edge", event.reactionMs);
    this.inFlight = true;
    this.emitStatus();

    const abort = new AbortController();
    this.currentAbort = abort;

    let recent: RecentMessage[] = [];
    try {
      recent = await this.deps.getRecentMessages(this.config.terminalId, RECENT_MESSAGES_LIMIT);
    } catch {
      recent = [];
    }
    if (this.stopped || abort.signal.aborted) {
      this.inFlight = false;
      this.currentAbort = null;
      return;
    }
    const prompt = buildPromptWithContext(this.config.metaPrompt, recent);

    let response: HaikuResponse | null = null;
    try {
      response = await this.deps.haikuClient.invokeHaiku({
        prompt,
        systemPrompt: this.config.systemPrompt || undefined,
        signal: abort.signal,
      });
      this.consecutiveErrors = 0;
      this.lastError = null;
    } catch (err) {
      if (this.stopped || abort.signal.aborted) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      const exitCode =
        typeof err === "object" && err !== null && "exitCode" in err
          ? Number((err as { exitCode: unknown }).exitCode) || undefined
          : undefined;
      this.consecutiveErrors += 1;
      this.lastError = msg;
      this.budget.recordFailedIteration();
      this.logger.logHaikuError(iter, msg, exitCode);
      if (this.consecutiveErrors >= CONSECUTIVE_ERROR_LIMIT) {
        this.stop("cli-errors");
        return;
      }
      return;
    } finally {
      this.inFlight = false;
      this.currentAbort = null;
    }

    if (this.stopped || !response) return;

    this.logger.logHaikuResponse(iter, response);
    this.budget.recordIteration();
    this.cumulativeCcCostUsd = Math.max(0, this.deps.getCcCostUsd(this.config.terminalId) - this.startCostUsd);

    const text = response.result.trim();
    if (text.length === 0) {
      this.emitStatus();
      return;
    }

    const sent = this.deps.writeToTerminal(this.config.terminalId, text + "\r");
    if (!sent) {
      this.logger.logWriteFailure(this.config.terminalId, iter);
      this.lastError = "writeToTerminal returned false";
      this.stop("cli-errors");
      return;
    }
    this.logger.logSendToTerminal(this.config.terminalId, iter, text);

    const budgetAfter = this.budget.check();
    if (!budgetAfter.ok) {
      this.stop(budgetAfter.reason);
      return;
    }
    if (this.checkCostLimit()) {
      this.stop("cost-limit");
      return;
    }

    this.emitStatus();
  }

  private checkCostLimit(): boolean {
    if (!this.config || this.config.costLimitUsd === null) return false;
    return this.cumulativeCcCostUsd >= this.config.costLimitUsd;
  }

  private emitStatus(): void {
    this.emitter.fire(this.getStatus());
  }
}

/**
 * Składa prompt dla Haiku: sekcja "Recent conversation" z ostatnimi wiadomościami
 * CC (user/assistant, obcięte do MESSAGE_SNIPPET_MAX_CHARS) + metaPrompt usera.
 * Gdy `recent` jest pusty, zwraca sam metaPrompt (MVP-fallback gdy transcript
 * niedostępny albo brak wiadomości).
 */
export function buildPromptWithContext(
  metaPrompt: string,
  recent: RecentMessage[],
): string {
  if (recent.length === 0) return metaPrompt;
  const lines: string[] = ["Transcript (last messages from this Claude Code session):", ""];
  for (const m of recent) {
    const label = m.role === "user" ? "USER" : "CLAUDE CODE";
    const snippet =
      m.text.length > MESSAGE_SNIPPET_MAX_CHARS
        ? m.text.slice(0, MESSAGE_SNIPPET_MAX_CHARS) + "…[truncated]"
        : m.text;
    lines.push(`${label}: ${snippet}`);
    lines.push("");
  }
  lines.push("---");
  lines.push(metaPrompt);
  return lines.join("\n");
}

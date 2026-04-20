import type { TerminalId } from "../panel/messages";

/**
 * `null` oznacza "bez limitu" (decyzja usera D4 / 2026-04-20, wariant c).
 * Gdy wszystkie 3 są null, jedyne hard-stopy: user stop, circuit breaker,
 * panel dispose, 3× exit code != 0.
 */
export interface AutoAcceptConfig {
  terminalId: TerminalId;
  timeLimitMs: number | null;
  costLimitUsd: number | null;
  maxIterations: number | null;
  systemPrompt: string;
  metaPrompt: string;
}

export type AutoAcceptStopReason =
  | "time-limit"
  | "cost-limit"
  | "iter-limit"
  | "circuit-breaker"
  | "user-stop"
  | "panel-dispose"
  | "cli-errors"
  | "idle-stop";

export interface IterationRecord {
  iter: number;
  triggeredAt: number;
  reactionMs: number;
  prompt: string;
  response?: HaikuResponse;
  error?: string;
  sentToTerminal: boolean;
}

/** Kontrakt CLI `claude -p --output-format json` (potwierdzony smoke testem 2026-04-20). */
export interface HaikuResponse {
  result: string;
  totalCostUsd: number;
  durationMs: number;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
}

export interface AutoAcceptStatus {
  active: boolean;
  terminalId: TerminalId | null;
  startedAt: number | null;
  iterationsUsed: number;
  cumulativeCostUsd: number;
  lastError: string | null;
  config: AutoAcceptConfig | null;
}

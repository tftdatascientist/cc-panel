import type { AutoAcceptConfig, AutoAcceptStopReason } from "./types";

/**
 * Sprawdza limity sesji AA: czas, iteracje, cumulative cost.
 *
 * Semantyka D4 (wariant c, 2026-04-20): każdy limit może być `null` = bez limitu.
 * Gdy wszystkie 3 są null, `check()` nigdy nie zwraca stop z tego enforcera —
 * jedyne hard-stopy to user-stop / panel-dispose / cli-errors / circuit-breaker.
 *
 * Cost akumulowany przez `recordIteration(costUsd)` — wywoływane po udanej
 * odpowiedzi Haiku. Nieudane iteracje (error) nie wpływają na cumulative cost,
 * ale liczą się do `iterationsUsed` (bo wydały zasób kontekstowy CC).
 */
export interface BudgetDecisionOk {
  ok: true;
}

export interface BudgetDecisionStop {
  ok: false;
  reason: Extract<AutoAcceptStopReason, "time-limit" | "cost-limit" | "iter-limit">;
}

export type BudgetDecision = BudgetDecisionOk | BudgetDecisionStop;

export class BudgetEnforcer {
  private iterationsUsed = 0;

  constructor(private readonly config: AutoAcceptConfig, private readonly startedAt: number) {}

  /** Sprawdza limity czasu i iteracji. Limit kosztowy sprawdzany osobno w AutoAcceptSession
   * (na podstawie kosztu CC z TranscriptReader, nie kosztu wywołań Haiku). */
  check(now = Date.now()): BudgetDecision {
    if (this.config.timeLimitMs !== null && now - this.startedAt >= this.config.timeLimitMs) {
      return { ok: false, reason: "time-limit" };
    }
    if (this.config.maxIterations !== null && this.iterationsUsed >= this.config.maxIterations) {
      return { ok: false, reason: "iter-limit" };
    }
    return { ok: true };
  }

  recordIteration(): void {
    this.iterationsUsed += 1;
  }

  /** Iteracja rozpoczęta ale nieudana (np. Haiku CLI error) — licznik iteracji. */
  recordFailedIteration(): void {
    this.iterationsUsed += 1;
  }

  getIterationsUsed(): number {
    return this.iterationsUsed;
  }

  getTimeLeftMs(now = Date.now()): number | null {
    if (this.config.timeLimitMs === null) return null;
    const left = this.config.timeLimitMs - (now - this.startedAt);
    return Math.max(0, left);
  }
}

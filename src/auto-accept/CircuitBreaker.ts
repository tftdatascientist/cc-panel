/**
 * Wykrywa zacięcie sesji AA na podstawie ostatnich N outputów Haiku.
 *
 * Dwie heurystyki:
 *
 * 1. **Levenshtein similarity > threshold (default 0.80)** na KAŻDEJ parze w oknie
 *    ostatnich 3 odpowiedzi. Gdy wszystkie pary są podobne, zakładamy pętlę.
 *    D4 implikacja (2026-04-20): threshold 0.80 zamiast 0.85 z oryginalnego planu,
 *    bo przy wariancie "bez limitu" CircuitBreaker jest jedyną automatyczną ochroną.
 *
 * 2. **Idle-iterations**: 3× z rzędu długość odpowiedzi ±10% od średniej.
 *    Wykrywa subtelniejszą pętlę gdy treść różni się (np. numerowanie kroków),
 *    ale "kształt" odpowiedzi się nie zmienia — sugeruje że Haiku kręci w miejscu.
 */

export interface CircuitBreakerOptions {
  similarityThreshold?: number;
  windowSize?: number;
  lengthTolerance?: number;
}

export interface CircuitBreakerDecision {
  tripped: boolean;
  reason?: "similarity" | "idle-length";
  detail?: string;
}

export class CircuitBreaker {
  private readonly history: string[] = [];
  private readonly threshold: number;
  private readonly windowSize: number;
  private readonly lengthTolerance: number;

  constructor(opts: CircuitBreakerOptions = {}) {
    this.threshold = opts.similarityThreshold ?? 0.80;
    this.windowSize = opts.windowSize ?? 3;
    this.lengthTolerance = opts.lengthTolerance ?? 0.10;
  }

  /**
   * Dodaje kolejną odpowiedź i zwraca decyzję czy zatrzymać sesję.
   * Dopóki historia ma < windowSize elementów, zawsze `tripped=false`.
   */
  analyze(response: string): CircuitBreakerDecision {
    this.history.push(response);
    if (this.history.length > this.windowSize) {
      this.history.shift();
    }
    if (this.history.length < this.windowSize) {
      return { tripped: false };
    }

    const simDecision = this.checkSimilarity();
    if (simDecision.tripped) return simDecision;

    const idleDecision = this.checkIdleLength();
    if (idleDecision.tripped) return idleDecision;

    return { tripped: false };
  }

  reset(): void {
    this.history.length = 0;
  }

  private checkSimilarity(): CircuitBreakerDecision {
    let minRatio = 1;
    for (let i = 0; i < this.history.length; i++) {
      for (let j = i + 1; j < this.history.length; j++) {
        const r = similarityRatio(this.history[i], this.history[j]);
        if (r < minRatio) minRatio = r;
      }
    }
    if (minRatio >= this.threshold) {
      return {
        tripped: true,
        reason: "similarity",
        detail: `min pairwise similarity ${minRatio.toFixed(3)} >= threshold ${this.threshold}`,
      };
    }
    return { tripped: false };
  }

  private checkIdleLength(): CircuitBreakerDecision {
    const lens = this.history.map((s) => s.length);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    if (avg === 0) return { tripped: false };
    const tol = avg * this.lengthTolerance;
    const allWithinBand = lens.every((l) => Math.abs(l - avg) <= tol);
    if (allWithinBand) {
      return {
        tripped: true,
        reason: "idle-length",
        detail: `all ${lens.length} responses within ±${(this.lengthTolerance * 100).toFixed(0)}% of avg length ${avg.toFixed(0)}`,
      };
    }
    return { tripped: false };
  }
}

/**
 * Levenshtein similarity ratio w zakresie [0, 1].
 * 1.0 = identyczne, 0.0 = kompletnie różne.
 * Dla pustych stringów: dwa puste → 1.0; jeden pusty → 0.0.
 */
export function similarityRatio(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(a, b);
  return 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

import * as vscode from "vscode";
import type { TerminalId } from "../panel/messages";
import type { AutoAcceptConfig } from "./types";

/**
 * Sekwencyjny QuickPick wizard dla `ccPanel.startAutoAccept`.
 * Każdy krok: Escape → undefined → anulujemy cały wizard (nie częściowy stan).
 *
 * Domyślne wartości (Plan + D3 2026-04-20, cost urealniony po smoke teście):
 *   time 15 min / cost $5.00 / iter 50. Każdy może być `null` (wariant D4c).
 */

interface StartWizardDeps {
  availableTerminals: TerminalId[];
  defaultSystemPrompt: string;
  defaultMetaPrompt: string;
}

export async function runStartWizard(deps: StartWizardDeps): Promise<AutoAcceptConfig | null> {
  if (deps.availableTerminals.length === 0) {
    void vscode.window.showWarningMessage(
      "CC Panel: brak aktywnych terminali. Otwórz terminal (CC Panel: Open) przed startem Auto-Accept.",
    );
    return null;
  }

  const terminalId = await pickTerminal(deps.availableTerminals);
  if (terminalId === null) return null;

  const timeLimitMs = await pickTimeLimit();
  if (timeLimitMs === undefined) return null;

  const costLimitUsd = await pickCostLimit();
  if (costLimitUsd === undefined) return null;

  const maxIterations = await pickIterLimit();
  if (maxIterations === undefined) return null;

  const systemPrompt = await pickSystemPrompt(deps.defaultSystemPrompt);
  if (systemPrompt === null) return null;

  return {
    terminalId,
    timeLimitMs,
    costLimitUsd,
    maxIterations,
    systemPrompt,
    metaPrompt: deps.defaultMetaPrompt,
  };
}

async function pickTerminal(available: TerminalId[]): Promise<TerminalId | null> {
  const LABELS: Record<TerminalId, string> = {
    1: "T1 — teal",
    2: "T2 — amber",
    3: "T3 — purple",
    4: "T4 — coral",
  };
  const pick = await vscode.window.showQuickPick(
    available.map((id) => ({ label: LABELS[id], id })),
    { title: "Auto-Accept: który terminal? (1/5)", placeHolder: "Wybierz aktywny terminal" },
  );
  return pick?.id ?? null;
}

async function pickTimeLimit(): Promise<number | null | undefined> {
  interface Opt { label: string; ms: number | null }
  const opts: Opt[] = [
    { label: "5 minut", ms: 5 * 60 * 1000 },
    { label: "15 minut (domyślne)", ms: 15 * 60 * 1000 },
    { label: "1 godzina", ms: 60 * 60 * 1000 },
    { label: "5 godzin", ms: 5 * 60 * 60 * 1000 },
    { label: "∞ bez limitu czasu", ms: null },
  ];
  const pick = await vscode.window.showQuickPick(opts, {
    title: "Auto-Accept: limit czasu? (2/5)",
    placeHolder: "Po tym czasie AA zatrzyma się automatycznie",
  });
  if (!pick) return undefined;
  return pick.ms;
}

async function pickCostLimit(): Promise<number | null | undefined> {
  const input = await vscode.window.showInputBox({
    title: "Auto-Accept: limit kosztu w USD? (3/5)",
    prompt: "Realny koszt Haiku ~$0.07/iter. Wpisz 0 dla braku limitu.",
    value: "5.00",
    validateInput: (v) => {
      if (v.trim() === "") return "Wpisz liczbę albo 0";
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return "Nieprawidłowa kwota";
      return undefined;
    },
  });
  if (input === undefined) return undefined;
  const n = Number(input);
  return n === 0 ? null : n;
}

async function pickIterLimit(): Promise<number | null | undefined> {
  const input = await vscode.window.showInputBox({
    title: "Auto-Accept: limit iteracji? (4/5)",
    prompt: "Maksymalna liczba odpowiedzi Haiku. Wpisz 0 dla braku limitu.",
    value: "50",
    validateInput: (v) => {
      if (v.trim() === "") return "Wpisz liczbę całkowitą albo 0";
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) return "Musi być liczbą całkowitą ≥ 0";
      return undefined;
    },
  });
  if (input === undefined) return undefined;
  const n = Number(input);
  return n === 0 ? null : n;
}

async function pickSystemPrompt(defaultPrompt: string): Promise<string | null> {
  const pick = await vscode.window.showQuickPick(
    [
      { label: "Użyj domyślnego system promptu", useDefault: true },
      { label: "Edytuj system prompt…", useDefault: false },
    ],
    { title: "Auto-Accept: system prompt? (5/5)", placeHolder: defaultPrompt.slice(0, 80) + "…" },
  );
  if (!pick) return null;
  if (pick.useDefault) return defaultPrompt;

  const edited = await vscode.window.showInputBox({
    title: "Auto-Accept: edytuj system prompt",
    value: defaultPrompt,
    prompt: "Ten prompt steruje zachowaniem Haiku — określa jak ma odpowiadać.",
  });
  if (edited === undefined) return null;
  return edited;
}

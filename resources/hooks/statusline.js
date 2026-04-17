#!/usr/bin/env node
/*
 * cc-panel statusline hook.
 * CC wywołuje ten skrypt per aktualizacja status line. Skrypt:
 *   - czyta JSON ze stdin (payload CC),
 *   - zapisuje znormalizowany stan do ~/.claude/cc-panel/state.{CC_PANEL_TERMINAL_ID}.json,
 *   - na stdout wypluwa krótki tekst renderowany przez CC w terminalu.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const terminalId = String(process.env.CC_PANEL_TERMINAL_ID || "");
if (!/^[1-4]$/.test(terminalId)) {
  // sesja nie jest spawnowana przez cc-panel — cichy no-op (bez stdout, żeby nie łamać
  // custom statusLine users i tak mają od Anthropic lub ccstatusline).
  process.exit(0);
}
const stateDir = path.join(os.homedir(), ".claude", "cc-panel");
const statePath = path.join(stateDir, `state.${terminalId}.json`);

let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdin += chunk;
});
process.stdin.on("end", () => {
  let input = {};
  try {
    input = stdin ? JSON.parse(stdin) : {};
  } catch {
    input = { parse_error: true };
  }

  const model =
    (input.model && (input.model.display_name || input.model.id)) ||
    input.model_name ||
    "?";
  const costUsd =
    input.cost && typeof input.cost.total_cost_usd === "number"
      ? input.cost.total_cost_usd
      : undefined;
  const mode = input.output_style || input.mode || "default";
  const tokenUsage = input.token_usage || input.usage || {};

  // Wszystkie Claude 4.x mają okno 200k — ctx_pct = suma wejściowych tokenów / 200k.
  const CONTEXT_WINDOW = 200_000;
  const inputTotal =
    (Number(tokenUsage.input_tokens) || 0) +
    (Number(tokenUsage.cache_read_input_tokens) || 0) +
    (Number(tokenUsage.cache_creation_input_tokens) || 0);
  const ctxPct =
    inputTotal > 0
      ? Math.min(100, Math.round((inputTotal / CONTEXT_WINDOW) * 100))
      : undefined;

  const state = {
    updated_at: new Date().toISOString(),
    terminal_id: Number(terminalId) || 0,
    model,
    cost_usd: costUsd,
    mode,
    session_id: input.session_id || null,
    token_usage: tokenUsage,
    ctx_pct: ctxPct,
    raw: input,
  };

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (err) {
    process.stderr.write(`cc-panel statusline: ${err && err.message}\n`);
  }

  const costStr = typeof costUsd === "number" ? ` $${costUsd.toFixed(2)}` : "";
  const ctxStr = typeof ctxPct === "number" ? ` ctx:${ctxPct}%` : "";
  process.stdout.write(`T${terminalId} ${model}${costStr}${ctxStr}`);
});

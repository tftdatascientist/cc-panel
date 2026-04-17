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

const terminalId = String(process.env.CC_PANEL_TERMINAL_ID || "0");
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

  const state = {
    updated_at: new Date().toISOString(),
    terminal_id: Number(terminalId) || 0,
    model,
    cost_usd: costUsd,
    mode,
    session_id: input.session_id || null,
    token_usage: tokenUsage,
    raw: input,
  };

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (err) {
    process.stderr.write(`cc-panel statusline: ${err && err.message}\n`);
  }

  const costStr = typeof costUsd === "number" ? ` $${costUsd.toFixed(2)}` : "";
  process.stdout.write(`T${terminalId} ${model}${costStr}`);
});

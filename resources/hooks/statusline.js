#!/usr/bin/env node
/*
 * cc-panel statusline hook (chain-capable).
 * - czyta JSON ze stdin (payload CC),
 * - zapisuje znormalizowany stan do ~/.claude/cc-panel/state.{CC_PANEL_TERMINAL_ID}.json,
 * - jesli ~/.claude/cc-panel/chain.json zawiera { statusLineCommand } -> spawnSync ten command
 *   z tym samym stdin i forwarduje jego stdout (chain: zachowujemy np. ccstatusline usera),
 * - w przeciwnym razie wypluwa prosty format "T{id} {model}${cost} ctx:NN%".
 */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const terminalId = String(process.env.CC_PANEL_TERMINAL_ID || "");
if (!/^[1-4]$/.test(terminalId)) {
  process.exit(0);
}
const stateDir = path.join(os.homedir(), ".claude", "cc-panel");
const statePath = path.join(stateDir, `state.${terminalId}.json`);
const chainPath = path.join(stateDir, "chain.json");

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

  // Merge: zachowaj phase/last_message z poprzedniego state (pisane przez userpromptsubmit/stop)
  try {
    if (fs.existsSync(statePath)) {
      const prev = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (prev && typeof prev === "object") {
        if (prev.phase) state.phase = prev.phase;
        if (prev.phase_changed_at) state.phase_changed_at = prev.phase_changed_at;
        if (prev.last_message) state.last_message = prev.last_message;
        if (prev.last_message_at) state.last_message_at = prev.last_message_at;
        if (prev.transcript_path) state.transcript_path = prev.transcript_path;
      }
    }
  } catch {
    // corrupted prev — pomijamy
  }

  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (err) {
    process.stderr.write(`cc-panel statusline: ${err && err.message}\n`);
  }

  // Chain: jesli uzytkownik ma wlasny statusLine (np. ccstatusline), forwardujemy tam stdin
  // i przekazujemy jego stdout jako nasz output.
  let chainCommand = null;
  try {
    if (fs.existsSync(chainPath)) {
      const chain = JSON.parse(fs.readFileSync(chainPath, "utf8"));
      if (chain && typeof chain.statusLineCommand === "string" && chain.statusLineCommand.trim()) {
        chainCommand = chain.statusLineCommand.trim();
      }
    }
  } catch {
    // brak/malformed chain.json — fallback do domyslnego outputu
  }

  if (chainCommand) {
    try {
      const res = spawnSync(chainCommand, {
        shell: true,
        input: stdin,
        encoding: "utf8",
        timeout: 10_000,
        windowsHide: true,
      });
      if (res.stdout) process.stdout.write(res.stdout);
      if (res.stderr) process.stderr.write(res.stderr);
      return;
    } catch (err) {
      process.stderr.write(`cc-panel chain statusLine error: ${err && err.message}\n`);
      // fallthrough do domyslnego outputu
    }
  }

  const costStr = typeof costUsd === "number" ? ` $${costUsd.toFixed(2)}` : "";
  const ctxStr = typeof ctxPct === "number" ? ` ctx:${ctxPct}%` : "";
  process.stdout.write(`T${terminalId} ${model}${costStr}${ctxStr}`);
});

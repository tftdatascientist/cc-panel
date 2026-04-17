#!/usr/bin/env node
/* cc-panel UserPromptSubmit hook: ustawia phase=working w state.{id}.json. */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const terminalId = String(process.env.CC_PANEL_TERMINAL_ID || "0");
const stateDir = path.join(os.homedir(), ".claude", "cc-panel");
const statePath = path.join(stateDir, `state.${terminalId}.json`);

// Konsumujemy stdin żeby CC nie blokował, payload nie jest potrzebny.
process.stdin.resume();
process.stdin.on("data", () => {});
process.stdin.on("end", () => update("working"));
process.stdin.on("error", () => update("working"));

function update(phase) {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    state = {};
  }
  state.phase = phase;
  state.phase_changed_at = new Date().toISOString();
  state.terminal_id = Number(terminalId) || 0;
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (err) {
    process.stderr.write(`cc-panel userpromptsubmit: ${err && err.message}\n`);
  }
}

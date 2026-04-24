#!/usr/bin/env node
/* cc-panel UserPromptSubmit hook: ustawia phase=working w state.{id}.json. */
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const terminalId = String(process.env.CC_PANEL_TERMINAL_ID || "");
if (!/^[1-4]$/.test(terminalId)) {
  // sesja nie jest spawnowana przez cc-panel — cichy no-op
  process.exit(0);
}
const stateDir = path.join(os.homedir(), ".claude", "cc-panel");
const statePath = path.join(stateDir, `state.${terminalId}.json`);

function playSound(event) {
  const soundPath = path.join(os.homedir(), ".claude", "cc-panel", "sounds", `${terminalId}${event}.wav`);
  try {
    if (fs.existsSync(soundPath)) {
      require("child_process").spawn(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-c",
          `[System.Media.SoundPlayer]::new('${soundPath.replace(/'/g, "''")}').Play()`],
        { detached: true, stdio: "ignore" }
      ).unref();
    }
  } catch { /* dźwięk opcjonalny — błąd cichy */ }
}

// Parsujemy stdin zeby wyciagnac transcript_path (do live tailowania messages feed).
let stdin = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { stdin += c; });
process.stdin.on("end", () => update("working"));
process.stdin.on("error", () => update("working"));

function update(phase) {
  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    state = {};
  }
  try {
    const payload = stdin ? JSON.parse(stdin) : {};
    if (payload && typeof payload.transcript_path === "string") {
      state.transcript_path = payload.transcript_path;
    }
  } catch {
    // ignore — brak lub malformed payload
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
  playSound("user");
}

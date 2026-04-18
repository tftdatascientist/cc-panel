#!/usr/bin/env node
/* cc-panel Stop hook: ustawia phase=waiting + last_message w state.{id}.json. */
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
const MAX_MESSAGE_CHARS = 500;
const TAIL_BYTES = 65536;

let stdinBuf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  stdinBuf += chunk;
});
process.stdin.on("end", () => update());
process.stdin.on("error", () => update());

function update() {
  let lastMessage;
  let transcriptPath;
  try {
    const payload = stdinBuf ? JSON.parse(stdinBuf) : {};
    if (payload && typeof payload.transcript_path === "string") {
      transcriptPath = payload.transcript_path;
      lastMessage = extractLastAssistantText(transcriptPath);
    }
  } catch {
    // stdin nie był JSON-em — ignoruj, aktualizuj samą fazę
  }

  let state = {};
  try {
    state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  } catch {
    state = {};
  }
  const now = new Date().toISOString();
  state.phase = "waiting";
  state.phase_changed_at = now;
  state.terminal_id = Number(terminalId) || 0;
  if (transcriptPath) state.transcript_path = transcriptPath;
  if (lastMessage) {
    state.last_message = lastMessage;
    state.last_message_at = now;
  }
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  } catch (err) {
    process.stderr.write(`cc-panel stop: ${err && err.message}\n`);
  }
}

function extractLastAssistantText(transcriptPath) {
  let fd;
  try {
    const stat = fs.statSync(transcriptPath);
    if (!stat.size) return undefined;
    const tailSize = Math.min(TAIL_BYTES, stat.size);
    fd = fs.openSync(transcriptPath, "r");
    const buf = Buffer.alloc(tailSize);
    fs.readSync(fd, buf, 0, tailSize, stat.size - tailSize);
    const text = buf.toString("utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      const msg = parseAssistantText(lines[i]);
      if (msg) return msg.slice(0, MAX_MESSAGE_CHARS);
    }
  } catch {
    // plik niedostępny / uszkodzony
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore
      }
    }
  }
  return undefined;
}

function parseAssistantText(line) {
  let obj;
  try {
    obj = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!obj || obj.type !== "assistant" || !obj.message) return undefined;
  const content = obj.message.content;
  if (!Array.isArray(content)) return undefined;
  const texts = [];
  for (const block of content) {
    if (block && block.type === "text" && typeof block.text === "string") {
      const trimmed = block.text.trim();
      if (trimmed.length > 0) texts.push(trimmed);
    }
  }
  return texts.length ? texts.join("\n") : undefined;
}

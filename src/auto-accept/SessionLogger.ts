import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { randomUUID } from "crypto";
import type { TerminalId } from "../panel/messages";
import type { AutoAcceptConfig, AutoAcceptStopReason, HaikuResponse } from "./types";

const LOG_DIR = path.join(os.homedir(), ".claude", "cc-panel");
const LOG_FILE = path.join(LOG_DIR, "aa-sessions.jsonl");

export interface SessionStartEvent {
  t: string;
  type: "session-start";
  sessionId: string;
  terminalId: TerminalId;
  config: AutoAcceptConfig;
}

export interface TriggerEvent {
  t: string;
  type: "trigger";
  sessionId: string;
  terminalId: TerminalId;
  iter: number;
  reason: "waiting-edge" | "skipped-busy";
  reactionMs: number;
}

export interface HaikuResponseEvent {
  t: string;
  type: "haiku-response";
  sessionId: string;
  iter: number;
  output: string;
  costUsd: number;
  durationMs: number;
}

export interface HaikuErrorEvent {
  t: string;
  type: "haiku-error";
  sessionId: string;
  iter: number;
  error: string;
  exitCode?: number;
}

export interface SendToTerminalEvent {
  t: string;
  type: "send-to-terminal";
  sessionId: string;
  terminalId: TerminalId;
  iter: number;
  text: string;
}

export interface WriteFailureEvent {
  t: string;
  type: "write-failure";
  sessionId: string;
  terminalId: TerminalId;
  iter: number;
}

export interface SessionStopEvent {
  t: string;
  type: "session-stop";
  sessionId: string;
  reason: AutoAcceptStopReason;
  totalIter: number;
  totalCostUsd: number;
}

export type AutoAcceptLogEvent =
  | SessionStartEvent
  | TriggerEvent
  | HaikuResponseEvent
  | HaikuErrorEvent
  | SendToTerminalEvent
  | WriteFailureEvent
  | SessionStopEvent;

function ensureLogDir(): void {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function newSessionId(): string {
  return randomUUID();
}

export class SessionLogger {
  constructor(public readonly sessionId: string) {
    ensureLogDir();
  }

  logStart(terminalId: TerminalId, config: AutoAcceptConfig): void {
    this.append({
      t: new Date().toISOString(),
      type: "session-start",
      sessionId: this.sessionId,
      terminalId,
      config,
    });
  }

  logTrigger(terminalId: TerminalId, iter: number, reason: TriggerEvent["reason"], reactionMs: number): void {
    this.append({
      t: new Date().toISOString(),
      type: "trigger",
      sessionId: this.sessionId,
      terminalId,
      iter,
      reason,
      reactionMs,
    });
  }

  logHaikuResponse(iter: number, response: HaikuResponse): void {
    this.append({
      t: new Date().toISOString(),
      type: "haiku-response",
      sessionId: this.sessionId,
      iter,
      output: response.result,
      costUsd: response.totalCostUsd,
      durationMs: response.durationMs,
    });
  }

  logHaikuError(iter: number, error: string, exitCode?: number): void {
    this.append({
      t: new Date().toISOString(),
      type: "haiku-error",
      sessionId: this.sessionId,
      iter,
      error,
      exitCode,
    });
  }

  logSendToTerminal(terminalId: TerminalId, iter: number, text: string): void {
    this.append({
      t: new Date().toISOString(),
      type: "send-to-terminal",
      sessionId: this.sessionId,
      terminalId,
      iter,
      text,
    });
  }

  logWriteFailure(terminalId: TerminalId, iter: number): void {
    this.append({
      t: new Date().toISOString(),
      type: "write-failure",
      sessionId: this.sessionId,
      terminalId,
      iter,
    });
  }

  logStop(reason: AutoAcceptStopReason, totalIter: number, totalCostUsd: number): void {
    this.append({
      t: new Date().toISOString(),
      type: "session-stop",
      sessionId: this.sessionId,
      reason,
      totalIter,
      totalCostUsd,
    });
  }

  private append(event: AutoAcceptLogEvent): void {
    try {
      fs.appendFileSync(LOG_FILE, JSON.stringify(event) + "\n", { encoding: "utf8" });
    } catch (err) {
      console.error(`[cc-panel] SessionLogger append failed:`, err);
    }
  }
}

export function readRecentSessions(limit = 20): SessionStartEvent[] {
  if (!fs.existsSync(LOG_FILE)) return [];
  const raw = fs.readFileSync(LOG_FILE, "utf8");
  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  const starts: SessionStartEvent[] = [];
  for (const line of lines) {
    try {
      const ev = JSON.parse(line) as AutoAcceptLogEvent;
      if (ev.type === "session-start") starts.push(ev);
    } catch {
      // skip malformed line
    }
  }
  return starts.slice(-limit).reverse();
}

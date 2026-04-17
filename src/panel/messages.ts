export type TerminalId = 1 | 2 | 3 | 4;
export type TerminalPhase = "idle" | "working" | "waiting" | "red";

export interface TerminalMetrics {
  model?: string;
  cost?: string;
  ctx?: string;
  ctxPct?: number;
  mode?: string;
}

export interface ButtonViewSpec {
  label: string;
  icon?: string;
  section?: string;
}

export interface MessageItem {
  terminalId: TerminalId;
  text: string;
  at: string;
}

export type PanelOutboundMessage =
  | { type: "init"; terminals: TerminalId[]; activeId: TerminalId }
  | { type: "setActive"; id: TerminalId }
  | { type: "setTerminals"; terminals: TerminalId[] }
  | {
      type: "setPhase";
      id: TerminalId;
      phase: TerminalPhase;
      sinceMs?: number;
    }
  | ({ type: "setMetrics"; id: TerminalId } & TerminalMetrics)
  | { type: "setButtons"; buttons: ButtonViewSpec[] }
  | { type: "setMessages"; messages: MessageItem[] }
  | { type: "addMessage"; message: MessageItem };

export type PanelInboundMessage =
  | { type: "ready" }
  | { type: "selectTerminal"; id: TerminalId }
  | { type: "addTerminal"; id: TerminalId }
  | { type: "invokeButton"; index: number };

export function isTerminalId(n: unknown): n is TerminalId {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

export type TerminalId = 1 | 2 | 3 | 4;

export interface DropItem {
  label: string;
  value: string;
}

export interface MessageDropItem {
  label: string;
  text: string;
}

export type KeystrokeName = "esc" | "ctrlC" | "shiftTab";

export type ModelChoice = "" | "opus" | "sonnet" | "haiku";

export type EffortLevel = "" | "low" | "mid" | "hard" | "max";
export type ThinkLevel  = "" | "think" | "think harder";

export interface SendInputOptions {
  text: string;
  model: ModelChoice;
  effort: EffortLevel;
  think: ThinkLevel;
  plan: boolean;
}

export type PanelOutboundMessage =
  | {
      type: "init";
      terminals: TerminalId[];
      activeId: TerminalId;
      slashCommands: DropItem[];
      userCommands: DropItem[];
      messages: MessageDropItem[];
    }
  | { type: "setActive"; id: TerminalId }
  | { type: "setTerminals"; terminals: TerminalId[] }
  | { type: "setSlashCommands"; slashCommands: DropItem[] }
  | {
      type: "setUserLists";
      userCommands: DropItem[];
      messages: MessageDropItem[];
    };

export type PanelInboundMessage =
  | { type: "ready" }
  | { type: "selectTerminal"; id: TerminalId }
  | { type: "addTerminal"; id: TerminalId }
  | { type: "sendSlash"; index: number; extra?: string }
  | { type: "sendUserCommand"; index: number; extra?: string }
  | { type: "sendMessage"; index: number }
  | { type: "sendInput"; options: SendInputOptions }
  | { type: "sendKeystroke"; name: KeystrokeName }
  | { type: "sendChar"; data: string };

export function isTerminalId(n: unknown): n is TerminalId {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

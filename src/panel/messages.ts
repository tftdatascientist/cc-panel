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

export interface DashboardSnapshotDTO {
  id: TerminalId;
  model: string | null;
  ctxPct: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  phase: string | null;
}

export type DashboardMapDTO = Partial<Record<TerminalId, DashboardSnapshotDTO>>;

export type PanelOutboundMessage =
  | {
      type: "init";
      terminals: TerminalId[];
      activeId: TerminalId;
      slashCommands: DropItem[];
      slashDropdown: DropItem[];
      userCommands: DropItem[];
      messages: MessageDropItem[];
      dashboard: DashboardMapDTO;
    }
  | { type: "setActive"; id: TerminalId }
  | { type: "setTerminals"; terminals: TerminalId[] }
  | { type: "setSlashCommands"; slashCommands: DropItem[] }
  | {
      type: "setUserLists";
      slashDropdown: DropItem[];
      userCommands: DropItem[];
      messages: MessageDropItem[];
    }
  | { type: "setDashboard"; dashboard: DashboardMapDTO };

export type PanelInboundMessage =
  | { type: "ready" }
  | { type: "selectTerminal"; id: TerminalId }
  | { type: "addTerminal"; id: TerminalId }
  | { type: "sendKeystroke"; name: KeystrokeName }
  | { type: "sendRaw"; text: string };

export function isTerminalId(n: unknown): n is TerminalId {
  return n === 1 || n === 2 || n === 3 || n === 4;
}

import * as vscode from "vscode";
import * as fs from "fs";
import * as crypto from "crypto";
import {
  DashboardMapDTO,
  DropItem,
  KeystrokeName,
  MessageDropItem,
  PanelInboundMessage,
  PanelOutboundMessage,
  TerminalId,
  isTerminalId,
} from "./messages";

export interface PanelCallbacks {
  onReady?: () => void;
  onSelectTerminal?: (id: TerminalId) => void;
  onAddTerminal?: (id: TerminalId) => void;
  onSendKeystroke?: (name: KeystrokeName) => void;
  onSendRaw?: (text: string) => void;
}

export const VIEW_ID = "ccPanelView";
const VIEW_TYPE = "ccPanel";
const PANEL_TITLE = "CC Panel";

/**
 * PanelManager — tworzy pływający WebviewPanel w obszarze edytora.
 * User przeciąga zakładkę do dolnej grupy edytora, żeby mieć panel tuż nad terminalem.
 */
export class PanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];
  private activeId: TerminalId = 1;
  private terminals: TerminalId[] = [1];
  private slashCommands: DropItem[] = [];
  private slashDropdown: DropItem[] = [];
  private userCommands: DropItem[] = [];
  private messages: MessageDropItem[] = [];
  private dashboard: DashboardMapDTO = {};
  private projectPaths: [string, string, string, string] = ["", "", "", ""];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: PanelCallbacks = {}
  ) {}

  // === API używane przez extension.ts ====================================

  setSlashCommands(items: DropItem[]): void {
    this.slashCommands = items;
    this.post({ type: "setSlashCommands", slashCommands: items });
  }

  setUserLists(slashDropdown: DropItem[], userCommands: DropItem[], messages: MessageDropItem[]): void {
    this.slashDropdown = slashDropdown;
    this.userCommands = userCommands;
    this.messages = messages;
    this.post({ type: "setUserLists", slashDropdown, userCommands, messages });
  }

  setTerminals(ids: TerminalId[]): void {
    this.terminals = [...ids].sort((a, b) => a - b);
    this.post({ type: "setTerminals", terminals: this.terminals });
  }

  setActive(id: TerminalId): void {
    this.activeId = id;
    this.post({ type: "setActive", id });
  }

  setDashboard(dashboard: DashboardMapDTO): void {
    this.dashboard = dashboard;
    this.post({ type: "setDashboard", dashboard });
  }

  setProjectPaths(projectPaths: [string, string, string, string]): void {
    this.projectPaths = projectPaths;
    this.post({ type: "setProjectPaths", projectPaths });
  }

  /**
   * Tworzy nowy WebviewPanel lub reveale'uje istniejący.
   * ViewColumn.Beside + preserveFocus=true — panel ląduje obok aktywnego edytora,
   * user przeciąga zakładkę do dolnej grupy edytora (pod terminal) przy pierwszym użyciu.
   */
  async openOrReveal(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(undefined, true);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      VIEW_TYPE,
      PANEL_TITLE,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "resources"),
        ],
      }
    );

    this.panel.webview.html = this.renderHtml(this.panel.webview);

    const msgSub = this.panel.webview.onDidReceiveMessage((raw: unknown) => {
      const msg = raw as Partial<PanelInboundMessage> | undefined;
      if (!msg || typeof msg.type !== "string") return;

      if (msg.type === "ready") {
        this.broadcastInit();
        this.callbacks.onReady?.();
        return;
      }
      if (msg.type === "selectTerminal") {
        const id = (msg as { id?: unknown }).id;
        if (isTerminalId(id)) this.callbacks.onSelectTerminal?.(id);
        return;
      }
      if (msg.type === "addTerminal") {
        const id = (msg as { id?: unknown }).id;
        if (isTerminalId(id)) this.callbacks.onAddTerminal?.(id);
        return;
      }
      if (msg.type === "sendKeystroke") {
        const name = (msg as { name?: unknown }).name;
        if (name === "esc" || name === "ctrlC" || name === "shiftTab") {
          this.callbacks.onSendKeystroke?.(name);
        }
        return;
      }
      if (msg.type === "sendRaw") {
        const text = (msg as { text?: unknown }).text;
        if (typeof text === "string" && text.length > 0) {
          this.callbacks.onSendRaw?.(text);
        }
        return;
      }
    });

    const disposeSub = this.panel.onDidDispose(() => {
      this.panel = undefined;
      msgSub.dispose();
    });

    this.subscriptions.push(msgSub, disposeSub);
  }

  reveal(): void {
    this.panel?.reveal(undefined, true);
  }

  dispose(): void {
    for (const s of this.subscriptions.splice(0)) s.dispose();
    this.panel?.dispose();
    this.panel = undefined;
  }

  // === Internals =========================================================

  private broadcastInit(): void {
    this.post({
      type: "init",
      terminals: this.terminals,
      activeId: this.activeId,
      slashCommands: this.slashCommands,
      slashDropdown: this.slashDropdown,
      userCommands: this.userCommands,
      messages: this.messages,
      dashboard: this.dashboard,
      projectPaths: this.projectPaths,
    });
  }

  private post(msg: PanelOutboundMessage): void {
    this.panel?.webview.postMessage(msg);
  }

  private renderHtml(webview: vscode.Webview): string {
    const resRoot = vscode.Uri.joinPath(this.extensionUri, "resources", "webview");
    const htmlPath = vscode.Uri.joinPath(resRoot, "index.html").fsPath;
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(resRoot, "styles.css"));
    const mainUri = webview.asWebviewUri(vscode.Uri.joinPath(resRoot, "main.js"));
    const nonce = crypto.randomBytes(16).toString("base64");

    let template = fs.readFileSync(htmlPath, "utf8");
    template = template
      .replace(/{{CSP_SOURCE}}/g, webview.cspSource)
      .replace(/{{NONCE}}/g, nonce)
      .replace(/{{STYLES_URI}}/g, stylesUri.toString())
      .replace(/{{MAIN_URI}}/g, mainUri.toString());
    return template;
  }
}

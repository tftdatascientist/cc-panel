import * as vscode from "vscode";
import * as fs from "fs";
import * as crypto from "crypto";
import {
  ButtonViewSpec,
  MessageItem,
  PanelInboundMessage,
  PanelOutboundMessage,
  TerminalId,
  TerminalMetrics,
  TerminalPhase,
  isTerminalId,
} from "./messages";

export interface PanelCallbacks {
  onReady?: () => void;
  onSelectTerminal?: (id: TerminalId) => void;
  onAddTerminal?: (id: TerminalId) => void;
  onInvokeButton?: (index: number) => void;
}

const MESSAGE_BUFFER_LIMIT = 100;

export class PanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];
  private activeId: TerminalId = 1;
  private terminals: TerminalId[] = [1];
  private buttons: ButtonViewSpec[] = [];
  private messages: MessageItem[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: PanelCallbacks = {}
  ) {}

  openOrReveal(): vscode.WebviewPanel {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return this.panel;
    }

    const panel = vscode.window.createWebviewPanel(
      "ccPanel",
      "CC Panel",
      vscode.ViewColumn.One,
      {
        retainContextWhenHidden: true,
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "resources"),
        ],
      }
    );

    panel.webview.html = this.renderHtml(panel.webview);

    const msgSub = panel.webview.onDidReceiveMessage((raw: unknown) => {
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
      if (msg.type === "invokeButton") {
        const index = (msg as { index?: unknown }).index;
        if (typeof index === "number") this.callbacks.onInvokeButton?.(index);
        return;
      }
    });

    const disposeSub = panel.onDidDispose(() => {
      this.panel = undefined;
      for (const s of this.subscriptions.splice(0)) s.dispose();
    });

    this.subscriptions.push(msgSub, disposeSub);
    this.panel = panel;
    return panel;
  }

  setTerminals(ids: TerminalId[]): void {
    this.terminals = [...ids].sort((a, b) => a - b);
    this.post({ type: "setTerminals", terminals: this.terminals });
  }

  setActive(id: TerminalId): void {
    this.activeId = id;
    this.post({ type: "setActive", id });
  }

  setMetrics(id: TerminalId, metrics: TerminalMetrics): void {
    this.post({ type: "setMetrics", id, ...metrics });
  }

  setPhase(id: TerminalId, phase: TerminalPhase, sinceMs?: number): void {
    this.post({ type: "setPhase", id, phase, sinceMs });
  }

  setButtons(buttons: ButtonViewSpec[]): void {
    this.buttons = buttons;
    this.post({ type: "setButtons", buttons });
  }

  addMessage(message: MessageItem): void {
    this.messages.push(message);
    if (this.messages.length > MESSAGE_BUFFER_LIMIT) {
      this.messages.splice(0, this.messages.length - MESSAGE_BUFFER_LIMIT);
    }
    this.post({ type: "addMessage", message });
  }

  reveal(): void {
    this.panel?.reveal(vscode.ViewColumn.One, true);
  }

  dispose(): void {
    for (const s of this.subscriptions.splice(0)) s.dispose();
    this.panel?.dispose();
    this.panel = undefined;
  }

  private broadcastInit(): void {
    this.post({
      type: "init",
      terminals: this.terminals,
      activeId: this.activeId,
    });
    this.post({ type: "setButtons", buttons: this.buttons });
    if (this.messages.length > 0) {
      this.post({ type: "setMessages", messages: this.messages });
    }
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

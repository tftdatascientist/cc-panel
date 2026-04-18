import * as vscode from "vscode";
import * as fs from "fs";
import * as crypto from "crypto";
import {
  DropItem,
  KeystrokeName,
  MessageDropItem,
  PanelInboundMessage,
  PanelOutboundMessage,
  SendInputOptions,
  TerminalId,
  isTerminalId,
} from "./messages";

export interface PanelCallbacks {
  onReady?: () => void;
  onSelectTerminal?: (id: TerminalId) => void;
  onAddTerminal?: (id: TerminalId) => void;
  onSendSlash?: (index: number, extra?: string) => void;
  onSendUserCommand?: (index: number, extra?: string) => void;
  onSendMessage?: (index: number) => void;
  onSendInput?: (options: SendInputOptions) => void;
  onSendKeystroke?: (name: KeystrokeName) => void;
  onSendChar?: (data: string) => void;
}

export class PanelManager implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readonly subscriptions: vscode.Disposable[] = [];
  private activeId: TerminalId = 1;
  private terminals: TerminalId[] = [1];
  private slashCommands: DropItem[] = [];
  private userCommands: DropItem[] = [];
  private messages: MessageDropItem[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: PanelCallbacks = {}
  ) {}

  setSlashCommands(items: DropItem[]): void {
    this.slashCommands = items;
    this.post({ type: "setSlashCommands", slashCommands: items });
  }

  setUserLists(userCommands: DropItem[], messages: MessageDropItem[]): void {
    this.userCommands = userCommands;
    this.messages = messages;
    this.post({ type: "setUserLists", userCommands, messages });
  }

  setTerminals(ids: TerminalId[]): void {
    this.terminals = [...ids].sort((a, b) => a - b);
    this.post({ type: "setTerminals", terminals: this.terminals });
  }

  setActive(id: TerminalId): void {
    this.activeId = id;
    this.post({ type: "setActive", id });
  }

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
      if (msg.type === "sendSlash") {
        const m = msg as { index?: unknown; extra?: unknown };
        if (typeof m.index === "number") {
          this.callbacks.onSendSlash?.(m.index, typeof m.extra === "string" ? m.extra : undefined);
        }
        return;
      }
      if (msg.type === "sendUserCommand") {
        const m = msg as { index?: unknown; extra?: unknown };
        if (typeof m.index === "number") {
          this.callbacks.onSendUserCommand?.(m.index, typeof m.extra === "string" ? m.extra : undefined);
        }
        return;
      }
      if (msg.type === "sendMessage") {
        const index = (msg as { index?: unknown }).index;
        if (typeof index === "number") this.callbacks.onSendMessage?.(index);
        return;
      }
      if (msg.type === "sendInput") {
        const options = (msg as { options?: unknown }).options as SendInputOptions | undefined;
        if (options && typeof options.text === "string") {
          this.callbacks.onSendInput?.({
            text:   options.text,
            model:  options.model  || "",
            effort: options.effort || "",
            think:  options.think  || "",
            plan:   !!options.plan,
          });
        }
        return;
      }
      if (msg.type === "sendKeystroke") {
        const name = (msg as { name?: unknown }).name;
        if (name === "esc" || name === "ctrlC" || name === "shiftTab") {
          this.callbacks.onSendKeystroke?.(name);
        }
        return;
      }
      if (msg.type === "sendChar") {
        const data = (msg as { data?: unknown }).data;
        if (typeof data === "string" && data.length > 0) {
          this.callbacks.onSendChar?.(data);
        }
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
      slashCommands: this.slashCommands,
      userCommands: this.userCommands,
      messages: this.messages,
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

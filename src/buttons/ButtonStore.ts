import * as vscode from "vscode";
import * as fs from "fs";

export type ButtonActionType = "sendText" | "keystroke";

export interface ButtonSpec {
  label: string;
  type: ButtonActionType;
  value: string;
  icon?: string;
}

export class ButtonStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<ButtonSpec[]>();
  readonly onChange = this.emitter.event;
  private buttons: ButtonSpec[] = [];
  private readonly configSub: vscode.Disposable;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.buttons = this.load();
    this.configSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("ccPanel.buttons")) {
        this.buttons = this.load();
        this.emitter.fire(this.buttons);
      }
    });
  }

  current(): ButtonSpec[] {
    return this.buttons;
  }

  dispose(): void {
    this.configSub.dispose();
    this.emitter.dispose();
  }

  private load(): ButtonSpec[] {
    const raw = vscode.workspace.getConfiguration("ccPanel").get<unknown>("buttons");
    if (Array.isArray(raw) && raw.length > 0) {
      const parsed = this.validate(raw);
      if (parsed.length > 0) return parsed;
    }
    return this.loadDefaults();
  }

  private loadDefaults(): ButtonSpec[] {
    const defaultsPath = vscode.Uri.joinPath(
      this.extensionUri,
      "resources",
      "default-buttons.json"
    ).fsPath;
    try {
      const raw = JSON.parse(fs.readFileSync(defaultsPath, "utf8")) as unknown;
      if (Array.isArray(raw)) return this.validate(raw);
    } catch (err) {
      vscode.window.showWarningMessage(
        `CC Panel: nie udało się wczytać default-buttons.json — ${(err as Error).message}`
      );
    }
    return [];
  }

  private validate(raw: unknown[]): ButtonSpec[] {
    const out: ButtonSpec[] = [];
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      if (typeof obj.label !== "string" || typeof obj.value !== "string") continue;
      if (obj.type !== "sendText" && obj.type !== "keystroke") continue;
      const spec: ButtonSpec = {
        label: obj.label,
        type: obj.type,
        value: obj.value,
      };
      if (typeof obj.icon === "string") spec.icon = obj.icon;
      out.push(spec);
    }
    return out;
  }
}

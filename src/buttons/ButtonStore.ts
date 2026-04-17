import * as vscode from "vscode";
import * as fs from "fs";

export type ButtonActionType = "sendText" | "keystroke" | "vsCodeCommand";

export interface ButtonStep {
  type: ButtonActionType;
  value: string;
}

export interface ButtonSpec {
  label: string;
  type: ButtonActionType | "multiStep";
  value: string | ButtonStep[];
  icon?: string;
  section?: string;
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

  async save(
    buttons: ButtonSpec[],
    target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
  ): Promise<void> {
    const config = vscode.workspace.getConfiguration("ccPanel");
    const serialized = buttons.map((b) => {
      const out: ButtonSpec = { label: b.label, type: b.type, value: b.value };
      if (b.icon) out.icon = b.icon;
      if (b.section) out.section = b.section;
      return out;
    });
    await config.update("buttons", serialized, target);
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
      if (typeof obj.label !== "string") continue;
      const type = obj.type;
      if (
        type !== "sendText" &&
        type !== "keystroke" &&
        type !== "vsCodeCommand" &&
        type !== "multiStep"
      )
        continue;

      let value: string | ButtonStep[];
      if (type === "multiStep") {
        if (!Array.isArray(obj.value)) continue;
        const steps = validateSteps(obj.value);
        if (steps.length === 0) continue;
        value = steps;
      } else {
        if (typeof obj.value !== "string") continue;
        value = obj.value;
      }

      const spec: ButtonSpec = {
        label: obj.label,
        type,
        value,
      };
      if (typeof obj.icon === "string") spec.icon = obj.icon;
      if (typeof obj.section === "string" && obj.section.trim().length > 0) {
        spec.section = obj.section;
      }
      out.push(spec);
    }
    return out;
  }
}

function validateSteps(raw: unknown[]): ButtonStep[] {
  const steps: ButtonStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.value !== "string") continue;
    if (
      obj.type !== "sendText" &&
      obj.type !== "keystroke" &&
      obj.type !== "vsCodeCommand"
    )
      continue;
    steps.push({ type: obj.type, value: obj.value });
  }
  return steps;
}

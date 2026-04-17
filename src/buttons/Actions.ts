import * as vscode from "vscode";
import { TerminalManager } from "../terminals/TerminalManager";
import { ButtonActionType, ButtonSpec, ButtonStep } from "./ButtonStore";
import { resolvePlaceholders } from "./Placeholders";

export type ExecuteResult = "ok" | "noTerminal" | "cancelled";

export class Actions {
  constructor(private readonly terminals: TerminalManager) {}

  async execute(
    button: ButtonSpec,
    activeTerminalId: number
  ): Promise<ExecuteResult> {
    if (button.type === "multiStep") {
      if (!Array.isArray(button.value)) return "noTerminal";
      for (let i = 0; i < button.value.length; i++) {
        const step = button.value[i];
        const stepLabel = `${button.label} — krok ${i + 1}/${button.value.length}`;
        const result = await this.executeStep(step.type, step.value, stepLabel, activeTerminalId);
        if (result !== "ok") return result;
      }
      return "ok";
    }
    if (typeof button.value !== "string") return "noTerminal";
    return this.executeStep(button.type, button.value, button.label, activeTerminalId);
  }

  private async executeStep(
    type: ButtonActionType,
    value: string,
    placeholderLabel: string,
    activeTerminalId: number
  ): Promise<ExecuteResult> {
    switch (type) {
      case "sendText": {
        const resolved = await resolvePlaceholders(value, placeholderLabel);
        if (resolved === undefined) return "cancelled";
        return this.terminals.write(activeTerminalId, `${resolved}\r`)
          ? "ok"
          : "noTerminal";
      }
      case "keystroke":
        return this.terminals.write(activeTerminalId, value)
          ? "ok"
          : "noTerminal";
      case "vsCodeCommand":
        void vscode.commands.executeCommand(value);
        return "ok";
      default:
        return "noTerminal";
    }
  }
}

export type { ButtonStep };

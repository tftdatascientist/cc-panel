import { TerminalManager } from "../terminals/TerminalManager";
import { ButtonSpec } from "./ButtonStore";

export class Actions {
  constructor(private readonly terminals: TerminalManager) {}

  execute(button: ButtonSpec, activeTerminalId: number): boolean {
    switch (button.type) {
      case "sendText":
        return this.terminals.write(activeTerminalId, `${button.value}\r`);
      case "keystroke":
        return this.terminals.write(activeTerminalId, button.value);
      default:
        return false;
    }
  }
}

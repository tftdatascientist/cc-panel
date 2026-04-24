import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface StatusLineConfig {
  type: string;
  command: string;
}

interface HookCommand {
  type: string;
  command: string;
}

interface HookEntry {
  matcher?: string;
  hooks?: HookCommand[];
}

interface ClaudeSettings {
  statusLine?: StatusLineConfig;
  hooks?: Record<string, HookEntry[]>;
  [k: string]: unknown;
}

const HOOK_SCRIPTS = ["userpromptsubmit.js", "stop.js", "statusline.js"] as const;
const EVENTS = ["UserPromptSubmit", "Stop"] as const;
type HookEvent = (typeof EVENTS)[number];

/** Cicha auto-aktualizacja ścieżek hooków przy starcie — bez powiadomień. */
export function syncHookPaths(extensionUri: vscode.Uri): void {
  const hooksRoot = vscode.Uri.joinPath(extensionUri, "resources", "hooks").fsPath;
  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  if (!fs.existsSync(settingsPath)) return;
  let settings: ClaudeSettings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as ClaudeSettings;
  } catch { return; }

  let changed = false;
  const hooks = settings.hooks ?? {};
  for (const entries of Object.values(hooks)) {
    for (const entry of entries) {
      for (const h of entry.hooks ?? []) {
        for (const script of HOOK_SCRIPTS) {
          if ((h.command ?? "").includes(script)) {
            const newCmd = cmdFor(path.join(hooksRoot, script));
            if (h.command !== newCmd) { h.command = newCmd; changed = true; }
          }
        }
      }
    }
  }
  if (settings.statusLine?.command?.includes("statusline.js")) {
    const newCmd = cmdFor(path.join(hooksRoot, "statusline.js"));
    if (settings.statusLine.command !== newCmd) { settings.statusLine.command = newCmd; changed = true; }
  }
  if (changed) {
    try { fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n"); } catch { /* ignore */ }
  }
}

export async function installHooks(extensionUri: vscode.Uri): Promise<void> {
  const hooksRoot = vscode.Uri.joinPath(extensionUri, "resources", "hooks").fsPath;

  const statuslinePath = path.join(hooksRoot, "statusline.js");
  const upsPath = path.join(hooksRoot, "userpromptsubmit.js");
  const stopPath = path.join(hooksRoot, "stop.js");

  for (const p of [statuslinePath, upsPath, stopPath]) {
    if (!fs.existsSync(p)) {
      vscode.window.showErrorMessage(
        `CC Panel: brak hook script ${p} — przebuduj rozszerzenie.`
      );
      return;
    }
  }

  const settingsPath = path.join(os.homedir(), ".claude", "settings.json");
  let settings: ClaudeSettings = {};
  let existedBefore = false;
  if (fs.existsSync(settingsPath)) {
    existedBefore = true;
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as ClaudeSettings;
    } catch (err) {
      vscode.window.showErrorMessage(
        `CC Panel: ~/.claude/settings.json nie jest poprawnym JSON (${(err as Error).message}). Popraw ręcznie.`
      );
      return;
    }
  }

  const statusCmd = cmdFor(statuslinePath);
  const upsCmd = cmdFor(upsPath);
  const stopCmd = cmdFor(stopPath);

  const existing = settings.statusLine;
  const statusChanged = existing?.command !== statusCmd;
  let statusLineInstalled = false;
  let statusLineKept = false;
  let statusLineChained = false;
  const chainPath = path.join(os.homedir(), ".claude", "cc-panel", "chain.json");
  if (existing && statusChanged) {
    const choice = await vscode.window.showWarningMessage(
      `W ~/.claude/settings.json istnieje statusLine:\n\n${existing.command}\n\nCo zrobić z Twoim statusLine?\n• Zachowaj mój — zostawi Twój nietknięty (metryki model/ctx/cost w cc-panel pozostaną puste).\n• Chain — zachowa Twój widok w terminalu + zaloguje metryki do kafelków cc-panel.\n• Podmień — zastąpi Twój statusLine własnym cc-panel.`,
      { modal: true },
      "Zachowaj mój",
      "Chain (zachowaj + loguj metryki)",
      "Podmień (backup)"
    );
    if (choice === "Zachowaj mój") {
      statusLineKept = true;
    } else if (choice === "Chain (zachowaj + loguj metryki)") {
      const backupPath = `${settingsPath}.bak-cc-panel-${Date.now()}`;
      fs.copyFileSync(settingsPath, backupPath);
      try {
        fs.mkdirSync(path.dirname(chainPath), { recursive: true });
        fs.writeFileSync(
          chainPath,
          JSON.stringify({ statusLineCommand: existing.command }, null, 2) + "\n"
        );
      } catch (err) {
        vscode.window.showErrorMessage(
          `CC Panel: nie udało się zapisać ${chainPath} — ${(err as Error).message}`
        );
        return;
      }
      settings.statusLine = { type: "command", command: statusCmd };
      statusLineChained = true;
      vscode.window.showInformationMessage(
        `CC Panel: chain aktywny — oryginalny statusLine zapamiętany w ${chainPath}. Backup settings.json → ${backupPath}`
      );
    } else if (choice === "Podmień (backup)") {
      const backupPath = `${settingsPath}.bak-cc-panel-${Date.now()}`;
      fs.copyFileSync(settingsPath, backupPath);
      vscode.window.showInformationMessage(`CC Panel: backup → ${backupPath}`);
      settings.statusLine = { type: "command", command: statusCmd };
      statusLineInstalled = true;
      // Czyscimy chain.json jesli istnial — zeby nie forwardowac do starego commanda.
      try {
        if (fs.existsSync(chainPath)) fs.unlinkSync(chainPath);
      } catch {
        // ignore
      }
    } else {
      return;
    }
  } else if (statusChanged) {
    settings.statusLine = { type: "command", command: statusCmd };
    statusLineInstalled = true;
  }

  settings.hooks = settings.hooks ?? {};
  upsertHook(settings.hooks, "UserPromptSubmit", upsCmd, upsPath);
  upsertHook(settings.hooks, "Stop", stopCmd, stopPath);

  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
  } catch (err) {
    vscode.window.showErrorMessage(
      `CC Panel: zapis ${settingsPath} nieudany — ${(err as Error).message}`
    );
    return;
  }

  const statusNote = statusLineChained
    ? " (statusLine: chain — Twój + logowanie metryk)"
    : statusLineKept
    ? " (statusLine: zachowany Twój — metryki model/ctx/cost w kafelkach pozostaną puste)"
    : statusLineInstalled
    ? " (statusLine: CC Panel)"
    : "";
  vscode.window.showInformationMessage(
    (existedBefore
      ? "CC Panel: hooki UserPromptSubmit, Stop zainstalowane w ~/.claude/settings.json. Zrestartuj CC."
      : "CC Panel: utworzono ~/.claude/settings.json z hookami. Zrestartuj CC.") +
      statusNote
  );
}

function cmdFor(scriptPath: string): string {
  return `node "${scriptPath}"`;
}

function upsertHook(
  hooks: Record<string, HookEntry[]>,
  event: HookEvent,
  command: string,
  scriptPath: string
): void {
  const scriptName = path.basename(scriptPath);
  const list = hooks[event] ?? [];
  const cleaned: HookEntry[] = [];
  for (const entry of list) {
    const innerHooks = (entry.hooks ?? []).filter(
      (h) => !(h.command ?? "").includes(scriptName)
    );
    if (innerHooks.length > 0) {
      cleaned.push({ matcher: entry.matcher ?? "", hooks: innerHooks });
    } else if (entry.hooks && entry.hooks.length === 0 && !entry.matcher) {
      // pusty wpis — pomijamy
    } else if (!entry.hooks) {
      cleaned.push(entry);
    }
  }
  cleaned.push({
    matcher: "",
    hooks: [{ type: "command", command }],
  });
  hooks[event] = cleaned;
}

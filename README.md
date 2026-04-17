# cc-panel

Rozszerzenie VS Code do równoległej obsługi **1-4 sesji Claude Code** z graficznego panelu sterowania w obszarze edytora.

![status](https://img.shields.io/badge/status-MVP%20code%20complete-brightgreen) ![platform](https://img.shields.io/badge/platform-VS%20Code%20%E2%89%A5%201.85-blue) ![language](https://img.shields.io/badge/lang-TypeScript-3178c6)

## Co robi

- Spawnuje do 4 instancji `cc` (Claude Code CLI) w tej samej grupie edytora przez `node-pty`.
- Renderuje nad terminalami webview panel z layoutem 20/60/20:
  - **Góra** — 4 status tiles (faza `idle` / `working` / `waiting` + timer od ostatniej zmiany fazy; czerwony border gdy ctx≥70%).
  - **Środek** — grid przycisków akcji (`sendText` / `keystroke` / `vsCodeCommand`) | feed wiadomości ze wszystkich terminali.
  - **Dół** — 4 paski info z modelem / Ctx% / kosztem / trybem per terminal.
- Ramka panelu w kolorze aktywnego terminala (T1 teal, T2 amber, T3 purple, T4 coral); cyklowanie przez `Ctrl+Alt+Tab`.
- Każda instancja CC dostaje env `CC_PANEL_TERMINAL_ID=1..4` — identyfikacja w hookach.
- Hooki CC (`statusLine`, `UserPromptSubmit`, `Stop`) zapisują stan per terminal do `~/.claude/cc-panel/state.{id}.json`; ekstensja czyta przez `chokidar`.

## Architektura

Szczegóły w [`ARCHITECTURE.md`](./ARCHITECTURE.md). Skrótowo:

```
VS Code Extension Host
├── extension.ts         — activate/deactivate, komendy, routing zdarzeń
├── TerminalManager      — node-pty spawn, map id→pty, onTerminalsChanged
├── PanelManager         — WebviewPanel, post/receive, buffer messages (rolling 100)
├── StateWatcher         — chokidar on ~/.claude/cc-panel/state.*.json
├── ButtonStore          — config ccPanel.buttons ∨ resources/default-buttons.json; save(target)
├── EditButton           — wizard QuickPick/InputBox + pickTarget (Global|Workspace)
├── Actions              — sendText / keystroke / vsCodeCommand → pty.write | commands.executeCommand
└── installHooks         — upsert w ~/.claude/settings.json

resources/
├── hooks/               — statusline.js (liczy ctx_pct), userpromptsubmit.js, stop.js
├── webview/             — index.html, styles.css, main.js (vanilla)
└── default-buttons.json — 11 buttonów (8 slash + Esc/Ctrl+C/Shift+Tab)
```

**Źródło prawdy metryk** — `statusLine` hook CC. Parsowanie ANSI z terminala zabronione.

## Wymagania

- VS Code `≥ 1.85`
- Node.js (do zbudowania + do uruchamiania hooków)
- Claude Code CLI (`cc`) dostępny w PATH
- Windows / macOS / Linux (testowane na Windows 11 + Git Bash)

## Uruchomienie (development)

```bash
npm install
npm run build        # esbuild → out/extension.js
# F5 w VS Code → drugi ExtensionHost z ładowanym rozszerzeniem
```

Po uruchomieniu:

1. `Ctrl+Shift+P → CC Panel: Install Hooks` — wpisuje `statusLine` / `UserPromptSubmit` / `Stop` do `~/.claude/settings.json` (backup `settings.json.bak-cc-panel-{ts}` jeśli był istniejący `statusLine`).
2. `Ctrl+Shift+P → CC Panel: Open` — otwiera webview i spawnuje T1 w grupie pod panelem.
3. Klik na disabled tile T2/T3/T4 **lub** `Ctrl+Shift+P → CC Panel: Add Terminal` — dodaje kolejny terminal.

## Komendy

| Komenda | Opis | Keybinding |
|---------|------|-----------|
| `ccPanel.open` | Otwiera/pokazuje panel i spawnuje T1 | — |
| `ccPanel.addTerminal` | Spawnuje pierwszy wolny terminal (2→3→4) | — |
| `ccPanel.cycleActive` | Cykluje aktywny terminal T1→T2→T3→T4→T1 | `Ctrl+Alt+Tab` |
| `ccPanel.editButton` | Wizard edycji `ccPanel.buttons` (add / edit / delete) | — |
| `ccPanel.installHooks` | Wpisuje hooki CC do `~/.claude/settings.json` | — |

## Konfiguracja przycisków

Najwygodniej przez `Ctrl+Shift+P → CC Panel: Edit Buttons` — wizard prowadzi przez label/typ/wartość/ikonę i pyta gdzie zapisać (Global ∨ Workspace).

Można też edytować `settings.json` ręcznie:

```json
{
  "ccPanel.buttons": [
    { "label": "Clear",   "type": "sendText",      "value": "/clear" },
    { "label": "Esc",     "type": "keystroke",     "value": "\u001b" },
    { "label": "Save",    "type": "vsCodeCommand", "value": "workbench.action.files.save" }
  ]
}
```

Typy akcji:
- `sendText` — `pty.write(value + '\r')` do aktywnego terminala (slash-commands CC, dowolny tekst)
- `keystroke` — `pty.write(value)` bez CR; wspiera escape `\u001b`, `\x1b`, `\n`, `\r`, `\t` w wizardzie (dla Esc, Ctrl+C, Shift+Tab itd.)
- `vsCodeCommand` — `vscode.commands.executeCommand(value)`; binduje dowolną komendę VS Code (np. zapis pliku, format, toggle panelu)

Pusta lista → fallback do [`resources/default-buttons.json`](./resources/default-buttons.json) (11 buttonów: 8 slash-commands + Esc / Ctrl+C / Shift+Tab).

Target zapisu:
- **Global** (User Settings) — synchronizuje się przez Settings Sync, dotyczy wszystkich projektów
- **Workspace** (`.vscode/settings.json`) — nadpisuje global tylko w tym projekcie

## Stan fazowy

Zobacz [`STATUS.md`](./STATUS.md) — aktualna faza rozwoju, co jest potwierdzone ręcznie, co czeka na weryfikację end-to-end.

| Faza | Zakres | Stan |
|------|--------|------|
| 0 | scaffold, F5 debug | ✅ verified |
| 1 | 1 terminal spawnowany przez node-pty | ✅ verified |
| 2 | layout webview + event bus | ✅ verified |
| 3 | statusLine hook + chokidar + infobar | 🟡 code done |
| 4 | UserPromptSubmit/Stop + tile timer | 🟡 code done |
| 5 | button grid + sendText | 🟡 code done |
| 6 | 1-4 terminali + messages feed | 🟡 code done |
| 7 | `ccPanel.cycleActive` + keybinding `Ctrl+Alt+Tab` | 🟡 code done |
| 8 | akcja `keystroke` (Esc, Ctrl+C, Shift+Tab) | 🟡 code done |
| 9 | edytor przycisków (wizard) + persistence | 🟡 code done |
| Post-MVP iter 1 | ctx≥70% red tile + `vsCodeCommand` + per-workspace target | 🟡 code done |
| Post-MVP iter 2 | `promptTemplate` z placeholderami | ⬜ |
| Post-MVP iter 3 | `multiStep` (sekwencje akcji) | ⬜ |
| Post-MVP iter 4 | grupowanie/sekcje przycisków | ⬜ |

## Pliki stanu

- `~/.claude/cc-panel/state.{1..4}.json` — per-terminal state z hooków (phase, last_message, model, cost)
- `~/.claude/settings.json` — hooki CC

## Licencja

Brak (private / pet-project). Kod udostępniony do inspekcji.

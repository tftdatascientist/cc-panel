# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# cc-panel

Rozszerzenie VS Code do równoległej obsługi 1-4 sesji Claude Code z pływającego `WebviewPanel` (zakładka edytora, drag poza VS Code dla osobnego okna).

@STATUS.md
@ARCHITECTURE.md

> Przed przyjęciem zadania przeczytaj `STATUS.md` (bieżąca sesja, Done/Next/Known bugs) i `ARCHITECTURE.md` (layout, data flow, komendy). Jeśli wykryjesz rozbieżności z tym plikiem lub z rzeczywistością w kodzie — zaktualizuj dokumentację na koniec sesji.

## Commands

```bash
npm install
npm run build           # esbuild → out/extension.js
npm run watch           # esbuild watch mode
npm run compile-types   # tsc --noEmit (type check, nie emituje plików)

# packaging
npx vsce package --no-dependencies    # → cc-panel-<version>.vsix

# lokalny test
# F5 w VS Code → drugi Extension Development Host
```

Brak test runnera w repo — nie ma `npm test`. Weryfikacja przez `compile-types` + F5 + ręczny scenariusz.

## Project
- name: cc-panel
- type: VS Code extension
- publisher: `LokalnaAutomatyzacjaBiznesu` (Marketplace), version w `package.json`
- repo: https://github.com/tftdatascientist/cc-panel (public, main)

## Stack
- TypeScript 5.x, target VS Code API ≥ 1.85
- node-pty — spawn CC z kontrolą PTY I/O
- chokidar — watch na `~/.claude/cc-panel/state.*.json` i transcript JSONL
- esbuild — bundler (nie tsc)
- vanilla HTML/CSS/JS w webview (bez frameworka)

## Key Files
- `package.json` — manifest: 12 komend, keybindings (Ctrl+Alt+\`, Ctrl+Alt+1-4, F1-F4 gdy fokus na panelu), 4 `contributes.colors` (ccPanel.terminal.t1-4), 2 configuration properties
- `src/extension.ts` — activate/deactivate, rejestracja 12 komend, `writeAndWarn()`, `projectPathFor(id)`, forward StateWatcher → PanelManager
- `src/panel/PanelManager.ts` — `vscode.window.createWebviewPanel(ViewColumn.Beside, preserveFocus)`; routing inbound messages; `broadcastInit`
- `src/panel/messages.ts` — TS types inbound/outbound (sendRaw, sendKeystroke, selectTerminal, addTerminal, setDashboard, setProjectPaths, setSlashCommands, setUserLists)
- `src/terminals/TerminalManager.ts` — node-pty spawn przez `Pseudoterminal`; lazy spawn z fallback 300ms; `cmd.exe /k` na Windows; env `CC_PANEL_TERMINAL_ID=1..4`; flag `--dangerously-skip-permissions` gdy `ccPanel.bypassPermissions=true`
- `src/settings/slashCommands.ts` — 34 statyczne slash commands; `/color` jako 5 wariantów (cyan/orange/purple/pink/random) mapowanych do kolorów T1-T4
- `src/settings/UserListsStore.ts` — R/W `~/.claude/cc-panel/ustawienia.json`: user commands + messages + `projectPaths[T1-T4]`; migracja legacy `projectPath` → slot T1
- `src/settings/editUserLists.ts` — QuickPick/InputBox wizard (edycja list + ustawienie folderu projektu per slot)
- `src/state/StateWatcher.ts` — chokidar na `state.*.json` + dynamiczny watcher na transcript JSONL; debounce 150ms; event emitter
- `src/state/TranscriptReader.ts` — tail read JSONL z cache incremental (tylko przyrost); parse cost/total tokenów z `type:"assistant"`; tabela PRICING per-model; reset przy shrink pliku (nowa sesja)
- `src/hooks/installHooks.ts` — upsert `~/.claude/settings.json`: `statusLine` + `UserPromptSubmit` + `Stop`
- `resources/hooks/` — `statusline.js` (chain-capable, liczy ctx_pct, merge z prev state), `userpromptsubmit.js` (phase=working + transcript_path), `stop.js` (phase=waiting + last_message z JSONL)
- `resources/webview/` — `index.html` (bar-top input+▶+Esc+^C+▼ / bar-terms chipy T1-T4 / dashboard section), `styles.css`, `main.js`

## Layout i źródło metryk

Webview ma **dwa wiersze + opcjonalny dashboard** (nie "20/60/20" z dokumentacji MVP):
```
[input (flex)][▶] │ [Esc][^C] │ [▼]           ← bar-top ~40px
[T1][T2][T3][T4]  (id │ folder │ Ctx%)        ← bar-terms ~34px
[section.dashboard — Cost/Total tabela + last-message]  ← toggleable (▼/▲)
```
- Chipy T1-T4: kolor teal/amber/purple/coral; aktywny podświetlony; disabled → klik = addTerminal; pulsujący dot gdy `phase=working`; badge gdy nieaktywny dostał wiadomość
- Ctx% widoczny bezpośrednio w chipie (kolor terminala, bold); tło chipa aktywnego = `--accent 18%`
- Dashboard toggle persistowany przez `vscode.getState()/setState()` webview
- Input + jeden `<datalist>` scala slash commands + user commands + messages (brak trybów)

## Specifics (nietykalne zasady)

- **CC ZAWSZE spawnowany przez ekstensję** — nigdy attach do istniejącego terminala (kontrola env i PTY I/O)
- **Statusline CC w terminalu jest święty** — `STATUS.md → Hard Constraints`: user ma własny ccstatusline (`Model | Ctx% | Session% | Session time | Cost | Weekly% | Total`). cc-panel **nigdy** nie podmienia tego paska. Opcja "Podmień" z `installHooks` jest wykluczona. Jeśli funkcja wymaga podmiany statusline → rezygnujemy z funkcji, nie ze statusline. Chain mode teoretycznie OK, ale w praktyce nie działa — przed proponowaniem wymagana diagnoza bugu
- **Źródło prawdy metryk (Ctx%, cost, model, last_message): statusLine + Stop hooki CC zapisujące `~/.claude/cc-panel/state.{id}.json`** + TranscriptReader z JSONL. **Parsowanie ANSI z terminala ZABRONIONE** (niestabilne, łamie chain)
- **Identyfikacja terminala:** `env.CC_PANEL_TERMINAL_ID=1..4` przekazywane przy spawnie i czytane przez wszystkie hooki. Przy nieustawionym env hook robi `process.exit(0)` (nie zapisuje state)
- **Tab koliduje z terminal completion** — przełączanie przez `ccPanel.cycleActive` (Ctrl+Alt+\`) oraz `ccPanel.selectTerminal1-4` (Ctrl+Alt+1-4, F1-F4 gdy fokus na panelu)
- **Pływający WebviewPanel (opcja B)**, nie WebviewView w kontenerze — `ViewColumn.Beside + preserveFocus`; user przeciąga zakładkę poza VS Code dla floating window (jedyny sposób na równoczesną widoczność Panel + Terminal CC)
- **cmd.exe /k** na Windows (nie /c) — cmd pozostaje po zakończeniu CC, user widzi błąd
- **Lazy spawn z fallback 300ms + `spawnDone` flag** — rozwiązuje "zjazd"/czarny ekran CC i zapobiega double-spawn przy parze `open()` + `setDimensions()`

## Repo conventions

- Brak testów jednostkowych — jedyna weryfikacja to `npm run compile-types` (tsc --noEmit) + F5 + ręczny scenariusz
- Polish w dokumentacji (CLAUDE.md/STATUS.md/ARCHITECTURE.md/komunikaty), English w kodzie/identyfikatorach
- VSIX-y w root repo (`cc-panel-*.vsix`) — nie commitować nowych wersji bez bumpu w `package.json`
- Numeracja sesji w `STATUS.md → Current` — inkrementować przy istotnej zmianie (Done + Next + Current state)

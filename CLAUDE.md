> **IZOLACJA:** Ten projekt (`cc-panel` — rozszerzenie VS Code) jest w pełni niezależny od `claude-env-manager/`. Jeśli CC załadował CLAUDE.md projektu nadrzędnego (CEM/Python/PySide6) — zignoruj tamten kontekst. Różny stack (TypeScript, node-pty, esbuild), własne repo, własny cykl wydań.

# cc-panel

Rozszerzenie VS Code do równoległej obsługi 1-4 sesji Claude Code z pływającego `WebviewPanel` (zakładka edytora, drag poza VS Code dla osobnego okna).

@STATUS.md
@ARCHITECTURE.md

## Workflow

1. Przeczytaj `STATUS.md` (bieżąca sesja, Done/Next/Known bugs) i `ARCHITECTURE.md` (layout, data flow, komendy)
2. Wykryte rozbieżności z dokumentacją lub kodem → zaktualizuj `STATUS.md`/`ARCHITECTURE.md` na koniec sesji
3. Numerację sesji w `STATUS.md → Current` inkrementuj przy istotnej zmianie (Done + Next + Current state)

## Auto-Accept Mode (zaimplementowany, sesje 17-22)

Pipeline: `TriggerDetector` (krawędź working→waiting) → `BudgetEnforcer` (time/iter/cost, każdy `null` = unlimited) → `HaikuHeadlessClient` (`claude -p --output-format json --model haiku`) → `CircuitBreaker` (similarity ≥0.80 + idle-length ±10%) → `writeToTerminal` → `SessionLogger` (JSONL append-only). Default budget: 15 min / $5.00 / 50 iter. **Realny koszt Haiku ~$0.07/iter** (cache_creation 58k tokens, zweryfikowane smoke testem 2026-04-20). Keybinding `Ctrl+Alt+A`. Scope: single-active globalnie (D2). Plan: `docs/AUTO_ACCEPT_PLAN.md`. **E2E (F5) jeszcze nieprzetestowane — nie bumpować VSIX 0.0.4 przed tym.**

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
- `package.json` — manifest: **17 komend** (12 core + 5 Auto-Accept), keybindings (Ctrl+Alt+\`, Ctrl+Alt+1-4, F1-F4 gdy fokus na panelu, **Ctrl+Alt+A** dla AA start), 4 `contributes.colors` (ccPanel.terminal.t1-4), **4 configuration properties** (`ccPanel.bypassPermissions`, `ccPanel.autoAcceptSystemPrompt`, `ccPanel.autoAcceptMetaPrompt`, + jedna istniejąca)
- `src/extension.ts` — activate/deactivate, rejestracja 17 komend, `writeAndWarn()`, `projectPathFor(id)`, forward StateWatcher → PanelManager, `startAutoAccept()` orchestrator, `toAutoAcceptDTO()` mapper
- `src/panel/PanelManager.ts` — `vscode.window.createWebviewPanel(ViewColumn.Beside, preserveFocus)`; routing inbound messages; `broadcastInit`; `setAutoAccept()` cache+post
- `src/panel/messages.ts` — TS types inbound/outbound (sendRaw, sendKeystroke, selectTerminal, addTerminal, setDashboard, setProjectPaths, setSlashCommands, setUserLists, **setAutoAccept, stopAutoAccept**); `AutoAcceptStatusDTO`
- `src/terminals/TerminalManager.ts` — node-pty spawn przez `Pseudoterminal`; lazy spawn z fallback 300ms; `cmd.exe /k` na Windows; env `CC_PANEL_TERMINAL_ID=1..4`; flag `--dangerously-skip-permissions` gdy `ccPanel.bypassPermissions=true`
- `src/settings/slashCommands.ts` — 35 statycznych slash commands; `/color` jako 5 wariantów (cyan/orange/purple/pink/random) mapowanych do kolorów T1-T4
- `src/settings/UserListsStore.ts` — R/W `~/.claude/cc-panel/ustawienia.json`: user commands + messages + `projectPaths[T1-T4]`; migracja legacy `projectPath` → slot T1
- `src/settings/editUserLists.ts` — QuickPick/InputBox wizard (edycja list + ustawienie folderu projektu per slot)
- `src/state/StateWatcher.ts` — chokidar na `state.*.json` + dynamiczny watcher na transcript JSONL; debounce 150ms; event emitter; **`getTranscriptPath(id)`** dla AutoAcceptSession
- `src/state/TranscriptReader.ts` — tail read JSONL z cache incremental (tylko przyrost); parse cost/total tokenów z `type:"assistant"`; tabela PRICING per-model; reset przy shrink pliku (nowa sesja); **`readRecentMessages()` dla kontekstu Haiku**
- `src/hooks/installHooks.ts` — upsert `~/.claude/settings.json`: `statusLine` + `UserPromptSubmit` + `Stop`
- **`src/auto-accept/`** — 7 plików pipeline'u:
  - `types.ts` — `AutoAcceptConfig` (z `null` dla unlimited), `AutoAcceptStopReason`, `AutoAcceptStatus`, `HaikuResponse`
  - `HaikuHeadlessClient.ts` — `invokeHaiku({prompt,systemPrompt,signal,timeoutMs})`; `resolveClaudePath` PATH scan; Windows CVE-2024-27980 workaround (`shell:true` dla `.cmd/.bat`)
  - `TriggerDetector.ts` — subskrybuje StateWatcher, emituje `TriggerEvent` na krawędzi working→waiting; debounce 3000ms; single-target
  - `BudgetEnforcer.ts` — pure logic, time/iter/cost (każdy `null` = skip)
  - `CircuitBreaker.ts` — sliding window 3 odpowiedzi; similarity Levenshtein ≥0.80 OR idle-length ±10%
  - `SessionLogger.ts` — append-only JSONL do `~/.claude/cc-panel/aa-sessions.jsonl`; 7 typów eventów discriminated union
  - `AutoAcceptSession.ts` — orkiestrator z DI; busy-skip; 3× error → stop; restart z dispose
  - `startWizard.ts` — 5-krokowy QuickPick wizard (terminal / time / cost / iter / prompt)
- `resources/hooks/` — `statusline.js` (chain-capable, liczy ctx_pct, merge z prev state), `userpromptsubmit.js` (phase=working + transcript_path), `stop.js` (phase=waiting + last_message z JSONL)
- `resources/webview/` — `index.html` (bar-top input+▶+Esc+^C+▼ / **aa-banner** / bar-terms chipy T1-T4 / dashboard section), `styles.css`, `main.js` (z auto-hide timer i local countdown AA)

## Layout

Szczegóły layoutu panelu (bar-top / bar-terms / dashboard) — patrz `ARCHITECTURE.md → Panel layout`. W skrócie: dwa wiersze kontrolek + opcjonalny dashboard (toggle `▼/▲`, persistencja w `vscode.getState()/setState()`). Jeden `<datalist>` scala slash commands + user commands + messages (brak trybów).

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

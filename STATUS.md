## Meta
- project: cc-panel
- session: 12
- updated: 2026-04-19
- repo: https://github.com/tftdatascientist/cc-panel (public, main)

## Hard Constraints (NIETYKALNE)
- **Statusline CC w terminalu JEST ŚWIĘTY.** User ma ccstatusline (lub podobny) z widokiem `Model | Ctx% | Session% | Session time | Cost | Weekly% | Total`. cc-panel NIGDY nie podmienia tego paska. Opcja "Podmień" z `installHooks` wykluczona — nie proponować. Jeśli funkcja cc-panel wymaga podmiany statusline → rezygnujemy z funkcji, NIE ze statusline. Szukamy danych z innego źródła (transcript JSONL, cache CC). Chain mode teoretycznie OK, ale w praktyce nigdy nie zadziałał — przed proponowaniem wymagana diagnoza bugu.

## Done
- **Phase 0-2** — scaffold, webview layout, event bus. Potwierdzone F5.
- **Phase 1** — TerminalManager z node-pty, split terminali T2-T4 przez `parentTerminal`. Kolory tabów przez `contributes.colors`.
- **Phase 3+** — hooki statusline (chain-capable), userpromptsubmit, stop. `installHooks.ts`.
- **Komendy** — `ccPanel.open/addTerminal/cycleActive/selectTerminal1-4/editUserCommands/editMessages/reloadUserLists/installHooks`. Keybindingi Ctrl+Alt+` i Ctrl+Alt+1-4. F1-F4 gdy fokus na panelu.
- **UserListsStore** — `~/.claude/cc-panel/ustawienia.json`, wizard QuickPick/InputBox.
- **Slash commands** — statyczna lista 29 komend w `slashCommands.ts`.
- **Session 8** — fix pustego dropdownu `/COMMANDS` (`setSlashCommands` postuje do webview gdy panel otwarty). Nowy typ `setSlashCommands` w messages.ts.
- **Session 9 — layout panelu (jeden pasek ≤50px, poziomy):**
  - `[input 280px][▶] | [cmd][user][text] | [1][2][3][4] | [Esc][^C]`
  - Tryb `cmd` → dropdown slash commands; `user` → user commands; `text` → gotowe messages
  - Terminal chips 1-4 kolorowane (teal/amber/purple/coral), klik na disabled = addTerminal
  - Opcjonalny tekst z inputu doklejany do komendy cmd/user (np. `/model opus`)
- **Session 9 — fix terminali CC (zjazd/czarny ekran):**
  - Lazy spawn z fallbackiem: jeśli `open()` dostaje `initialDimensions` → spawn natychmiast; jeśli nie → czeka na `setDimensions()`; po 300ms fallback spawn z 220×50
  - `spawnDone` flag zapobiega double-spawn przy kolejnych `setDimensions()`
  - Błąd spawnu wypisywany w terminalu (czerwony tekst) zamiast cichego fail
  - `resolveShell` na Windows: `cmd.exe /k` zamiast `/c` — cmd pozostaje otwarty po zakończeniu CC
- **Session 10 — pływający WebviewPanel (opcja B):**
  - `PanelManager` refactor: z `WebviewViewProvider` → `vscode.window.createWebviewPanel` w `ViewColumn.Beside` z `preserveFocus: true` i `retainContextWhenHidden: true`
  - Usunięte `viewsContainers` + `views` z package.json (kontener niepotrzebny dla WebviewPanel)
  - Usunięta rejestracja `registerWebviewViewProvider` z extension.ts
  - Layout paska webview **bez zmian** (HTML/CSS identyczne z sesji 9)
  - Panel otwiera się jako zakładka edytora — user przeciąga ją do dolnej grupy edytora albo do osobnego okna (drag tab poza VS Code), dzięki czemu Terminal + CC Panel widoczne równocześnie
  - Build: bundle 29.4 KB, `tsc --noEmit` czysto

## Current
- state: `tsc --noEmit` czysto, bundle ~24 KB. VSIX `cc-panel-0.0.2.vsix` spakowany i zainstalowany — rozszerzenie działa bez F5/Extension Dev Host.
- weryfikacja: `Ctrl+Shift+P → CC Panel: Open`, przeciągnij zakładkę do dolnej grupy lub poza okno. Dashboard wypełnia się po pierwszym Stop hooku CC.

## Done — Session 11: dashboard w pływającym oknie (wariant X) ✅

Źródło danych: **transcript JSONL + state.{id}.json**. Bez dotykania statusline CC (Hard Constraint).

**Zrealizowane fazy:**
- ✅ **Faza 1 — TranscriptReader** (`src/state/TranscriptReader.ts`): tail read z cache incremental (czytamy tylko przyrost od ostatniego odczytu), parse linii `type:"assistant"`, sumowanie cumulative cost/total, tabela PRICING per-model (Sonnet/Opus/Haiku 4.x), mapowanie modelu przez prefix nazwy. Reset cache gdy plik skurczy się (nowa sesja).
- ✅ **Faza 2 — StateWatcher** (`src/state/StateWatcher.ts`): chokidar na `state.{1-4}.json` (stały), dynamiczny watcher na aktualnych transcript JSONL (rebind przy zmianie transcript_path), debounce 150ms, EventEmitter<DashboardMap>. Dispose w deactivate.
- ✅ **Faza 3 — dashboard UI**: tabelka 4 kolumny × 3 wiersze metryk (Ctx%, Cost$, Total tokens), kolumna aktywnego terminala podświetlona kolorem terminala (18% opacity), wartości dla nieaktywnych = "—", format tokenów: <1k bez skrótu, <1M = "Xk", ≥1M = "X.XXM".
- ✅ **Faza 4 — last-message**: blok `<section>` pod tabelką, pokazuje `last_message` aktywnego terminala + meta (model + czas), badge "●" na chipie nieaktywnego terminala gdy dostał nową wiadomość (clear po kliknięciu terminala).
- ✅ **Faza 5 — toggle**: przycisk "▼/▲" w pasku, klasa `.frame.dash-collapsed` ukrywa całość, persistencja w `vscode.getState()/setState()` webview.

**Zmiany w plikach:**
- `src/state/TranscriptReader.ts` — NEW
- `src/state/StateWatcher.ts` — NEW
- `src/panel/messages.ts` — dodane `DashboardSnapshotDTO`, `DashboardMapDTO`, `setDashboard` outbound
- `src/panel/PanelManager.ts` — pole `dashboard`, metoda `setDashboard`, dashboard w `broadcastInit`
- `src/extension.ts` — StateWatcher init/dispose, `toDashboardDTO` mapper, forward `onChange` → `panelManager.setDashboard`
- `resources/webview/index.html` — `<section class="dashboard">` z tabelką 4×3 + last-message; toggle button `▼` w pasku
- `resources/webview/styles.css` — style `.dashboard`, `.dash-table`, `.last-message-*`, `.chip-t[data-unread]` badge
- `resources/webview/main.js` — `applyDashboard()`, `renderDashboard()`, `formatMetric`, `formatTokens`, badge unread tracking, dashCollapsed state via getState/setState

## Done — Session 12 ✅

- ✅ **projectPaths [T1-T4] w ustawienia.json** — `UserLists` rozszerzone o `projectPaths: [string,string,string,string]`. Migracja legacy `projectPath` → slot T1. Komenda `ccPanel.setProjectFolder`: QuickPick T1-T4 z kolorami → folder picker.
- ✅ **CEM: dialog foldery cc-panel** — `Tools → cc-panel → Ustaw folder projektu…`: 4 wiersze z kolorowymi badge (teal/amber/purple/coral), picker `…`, przyciski `↑`/`↓` do zamiany slotów miejscami. `Tools → cc-panel → Pokaż ustawienia.json` — podgląd.
- ✅ **Ctx% bardziej widoczny** — `.chip-term-ctx`: `font-size 13px`, `font-weight 700`, kolor = kolor terminala (`--t-color`) na nieaktywnych; `--fg` na aktywnym (tło już podświetlone).
- ✅ **VSIX packaging** — `npx vsce package --no-dependencies` → `cc-panel-0.0.2.vsix`. Zainstalowany przez `Install from VSIX`. Rozszerzenie uruchamiane bez F5/Extension Dev Host.

## Next

- [ ] **Fix bugu T2-T4 env** — `CC_PANEL_TERMINAL_ID` nie dociera do procesu CC w split terminalach (patrz Known bugs)
- [ ] **Test dashboardu** — weryfikacja Ctx%/Cost$/Total po Stop hooku z zainstalowanego VSIX
- [ ] **Test /resume** — TranscriptReader reset cache przy nowej sesji

## Known bugs
- **T2-T4: `CC_PANEL_TERMINAL_ID` env nie dociera do procesu CC.** Dowód: user zainicjował T2 w sesji 11, ale `~/.claude/cc-panel/state.2.json` nie powstał (hook widzi env="" → `process.exit(0)` bo `!/^[1-4]$/.test("")`). Przyczyna prawdopodobna: `TerminalManager.create()` używa `vscode.window.createTerminal({env, location:{parentTerminal}})` — split terminal może dziedziczyć env parenta zamiast brać nowy `env` z opts. Dla T1 działa bo nie ma parenta (używa `TerminalLocation.Panel`). Fix: wszystkie terminale spawnować jako `TerminalLocation.Panel` (nie split parentTerminal), LUB zmienić strategię na dedykowany shell integration który przekazuje env przez `bash -c "CC_PANEL_TERMINAL_ID=2 claude"`.

## Backlog (niżej priorytetowe)
- [ ] Fix bugu T2-T4 env (patrz Known bugs)
- [ ] Weryfikacja ręczna — terminale CC startują i render poprawny (regresja sesji 9)
- [ ] VSIX packaging + publishing
- [ ] Testy jednostkowe: `tests/state/transcriptReader.test.ts` z fikstur JSONL (incremental cache, reset przy shrink, cost cumulative)

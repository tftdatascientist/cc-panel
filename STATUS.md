## Meta
- project: cc-panel
- session: 17
- updated: 2026-04-20
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
- state: `tsc --noEmit` czysto (po Kroku 1 Auto-Accept); bundle ~94 KB (Auto-Accept jeszcze nie w bundle — nie zarejestrowane w extension.ts). VSIX `cc-panel-0.0.3.vsix` zainstalowany lokalnie (`lokalnaautomatyzacjabiznesu.cc-panel-0.0.3`) — **NIE przebudowany po Kroku 1**, aktualna wersja Marketplace bez AA.
- publisher: `LokalnaAutomatyzacjaBiznesu`; VSIX 0.0.3 wgrany ręcznie na Marketplace.
- slash commands: 35 pozycji; `/color` rozwinięty na 5 wariantów (cyan/orange/purple/pink/random) mapowanych do kolorów terminali T1-T4.
- **Auto-Accept:** Krok 1/7 ukończony. `src/auto-accept/` zawiera `types.ts` + `HaikuHeadlessClient.ts`. Klient przetestowany empirycznie, ale **jeszcze nie podłączony nigdzie** — żadne komendy VS Code ani subskrypcje StateWatcher. Kolejne kroki 2-7 w Next. Plan: `docs/AUTO_ACCEPT_PLAN.md`. Branch `main`, 5 commitów przed `origin/main` (niewypchnięte).

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

## Done — Session 13 ✅

- ✅ **Fix odczytu projectPaths w TerminalManager** — `create(id)` używało `workspaceFolders[0]` ignorując `ustawienia.json`. Dodano parametr `projectPath?` do `create()`. Helper `projectPathFor(id)` w `extension.ts` czyta `userListsStore.current().projectPaths[id-1]` i przekazuje przy spawnie.
- ✅ **Widoczność folderu projektu w chipach T1-T4** — nowy `<span class="chip-term-folder">` w każdym chipie; pokazuje basename ścieżki, tooltip = pełna ścieżka. Aktualizuje się natychmiast po `ccPanel.setProjectFolder` (przez `pushUserLists` → `setProjectPaths`). Gdy nieustawiony — span `display:none` (CSS `:empty`).
- ✅ **Nowy typ wiadomości `setProjectPaths`** — `messages.ts`, `PanelManager.setProjectPaths()`, propagacja w `broadcastInit` i `pushUserLists`.
- ✅ **Publish na Marketplace** — publisher zmieniony z `local-dev` na `LokalnaAutomatyzacjaBiznesu` w package.json; VSIX 0.0.2 wgrany ręcznie przez marketplace.visualstudio.com/manage.

## Done — Session 14 ✅

- ✅ **Fix koloru ikon terminala** — `createTerminal` używał `new vscode.ThemeIcon("terminal")` bez drugiego argumentu → ikona szara. Poprawiono na `new vscode.ThemeIcon("terminal", new vscode.ThemeColor("ccPanel.terminal.t${id}"))`. Atrybut `color` (kolor zakładki) pozostał bez zmian.
- ✅ **`/color` w slash commands** — dodano jako 1 wpis (lista 30 komend). Poprawione w sesji 15 na 5 wariantów z właściwymi nazwami CC CLI.
- ✅ **Bypass permissions domyślnie włączony** — nowa opcja `ccPanel.bypassPermissions` (boolean, default `true`). Gdy `true`, CC spawnowany z flagą `--dangerously-skip-permissions`. Wyłączalna w Settings bez rekompilacji.
- ✅ **Skracanie nazwy folderu w chipach** — `renderFolders()` ucina basename do 14 znaków + "…". Tooltip zawiera pełną ścieżkę. Zapobiega rozciąganiu chipów T1-T4.
- ✅ **VSIX 0.0.3** — `cc-panel-0.0.3.vsix`, 49 KB, `tsc --noEmit` czysto. Stare wersje (`local-dev.cc-panel-0.0.1/0.0.2`, `LokalnaAutomatyzacjaBiznesu.cc-panel-0.0.2`) usunięte. Zainstalowany jedynie `lokalnaautomatyzacjabiznesu.cc-panel-0.0.3`.

## Done — Session 15 ✅

- ✅ **`/color` poprawione na warianty CC CLI** — 5 wpisów: `/color cyan (T1)`, `/color orange (T2)`, `/color purple (T3)`, `/color pink (T4)`, `/color random`. Poprzednie nazwy (teal/amber/coral) nie były w puli CC CLI.
- ✅ **Usunięcie martwych komend VS Code** — weryfikacja: wszystkie 12 komend w `package.json` mają odpowiadający `registerCommand` w `extension.ts`; żadna nie była martwa.
- ✅ **Dokumentacja komend** — `ARCHITECTURE.md` uzupełniony o tabelę 12 komend z dokładnym opisem działania, keybindingami i przepływem danych.
- ✅ **ARCHITECTURE.md aktualizacja** — usunięte znaczniki `[PLANOWANE]`, poprawione liczby (34 slash commands), zaktualizowany data flow state.json, dodano `TranscriptReader.ts` do Key files.
- ✅ **STATUS.md aktualizacja** — numer sesji, Current state, Slash commands count.

## Done — Session 16 ✅

- ✅ **Weryfikacja bugu T2-T4 env** — `ls ~/.claude/cc-panel/` pokazuje wszystkie 4 pliki `state.{1-4}.json` z poprawnymi `terminal_id`, różnymi `transcript_path` i świeżymi wpisami (2026-04-20). Hooki odbierają `CC_PANEL_TERMINAL_ID=1..4` we wszystkich slotach. Fix wprowadzony wcześniej w `TerminalManager.ts` (shell-prefix zamiast `createTerminal({env})`) rozwiązał problem — STATUS.md i CLAUDE.md zawierały **stały opis buga który już nie reprodukuje**. Usunięto.
- ✅ **Aktualizacja dokumentacji** — `CLAUDE.md` sekcja "Known bugs (aktualne)" usunięta; `STATUS.md` sekcja `Known bugs` wyczyszczona; `Next` bez wpisu o fixie T2-T4.
- ✅ **Commit zaległej dokumentacji** — `CLAUDE.md` (+79/-38) i `ARCHITECTURE.md` (drobna zmiana) z sesji 15 zostały scommitowane razem z aktualizacją sesji 16.

## Done — Session 17 ✅

- ✅ **Recovery planu Auto-Accept** — plan stracony przy compaction 2026-04-19 odzyskany z transkryptu JSONL (timestamp 2026-04-20T00:23:13Z), zapisany do `docs/AUTO_ACCEPT_PLAN.md` (158 linii; commit `beca5df`).
- ✅ **CLAUDE.md refactor** — blockquote → sekcja `## Workflow` (3 numerowane kroki); luźna notka "Planowane" → `## Auto-Accept Mode` z realnym kosztem Haiku; duplikat "Layout i źródło metryk" → pointer do ARCHITECTURE.md (dedup 9 linii). Commit `e41323f`.
- ✅ **Smoke test `claude -p --output-format json --model haiku`** — kontrakt CLI zgodny z planem (pola `result`, `total_cost_usd`, `duration_ms`, `usage`). **Realny koszt ~$0.0730/iter** (cache_creation 58046 input tokens) — 35× więcej niż zakładał plan ($0.002). `--model haiku` → alias dla `claude-haiku-4-5-20251001`. Przy budżecie $1 → ~14 iter, nie 500.
- ✅ **Audit dokumentacji (Session 17)** — wykryta i naprawiona rozbieżność: slash commands 34 → 35 w CLAUDE.md, ARCHITECTURE.md (2×), STATUS.md. Realny count `SLASH_COMMANDS` = 35 pozycji w `src/settings/slashCommands.ts`.
- ✅ **Decyzje usera ws. Auto-Accept (wszystkie rozstrzygnięte 2026-04-20):**
  - D1 keybinding: `Ctrl+Alt+A` ✅
  - D2 scope MVP: single-active globalnie (1 sesja AA naraz, nie per-terminal) ✅
  - D3 budget domyślny: 15 min / $5.00 / 50 iter (cost urealniony z $1 po smoke teście — realny ~$0.07/iter) ✅
  - D4 semantyka "bez limitu": **wariant (c)** — wszystkie 3 limity mogą być `null` (time+cost+iter unlimited). Jedyne hard-stopy wtedy: user stop, circuit breaker, panel dispose, 3× exit!=0. **Implikacja:** CircuitBreaker musi być bardziej agresywny (threshold 0.80 zamiast 0.85 + dodatkowa heurystyka `idle-iterations` — brak progresu = stop)
- ✅ **Krok 1 implementacji Auto-Accept** (commit `01c7fef`) — `src/auto-accept/types.ts` (AutoAcceptConfig z `number|null`, AutoAcceptStopReason, HaikuResponse, IterationRecord, AutoAcceptStatus) + `src/auto-accept/HaikuHeadlessClient.ts` (resolveClaudePath z PATH scan na claude.cmd/exe/bare, `invokeHaiku({prompt,systemPrompt,signal,timeoutMs})`, HaikuCliError z exitCode+stderr). **Gotcha rozwiązany:** Windows Node 20+ CVE-2024-27980 — execFile odmawia uruchomienia `.cmd/.bat` bez `shell:true`; conditional `shell:true` gdy resolved path to `.cmd/.bat`. **Smoke test live (node + esbuild bundle) ✅:** prompt "Reply with exactly: OK" → result="OK", koszt $0.0739, sessionId OK; AbortController.abort() po 500ms → AbortError (in-flight cancel działa).

## Next

- [ ] **Krok 2 Auto-Accept — `SessionLogger.ts`** — append-only JSONL do `~/.claude/cc-panel/aa-sessions.jsonl`. Format eventów w `docs/AUTO_ACCEPT_PLAN.md → Format logu JSONL` (session-start / trigger / haiku-response / send-to-tN / session-stop). Prosty, trywialny. Wymaga tylko: `fs.appendFileSync`, `crypto.randomUUID()` dla sessionId, utility `logEvent(type, payload)`.
- [ ] **Krok 3 Auto-Accept — `TriggerDetector.ts`** — subscribe do `StateWatcher.onChange` (ale filtrowanie: monitoruje tylko terminal objęty AA); per-terminal `lastPhase = Map<TerminalId, 'working'|'waiting'|undefined>`; emit `waiting-edge` tylko gdy `working→waiting`; opcjonalny debounce 3000ms (z planu).
- [ ] **Krok 4 Auto-Accept — `BudgetEnforcer.ts` + `CircuitBreaker.ts`** — BudgetEnforcer.check(): przelicza cumulative cost ze state.{id}.json (diff od startedAt), compare do `costLimitUsd` (skip jeśli null). CircuitBreaker: Levenshtein ratio na ostatnich 3 outputach Haiku, threshold 0.80 (D4 implikacja), + idle heurystyka (3× z rzędu ten sam response-length ±10% = podejrzane).
- [ ] **Krok 5 Auto-Accept — `AutoAcceptSession.ts`** — orkiestrator składający wszystko: TriggerDetector.on('waiting-edge') → BudgetEnforcer.check() → jeśli OK: HaikuHeadlessClient.invoke() → CircuitBreaker.analyze(response) → writeAndWarn(response.result + '\r') do aktywnego terminala → SessionLogger.append(). onDispose: abort pending invoke, log session-stop.
- [ ] **Krok 6 Auto-Accept — Command Palette wiring** (`extension.ts`) — 5 komend (startAutoAccept, stopAutoAccept, editAutoAcceptSystemPrompt, showAutoAcceptHistory, autoAcceptStatus) + keybinding `Ctrl+Alt+A` → `ccPanel.startAutoAccept`. QuickPick wizard dla startu (terminal T1-T4 → czas 5m/15m/1h/5h/∞ → cost limit $ (0=bez limitu) → iter limit (0=bez limitu) → system prompt Y/N).
- [ ] **Krok 7 Auto-Accept — webview banner** — pod paskiem kontrolnym gdy AA aktywny: "AA: T# · iter N/L · cost $X/$Y · time left" + przycisk Stop. Nowy typ message `setAutoAcceptStatus` w `messages.ts`.
- [ ] **Test dashboardu** — weryfikacja Ctx%/Cost$/Total po Stop hooku (TranscriptReader z JSONL); backend zweryfikowany empirycznie w sesji 16 na 4 transcriptach.
- [ ] **Test /resume** — TranscriptReader reset cache przy nowej sesji (shrink pliku).
- [ ] **PAT dla `vsce publish`** — skonfigurować na dev.azure.com żeby uniknąć ręcznego uploadu.

## Known bugs
- (brak)

## Backlog (niżej priorytetowe)
- [ ] Testy jednostkowe: `tests/state/transcriptReader.test.ts` z fikstur JSONL (incremental cache, reset przy shrink, cost cumulative)

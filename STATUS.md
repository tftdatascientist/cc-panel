## Meta
- project: cc-panel
- session: 24
- updated: 2026-04-20
- repo: https://github.com/tftdatascientist/cc-panel (public, main)

## Hard Constraints (NIETYKALNE)
- **Statusline CC w terminalu JEST ŚWIĘTY.** User ma ccstatusline (lub podobny) z widokiem `Model | Ctx% | Session% | Session time | Cost | Weekly% | Total`. cc-panel NIGDY nie podmienia tego paska. Opcja "Podmień" z `installHooks` wykluczona — nie proponować. Jeśli funkcja cc-panel wymaga podmiany statusline → rezygnujemy z funkcji, NIE ze statusline. Szukamy danych z innego źródła (transcript JSONL, cache CC). Chain mode teoretycznie OK, ale w praktyce nigdy nie zadziałał — przed proponowaniem wymagana diagnoza bugu.

## Done — foundations (sesje 0-16)

Fundament cc-panel ukończony. Szczegóły w `ARCHITECTURE.md` (komponenty, data flow, komendy). Skrócone highlighty:

- **Scaffolding (sesje 0-7):** `TerminalManager` z node-pty (split T2-T4 przez `parentTerminal`, kolory zakładek przez `contributes.colors`), hooki `statusline/userpromptsubmit/stop` + `installHooks.ts`, `UserListsStore` (R/W `ustawienia.json`), 12 komend z keybindingami.
- **Sesja 8** — fix pustego dropdownu `/COMMANDS` (nowy typ `setSlashCommands`).
- **Sesja 9** — layout panelu: input+▶+keystrokes+chipy T1-T4 w jednym pasku; lazy spawn z fallback 300ms + `spawnDone` (fix "zjazdu" / czarnego ekranu CC); `cmd.exe /k` na Windows.
- **Sesja 10** — refactor do pływającego WebviewPanel (`ViewColumn.Beside + preserveFocus`) — zakładka edytora, którą user przeciąga poza VS Code dla floating window.
- **Sesja 11** — dashboard w panelu (`StateWatcher` + `TranscriptReader`): tabelka 4×3 (Ctx%/Cost$/Total), last-message, toggle `▼/▲` z persistencją przez `vscode.getState()`.
- **Sesja 12** — `projectPaths[T1-T4]` w `ustawienia.json`, komenda `ccPanel.setProjectFolder` (QuickPick + folder picker), migracja legacy `projectPath` → slot T1; VSIX 0.0.2.
- **Sesja 13** — fix `TerminalManager` czytającego `workspaceFolders[0]` zamiast `ustawienia.json` (nowy parametr `projectPath?`); widoczność folderu w chipach (`chip-term-folder`); publisher `LokalnaAutomatyzacjaBiznesu`.
- **Sesja 14** — fix koloru ikony terminala (`ThemeIcon(name, ThemeColor)`); opcja `ccPanel.bypassPermissions` z flagą `--dangerously-skip-permissions`; skracanie nazwy folderu do 14 znaków; VSIX 0.0.3.
- **Sesja 15** — `/color` poprawiony do 5 wariantów CC CLI (`cyan/orange/purple/pink/random`); weryfikacja że wszystkie 12 komend są zarejestrowane; `ARCHITECTURE.md` uzupełniony o tabelę komend.
- **Sesja 16** — weryfikacja (przez `ls ~/.claude/cc-panel/state.*.json`) że bug T2-T4 env nie reprodukuje — usunięcie stałych wpisów "Known bugs" w dokumentacji.

## Current
- **Build:** `tsc --noEmit` czysto; esbuild bundle **114.5 KB** (production, minified).
- **VSIX:** `cc-panel-0.0.4.vsix` zbudowany lokalnie (60.86 KB). Oczekuje na ręczny upload na Marketplace (brak PAT).
- **Publisher:** `LokalnaAutomatyzacjaBiznesu`.
- **Komendy:** 17 (12 core + 5 AA). Keybindings: `Ctrl+Alt+\`` (cycle), `Ctrl+Alt+1-4` / `F1-F4` (select terminal), `Ctrl+Alt+A` (start AA).
- **Slash commands:** 35 pozycji; `/color` rozwinięty na 5 wariantów (cyan/orange/purple/pink/random) mapowanych do kolorów terminali T1-T4.
- **Auto-Accept:** Kroki 1-7/7 zaimplementowane + advisor fixes. Pipeline zweryfikowany E2E headless (sesja 23). Plan: `docs/AUTO_ACCEPT_PLAN.md`. Szczegóły: `ARCHITECTURE.md → Auto-Accept`. **E2E przez F5 jeszcze nieprzetestowane.**

## Done — Auto-Accept (sesje 17-22)

### Session 17 ✅ — przygotowanie + Krok 1

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

### Session 18 ✅ — Krok 2

- ✅ **`SessionLogger.ts`** — append-only JSONL do `~/.claude/cc-panel/aa-sessions.jsonl`. Discriminated union 6 typów eventów (`session-start`, `trigger`, `haiku-response`, `haiku-error`, `send-to-terminal`, `session-stop`) zgodnych z `docs/AUTO_ACCEPT_PLAN.md → Format logu JSONL`. Klasa `SessionLogger(sessionId)` z metodami `logStart/logTrigger/logHaikuResponse/logHaikuError/logSendToTerminal/logStop`. `newSessionId()` → `crypto.randomUUID()`. `readRecentSessions(limit=20)` dla historii (reverse order, ostatnie N). Błędy I/O łapane w try/catch z `console.error` — nie rzuca (append nie może zawalić AA session). `ensureLogDir()` robi `fs.mkdirSync(recursive:true)` przy konstrukcji. **Smoke test (esbuild bundle + node):** 6 linii zapisanych i sparsowanych, `readRecentSessions` zwrócił 1 start z `costLimitUsd=5`. Kompilacja `tsc --noEmit` czysta. **Jeszcze nie zintegrowane w `extension.ts`.**

### Session 19 ✅ — Krok 3

- ✅ **`TriggerDetector.ts`** — subskrybuje `StateWatcher.onChange` (emituje całą `DashboardMap`, nie deltę), filtruje po `activeTerminalId`, trzyma `lastPhase = Map<TerminalId, "working"|"waiting">` + `workingStartedAt` dla obliczenia `reactionMs`. Emituje `TriggerEvent { terminalId, timestamp, reactionMs }` tylko gdy `prev === "working" && now === "waiting"`. **Debounce 3000ms** (z `docs/AUTO_ACCEPT_PLAN.md → Decyzje odłożone`) blokuje powtórny edge — chroni przed burst-writes hooków i daje user szansę na ręczny wpis. `normalizePhase()` odrzuca cokolwiek poza "working"/"waiting" (null/inne) — nie resetuje stanu, tylko ignoruje. API: `start(id)`, `stop()`, `dispose()`, `onTrigger`. **Scope D2 (single-active):** monitoruje tylko jeden terminal naraz, drugi `start(id)` przełącza target z pełnym reset. **Smoke test (esbuild + vscode shim + fake StateWatcher):** 9 asercji passed — podstawowa krawędź / waiting→waiting skip / working→working skip / inny terminal ignorowany / debounce / stop czyści subskrypcję / invalid phase. Kompilacja `tsc --noEmit` czysta. **Jeszcze nie zintegrowane w `extension.ts`.**

### Session 20 ✅ — Krok 4

- ✅ **`BudgetEnforcer.ts`** — pure logic, czyste od VS Code API. `check(now)` weryfikuje 3 limity w kolejności time → iter → cost, każdy `null` = skip (D4 wariant c). `recordIteration(costUsd)` akumuluje cost tylko dla `costUsd > 0 && Number.isFinite(costUsd)` (NaN/ujemne ignorowane). `recordFailedIteration()` zwiększa tylko licznik (failed Haiku nie ma zwróconego kosztu). `getTimeLeftMs()` zwraca `null` dla `timeLimitMs=null`. Discriminated union `BudgetDecision = {ok:true} | {ok:false, reason: "time-limit"|"iter-limit"|"cost-limit"}`.
- ✅ **`CircuitBreaker.ts`** — dwie heurystyki na sliding window ostatnich 3 odpowiedzi Haiku:
  1. **Similarity**: minimum pairwise `similarityRatio` (Levenshtein `1 - dist/max(len)`) ≥ threshold 0.80 (D4 implikacja — zaostrzone z 0.85 bo przy "bez limitu" breaker = jedyna automatyczna ochrona).
  2. **Idle-length**: wszystkie 3 długości w paśmie ±10% od średniej → zakładamy pętlę (trafia przypadki gdzie treść się różni ale "kształt" nie — np. numerowanie kroków).
  Zwraca `{tripped, reason, detail}`. Dopóki window < 3 — zawsze `tripped:false`. `reset()` czyści historię (np. po zmianie promptu usera).
- ✅ **Smoke test (27 asercji):** BudgetEnforcer 13× (time/iter/cost limity, null-everywhere, failed iter, NaN handling, getTimeLeftMs) + similarityRatio 4× (identity, empty, kitten/sitting baseline 0.571) + CircuitBreaker 10× (<window=not-tripped, 3×identyczne=similarity, 3×zupełnie-różne=not-tripped, 85%-similar=tripped, 3×długość-20=idle-length, sliding-window-resets, reset()). Wszystkie passed. `tsc --noEmit` czysto.

### Session 21 ✅ — Krok 5

- ✅ **`AutoAcceptSession.ts`** — orkiestrator z DI pattern (`AutoAcceptDeps`: triggerDetector, haikuClient, writeToTerminal, **getRecentMessages**). `start(config)` subskrybuje trigger, `stop(reason)` idempotent, `dispose()` czyści EventEmitter. `handleTrigger()` przechodzi: budget check → getRecentMessages → buildPromptWithContext → invokeHaiku (z AbortController) → breaker.analyze → writeToTerminal+"\r". Busy-skip: trigger podczas in-flight nie jest kolejkowany, tylko loguje `skipped-busy`. Error handling: 3× consecutive Haiku error → `stop("cli-errors")`; writeToTerminal returns false → `stop("cli-errors")` z dedykowanym `write-failure` eventem (advisor fix). Cost/iter limity sprawdzane także po każdej udanej iteracji (nie tylko przed). Emituje `onStatus` po każdej zmianie stanu.
- ✅ **Plan Decyzja 3b — kontekst dla Haiku** — `TranscriptReader.readRecentMessages(path, limit=5)` tail-read ostatnich 64KB JSONL, filtruje sidechain/attachment/system, wyciąga user-messages (content=string, bez tool_result) + assistant text blocks (bez tool_use). `buildPromptWithContext(metaPrompt, recent)` wstawia preamble "Recent conversation:" + role-labeled snippety (obcięte do 2000 znaków) + separator + metaPrompt. Pusty `recent` → tylko metaPrompt (MVP-fallback). Haiku dostaje realny kontekst zamiast odpowiadać ślepo.
- ✅ **Advisor fixes przy okazji:** (1) `SessionLogger` — nowy 7. event type `write-failure` zamiast recyklingu `haiku-error` dla niepowodzenia writeToTerminal (czysty filtr w historii); (2) `AutoAcceptSession` — fail writeToTerminal → `stop("cli-errors")` zamiast cichego kontynuowania (wcześniej sesja mogła zawisnąć wysyłając ciche błędy w nieskończoność).
- ✅ **Smoke test — 33 asercje / 8 scenariuszy passed:** (1) happy path 2 iter → 2× writeToTerminal, poprawny prompt z kontekstem; (2) busy-skip → 2 skipped-busy events, 1 invoke; (3) circuit-breaker po 3× identycznej odpowiedzi → `stop("circuit-breaker")`; (4) cost-limit $1 przy $0.60/iter → stop po 2. iter z reason `cost-limit`; (5) 3× Haiku exception → `stop("cli-errors")` + 3 haiku-error events; (6) writeToTerminal fail → `stop("cli-errors")` + write-failure event; (7) `readRecentMessages` na realnym JSONL CC → 5 wiadomości, brak wycieku tool_use_id; (8) `buildPromptWithContext` → preamble + labels + separator + truncation. Kompilacja `tsc --noEmit` czysta. **Jeszcze nie podłączone w `extension.ts`.**

### Session 22 ✅ — Krok 6 (Command Palette)

- ✅ **Command Palette wiring** (`extension.ts`) — 5 komend zarejestrowanych: `ccPanel.startAutoAccept` (keybinding `Ctrl+Alt+A`), `ccPanel.stopAutoAccept`, `ccPanel.autoAcceptStatus`, `ccPanel.showAutoAcceptHistory` (QuickPick z `readRecentSessions(20)`), `ccPanel.editAutoAcceptSystemPrompt` (zapis do `workspace.getConfiguration("ccPanel").update("autoAcceptSystemPrompt", ..., ConfigurationTarget.Global)`).
- ✅ **`startAutoAccept()` orchestrator** — restart z potwierdzeniem gdy sesja aktywna; start wizard (`runStartWizard`) z listy aktywnych terminali; DI wire-up: `new TriggerDetector(stateWatcher)` + `{ invokeHaiku }` + `terminalManager.write` + `readRecentMessages` przez `stateWatcher.getTranscriptPath(id)` (nowa metoda publiczna w `StateWatcher`, zwraca aktualny transcript). `onStatus` forward do `showWarningMessage` gdy stop z błędem.
- ✅ **`startWizard.ts`** — sekwencyjny QuickPick 5 kroków: terminal (T1-T4 z dostępnych) → czas (5m/15m/1h/5h/∞) → cost $ (input `0` = null) → iter (input `0` = null) → system prompt (domyślny lub edytuj). Escape = anuluj cały wizard.
- ✅ **`types.ts` + getStatus fix** — pole `stopReason: AutoAcceptStopReason | null` w `AutoAcceptStatus` (tsc zgłaszał TS2741); dodane tracking `this.stopReason` w `AutoAcceptSession` (reset w `start()`, ustawiane w `stop()`).
- ✅ **Package.json** — 5 nowych komend w `contributes.commands`, keybinding `Ctrl+Alt+A` → `ccPanel.startAutoAccept`, 2 nowe configuration properties: `ccPanel.autoAcceptSystemPrompt` (default = plan-compatible instrukcja dla Haiku <200 znaków z fallbackiem "stop") oraz `ccPanel.autoAcceptMetaPrompt`.
- ✅ **`deactivate()`** — dispose kolejności: `autoAcceptSession → stateWatcher → panelManager → terminalManager`. AutoAcceptSession.dispose() wewnętrznie wywołuje `stop("panel-dispose")` jeśli aktywna.
- ✅ **Kompilacja + build** — `tsc --noEmit` czysto, esbuild bundle **112.5 KB** (wzrost z ~94 KB po dołączeniu 7 nowych plików AA).

### Session 22 (c.d.) ✅ — Krok 7 (webview banner)

- ✅ **Webview banner** (`resources/webview/`) — cienki pasek (~26px) pod bar-top, widoczny tylko gdy AA aktywny lub gdy `lastError` obecny (komunikat po stopie). Layout: `● AA T# · iter N/L · $X/$Y · time left · [Stop]`. Pulsujący żółty dot (żółta akcent — widoczny, niezależny od koloru terminala). Countdown `time left` liczony **lokalnie w webview** (interval 1s) z `startedAt + timeLimitMs − Date.now()` — brak potrzeby pushowania statusu co sekundę z extension (Δ ≤500 postMessage/sesja). Threshold `is-limit-near` (czerwony) gdy metryka ≥90% limitu albo < 60s do końca czasu.
- ✅ **messages.ts** — nowy DTO `AutoAcceptStatusDTO` (spłaszczone pola: `maxIterations`, `costLimitUsd`, `timeLimitMs`, `lastError`); outbound `setAutoAccept`; inbound `stopAutoAccept` (kliknięcie Stop buttona w bannerze); `AutoAcceptStatusDTO | null` w `init`.
- ✅ **PanelManager** — `setAutoAccept(status)` cache'uje i postuje; `onStopAutoAccept` callback w `PanelCallbacks`; routing inbound `stopAutoAccept` → callback.
- ✅ **extension.ts** — forward `autoAcceptSession.onStatus` → `panelManager.setAutoAccept(toAutoAcceptDTO(status))`; `toAutoAcceptDTO` mapper spłaszczający wewnętrzny `AutoAcceptStatus` do DTO; `onStopAutoAccept` callback wywołuje `autoAcceptSession.stop("user-stop")`; restart sesji z `dispose()` + `= undefined` (czyści poprzedni EventEmitter bez leaka).
- ✅ **CSS + HTML + main.js** — nowa sekcja `.aa-banner` z `data-state=active|stopped`; `formatDuration(ms)` (`1m30s`, `2h15m`, `45s`); `truncate(s, n)` dla lastError; handler `aaStopBtn.onclick` → `postMessage({type:"stopAutoAccept"})`; `startAaClock`/`stopAaClock` z `setInterval(renderAaTime, 1000)`; subscription do `init` + `setAutoAccept`.
- ✅ **Kompilacja + build** — `tsc --noEmit` czysto; esbuild bundle **113.2 KB** (+0.7 KB za banner wiring); `node --check main.js` syntax OK.
- ✅ **Advisor fixes (Krok 7 post-review):**
  - (fix #3) **Banner term color zgodny z AA terminalem** — `.aa-banner-term` używa `var(--t-color, var(--accent))` z fallbackiem; klasa `chip-t1..4` dodawana do `aaTermEl` w JS zapewnia `--t-color` zgodny z terminalem AA, nie aktywnym chipem panelu. Istotne gdy user patrzy na T2, a AA działa na T3 — badge świeci kolorem T3.
  - (fix #2) **Auto-hide stopped banner po 5s** — nowy `aaHideTimer` w webview; `applyAutoAccept` przy `status.active=false` ustawia `setTimeout(() => aaBanner.hidden = true, 5000)`; `clearAaHideTimer()` woła się przy każdym kolejnym update, żeby szybki restart sesji nie ukrył świeżego aktywnego bannera. Zapobiega stale cache bannera "stopped" przy kolejnym `ccPanel.open` (init dostarcza DTO z ostatnim lastError).

## Next

### Session 23 ✅ — zmiany UI (3/4 zrealizowane)

Zrealizowano 3 z 4 planowanych zmian (decyzja usera: pominąć przeniesienie metryk do chipów + usunięcie tabelki):

- ✅ **Wzmocnienie wskaźników `working` vs `waiting`** — `resources/webview/styles.css` + `main.js`:
  - `main.js:renderDashboard` — dodane `chip.dataset.phase = "working" | "waiting" | "idle"` (oprócz kompat `data-working`).
  - CSS: **3 stany maksymalnie rozróżnione.** `working` = pulsujący glow `box-shadow` w kolorze terminala + tło 20% + pulsujący dot 7px z halo (3 sygnały naraz). `waiting` = statyczny inset outline 50% + pusty kontur dot (tylko `border`, `background:transparent`). `idle` = nic. `box-shadow` zamiast `border-width` — zero layout shift przy przejściu.
- ✅ **Dropdown — dedup + sort po częstości** — `resources/webview/main.js:rebuildDatalist`:
  - Trzy sekcje: ⏱ Historia (top 20 z `history[]`) / ⭐ Najczęstsze (top 10 wg `usageStats.count`) / reszta (slash+user+messages, sort po count DESC).
  - Dedup po `value` przez `Set used` — priorytet Historia > Najczęstsze > reszta. `<option label="⏱ foo">` prefix jako oznaczenie sekcji (optgroup w datalist nie działa cross-browser).
- ✅ **Historia komend — zapis + wybór z dropdownu** — `UserListsStore.recordCommand(value)` (LRU dedup + cap 100), rozszerzony schemat `UserLists` (`history: string[]` + `usageStats: Record<string, {count, lastUsedAt}>`), tolerancyjny `validate()` (brak pól = `[]`/`{}`, nieprawidłowe wpisy filtrowane nie odrzucają całego pliku).
  - `messages.ts` — nowy inbound `recordCommand {value}`, `init` + `setUserLists` rozszerzone o `history` + `usageStats`.
  - `PanelManager.setUserLists` przyjmuje 5 argumentów (doszły 2), routing inbound `recordCommand` → `onRecordCommand` callback.
  - `extension.ts` — `onSendRaw` automatycznie woła `userListsStore.recordCommand(clean)` (strip `\r`); osobny `onRecordCommand` callback (nieużywany przez webview obecnie, ale API gotowe na przyszłe "kopiuj bez wysyłki"). `pushUserLists` przekazuje history+usageStats.
- ✅ **Zachowane bez zmian** (decyzja usera): metryki w dashboard-tabelce 4×2 + pole `.last-message` + toggle `▼/▲`. Nie ruszano `.dashboard-grid` ani `.chip-term-wide` (layout). Migracja metryk do chipów — przełożona na przyszłość.
- ✅ **Kompilacja + build** — `tsc --noEmit` czysto; esbuild bundle **251.6 KB** (+138 KB od Kroków AA — node-pty/chokidar bundled); `node --check main.js` syntax OK.

### Planowane (przesunięte z sesji 23)

- [ ] **Metryki w chipy T1–T4 + usunięcie dashboard-tabelki** — pole `.last-message` **ZOSTAJE**, znika tylko tabelka 4×2. Format w chipie: `$1.02 / 24K / 50%`. Toggle `▼/▲` — do decyzji (zostaje dla ukrywania last-message czy znika?). Dotyka: `index.html` (spans `data-metric="cost"/"total"` w `chip-term-wide`; wyrzucić `.dashboard-grid`), `styles.css` (`chip-term-wide` — 3 metryki + folder w jednym wierszu, min-width >128px), `main.js` (`renderDashboard` — routing metryk do spanów w chipach). Pominięte w sesji 23 na prośbę usera.

### Pozostałe

- ✅ **E2E headless AA** (2026-04-20) — pipeline zweryfikowany bez F5: fake StateWatcher + realny TriggerDetector → realny HaikuHeadlessClient (claude.cmd) → realny BudgetEnforcer → realny SessionLogger → fake writeToTerminal. Trigger reactionMs ~110ms, 2 iteracje ("ok"/"ok"), auto-stop na `iter-limit`, JSONL kompletny (8 eventów). **Cache hit drugiej iteracji: $0.0067** (vs $0.0787 pierwszej) — realnie po warm-upie ~10× taniej. Webview banner i node-pty spawn nie pokryte (smoke test sesja 22, komponent niezmieniony od 0.0.3).
- ✅ **Bump version + VSIX 0.0.4** (2026-04-20) — `package.json` 0.0.3→0.0.4, commit `326764a`, `cc-panel-0.0.4.vsix` zbudowany (60.86 KB). Oczekuje na upload na Marketplace.
- [ ] **Upload na Marketplace** — ręczny upload `cc-panel-0.0.4.vsix`; docelowo PAT na dev.azure.com dla `vsce publish`.
- [ ] **E2E przez F5** — test AA od UI: start wizard → trigger → Haiku response → banner.
- [ ] **Test dashboardu** — weryfikacja Ctx%/Cost$/Total po Stop hooku (TranscriptReader z JSONL); backend zweryfikowany empirycznie w sesji 16 na 4 transcriptach.
- [ ] **Test /resume** — TranscriptReader reset cache przy nowej sesji (shrink pliku).

## Known bugs
- (brak)

## Backlog (niżej priorytetowe)
- [ ] Testy jednostkowe: `tests/state/transcriptReader.test.ts` z fikstur JSONL (incremental cache, reset przy shrink, cost cumulative)

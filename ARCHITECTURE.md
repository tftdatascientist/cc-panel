## Overview
Ekstensja VS Code renderuje cienki panel webview (pływający WebviewPanel) + 1-4 terminale CC (dolny dock panel). Każdy terminal to natywny `vscode.Terminal` w `TerminalLocation.Panel`; proces CC startuje przez prefiksowaną komendę shell (`CC_PANEL_TERMINAL_ID=<id> claude`), która wstrzykuje zmienną środowiskową czytaną przez hooki CC. Panel webview to jeden pasek kontrolek — user przeciąga zakładkę do dolnej grupy edytora lub poza VS Code (osobne okno), dzięki czemu Panel + Terminal widoczne jednocześnie.

## Osadzenie w VS Code (opcja B: floating WebviewPanel)
- Panel nie ma dedykowanego kontenera w `viewsContainers` — komenda `ccPanel.open` wywołuje `vscode.window.createWebviewPanel(viewType, title, ViewColumn.Beside, {retainContextWhenHidden: true, preserveFocus: true})`.
- Panel ląduje jako zakładka edytora **obok** aktywnego edytora (preserveFocus nie zabiera focusa z edytora).
- User jednorazowo przeciąga zakładkę "CC Panel" w dół (split editor group) albo poza okno VS Code (floating window). VS Code zapamiętuje layout dla workspace.
- `onDidDispose` zeruje referencję — kolejny `ccPanel.open` tworzy nowy panel na ViewColumn.Beside (user musi ponownie ułożyć, jeśli zamknął X-em).

## Panel layout (dwa wiersze)
```
[input (flex)][▶] │ [Esc][^C] │ [▼]      ← bar-top ~40px
[T1][T2][T3][T4] (każdy: id | folder | Ctx%)  ← bar-terms ~34px
```
- **input** — `<input type="text" list="cmd-list">`; Enter lub ▶ wysyła tekst do aktywnego terminala. `<datalist>` zawiera scaloną listę: slash commands (statyczne lub z `ustawienia.json`) + user commands + messages.
- **terminal chipy T1–T4** — kolorowane (teal/amber/purple/coral w CSS, ikony w VS Code przez `contributes.colors`); każdy chip zawiera: ID, basename folderu projektu (max 14 znaków), Ctx%; aktywny podświetlony tłem koloru; disabled (szary) → klik = addTerminal; pulsujący dot gdy `phase=working`; badge dot gdy nowa wiadomość od nieaktywnego.
- **Esc/^C** — surowe keystrokes (`\u001b`, `\u0003`) do aktywnego terminala.
- **▼/▲** — toggle dashboardu (persistencja w `vscode.getState()/setState()`).

## Dashboard (zaimplementowany, sesja 11)
Pod paskiem kontrolnym — rozwijaný przyciskiem `▼/▲` (stan persistowany w `vscode.getState()/setState()`):
```
┌─ CC Panel ─────────────────────────────────────────────┐
│ [pasek kontrolny ~40px]                                 │
│ [chipy T1-T4 z Ctx% ~34px]                             │
├────────────────────────────────────────────────────────┤
│          T1 (teal)  T2 (amber)  T3 (purple)  T4 (coral)│
│  Cost $   0.34        1.02         —             —      │
│  Total    24k         67k          —             —      │
├────────────────────────────────────────────────────────┤
│  💬 Ostatnia wiadomość (aktywny terminal)              │
└────────────────────────────────────────────────────────┘
```
- Kolumna aktywnego terminala ma podświetlone tło (`--accent 18%`).
- Last message: aktywny terminal; badge dot w prawym górnym rogu chipa gdy nieaktywny dostał nową wiadomość; clear po kliknięciu chipa.
- Pulsujący dot (lewy górny róg chipa) gdy `phase=working`.
- Ctx% widoczny bezpośrednio w chipach T1–T4 (kolor terminala, bold).

## Komendy VS Code (`contributes.commands`)

Wszystkie komendy zarejestrowane w `package.json` mają odpowiadający `registerCommand` w `extension.ts`.

| Komenda | Tytuł | Keybinding | Działanie |
|---------|-------|-----------|-----------|
| `ccPanel.open` | CC Panel: Open | – | Tworzy pływający `WebviewPanel` (`ViewColumn.Beside`) jeśli nie istnieje, lub go odkrywa (`reveal()`). Zapewnia, że terminal T1 istnieje i jest aktywny. |
| `ccPanel.addTerminal` | CC Panel: Add Terminal | – | Sprawdza który slot (T1–T4) jest wolny i wywołuje `addTerminal(nextFreeId)`. Jeśli wszystkie 4 działają — pokazuje `showInformationMessage`. |
| `ccPanel.cycleActive` | CC Panel: Cycle Active Terminal | `Ctrl+Alt+\`` | Przesuwa `activeTerminalId` do następnego działającego terminala w liście (cyklicznie). Używane gdy fokus jest poza chipami. |
| `ccPanel.selectTerminal1` | CC Panel: Select Terminal 1 | `Ctrl+Alt+1`, `F1` (fokus na panelu) | Ustawia T1 jako aktywny. Jeśli terminal nie istnieje — tworzy go przez `addTerminal(1)`. |
| `ccPanel.selectTerminal2` | CC Panel: Select Terminal 2 | `Ctrl+Alt+2`, `F2` (fokus na panelu) | Jak wyżej dla T2. |
| `ccPanel.selectTerminal3` | CC Panel: Select Terminal 3 | `Ctrl+Alt+3`, `F3` (fokus na panelu) | Jak wyżej dla T3. |
| `ccPanel.selectTerminal4` | CC Panel: Select Terminal 4 | `Ctrl+Alt+4`, `F4` (fokus na panelu) | Jak wyżej dla T4. |
| `ccPanel.editUserCommands` | CC Panel: Edit User Commands | – | Otwiera QuickPick wizard (`editUserLists.ts`) do edycji listy user commands w `ustawienia.json`. Zmiany zapisywane natychmiast; `UserListsStore` emituje `onChange` → webview dostaje `setUserLists`. |
| `ccPanel.editMessages` | CC Panel: Edit Messages | – | Analogicznie do `editUserCommands`, ale dla listy gotowych wiadomości (messages). |
| `ccPanel.reloadUserLists` | CC Panel: Reload ustawienia.json | – | Wymusza odczyt `ustawienia.json` z dysku (przydatne po ręcznej edycji pliku). |
| `ccPanel.installHooks` | CC Panel: Install Hooks | – | Wywołuje `installHooks(extensionUri)`: upsertuje `~/.claude/settings.json` wstawiając/aktualizując 3 hooki CC: `statusLine`, `UserPromptSubmit`, `Stop`. |
| `ccPanel.setProjectFolder` | CC Panel: Ustaw folder projektu | – | Pokazuje QuickPick z 4 slotami T1–T4 (z kolorami teal/amber/purple/coral i aktualną ścieżką). Po wyborze slotu otwiera `showOpenDialog` (folder picker). Zapisuje przez `userListsStore.saveProjectPath(id, path)`; webview natychmiast dostaje `setProjectPaths`. |
| `ccPanel.startAutoAccept` | CC Panel: Start Auto-Accept | `Ctrl+Alt+A` | 5-krokowy wizard QuickPick: terminal → czas → cost → iter → system prompt. Tworzy `AutoAcceptSession` z DI (TriggerDetector + HaikuHeadlessClient + writeToTerminal + TranscriptReader). Przy aktywnej sesji pyta o restart. |
| `ccPanel.stopAutoAccept` | CC Panel: Stop Auto-Accept | – | `autoAcceptSession.stop("user-stop")`. No-op gdy sesja nieaktywna. |
| `ccPanel.autoAcceptStatus` | CC Panel: Auto-Accept Status | – | `showInformationMessage` z `AutoAcceptStatus`: terminal, iter N/L, cost $X/$Y. |
| `ccPanel.showAutoAcceptHistory` | CC Panel: Auto-Accept History | – | QuickPick z 20 ostatnich sesji z `readRecentSessions()` (`~/.claude/cc-panel/aa-sessions.jsonl`). Pokazuje `sessionId` wybranej sesji. |
| `ccPanel.editAutoAcceptSystemPrompt` | CC Panel: Edit Auto-Accept System Prompt | – | InputBox do edycji `ccPanel.autoAcceptSystemPrompt` (workspace configuration, Global). |

## Components

- **extension.ts** — entry point; rejestracja **17 komend** (12 core + 5 AA); `writeAndWarn()`; `cycleActiveTerminal()`; `selectTerminal()`; `projectPathFor(id)`; forward `StateWatcher.onChange` → `PanelManager.setDashboard`; `startAutoAccept()` orchestrator; `toAutoAcceptDTO()` mapper; dispose w kolejności `autoAcceptSession → stateWatcher → panelManager → terminalManager`

- **PanelManager** — `vscode.window.createWebviewPanel` z `ViewColumn.Beside + preserveFocus`; `broadcastInit()` przy `ready`; routing wszystkich inbound messages; `setSlashCommands()` postuje do webview gdy panel otwarty; `onDidDispose` → zerowanie `this.panel`. `renderHtml()` dopisuje `?v=<Date.now()>` do URIs `styles.css`/`main.js` — cache-bust przeciw agresywnemu webview cache przy `retainContextWhenHidden:true`

- **TerminalManager** — spawn CC przez `Pseudoterminal` + node-pty:
  - `open(initialDimensions)`: jeśli wymiary znane → spawn natychmiast; jeśli nie → fallback timer 300ms
  - `setDimensions(dim)`: przy pierwszym wywołaniu = spawn z prawdziwymi wymiarami; przy kolejnych = resize
  - `spawnDone` flag: jeden spawn na cykl życia terminala
  - Błąd spawnu: wypisywany czerwonym tekstem w terminalu
  - Windows: `cmd.exe /k <command>` — cmd pozostaje po zakończeniu CC
  - `env.COLUMNS`/`env.LINES` ustawiane przed spawnem
  - `env.CC_PANEL_TERMINAL_ID` (1-4) — identyfikacja terminala w hookach

- **UserListsStore** — `~/.claude/cc-panel/ustawienia.json`; user commands + messages + `projectPaths[T1-T4]`. Metoda `saveProjectPath(id, path)` zapisuje konkretny slot. Migracja legacy `projectPath` → slot T1 przy pierwszym odczycie.

- **slashCommands.ts** — 35 statycznych slash commands CC; `/color` jako 5 wariantów (`cyan`/`orange`/`purple`/`pink`/`random`) — nazwy z puli CC CLI, mapowane do kolorystyki T1–T4

- **hooks/statusline.js** — chain-capable; czyta stdin (payload CC), kalkuluje ctx_pct (token_usage / 200k), merge z poprzednim state (zachowuje phase, last_message), zapisuje `~/.claude/cc-panel/state.{id}.json`; jeśli `chain.json` → forwarduje stdin do usera statusLine
- **hooks/userpromptsubmit.js** — ustawia `phase=working` + zapisuje `transcript_path` w state.json
- **hooks/stop.js** — ustawia `phase=waiting`, wyciąga `last_message` z transcript JSONL (ostatni assistant message, max 500 znaków), zapisuje w state.json

## Data flow — wysyłka komendy
```
INPUT (tekst lub wybór z datalist):
  user wpisuje lub wybiera z datalist → Enter lub klik ▶ → sendRaw{text + "\r"}
  → extension.ts writeAndWarn(text + "\r") → pty.write do aktywnego terminala

KEYSTROKES:
  klik Esc  → sendKeystroke{name:"esc"}   → "\u001b"   → pty.write
  klik ^C   → sendKeystroke{name:"ctrlC"} → "\u0003"   → pty.write

TERMINAL SELECTION:
  klik chip (enabled)  → selectTerminal{id} → extension.ts setActive(id) + terminal.show()
  klik chip (disabled) → addTerminal{id}    → extension.ts terminalManager.create(id) + show()
```

## Data flow — state.json (dashboard)
```
CC emituje statusline → hook statusline.js czyta stdin (payload JSON)
  → wyciąga: model, cost_usd, ctx_pct (token_usage / 200k)
  → merge z poprzednim state (phase, last_message)
  → zapis ~/.claude/cc-panel/state.{id}.json

CC kończy turę → hook stop.js:
  → czyta transcript_path z payload
  → parsuje ostatni assistant message z JSONL
  → zapisuje last_message (max 500 znaków) + phase=waiting do state.json

StateWatcher (src/state/StateWatcher.ts):
  chokidar na ~/.claude/cc-panel/state.*.json + dynamiczny watcher na transcript JSONL
  → debounce 150ms (atomowy zapis fs.writeFile triggeruje 2-3× emit)
  → TranscriptReader: tail read z cache incremental, parse cost/total z JSONL
  → merge w Map<TerminalId, TerminalDashboardSnapshot>
  → event emitter → extension.ts toDashboardDTO() → PanelManager.setDashboard()
  → webview renderuje tabelkę 4×2 (Cost/Total) + last_message aktywnego terminala
```

## Auto-Accept (zaimplementowany, sesje 17-22)

Headless Haiku wypełnia pole "czy kontynuować?" w imieniu usera — trigger na krawędzi `working→waiting`, odpowiedź wysyłana jako raw text do aktywnego terminala. Pełny plan: `docs/AUTO_ACCEPT_PLAN.md`.

**Single-active globalnie (D2):** jedna sesja AA naraz, niezależnie ile terminali działa.

### Pipeline

```
StateWatcher.onChange (DashboardMap)
  ↓  (filtruje activeTerminalId)
TriggerDetector (debounce 3s)
  ↓  onTrigger({terminalId, timestamp, reactionMs})
AutoAcceptSession.handleTrigger()
  ├─ BudgetEnforcer.check(now) → time-limit | iter-limit | cost-limit
  ├─ TranscriptReader.readRecentMessages(limit=5)
  ├─ buildPromptWithContext(metaPrompt, recent) → preamble + role-labeled snippets + separator + meta
  ├─ HaikuHeadlessClient.invokeHaiku({prompt, signal, timeoutMs})
  │     (claude -p --output-format json --model haiku)
  ├─ CircuitBreaker.analyze(response) → similarity≥0.80 OR idle-length±10%
  │     (sliding window ostatnich 3 odpowiedzi)
  ├─ writeToTerminal(id, result + "\r")
  └─ SessionLogger.logHaikuResponse() / logSendToTerminal()
```

Emituje `onStatus(AutoAcceptStatus)` po każdej zmianie — extension forwarduje do PanelManager, ten wysyła do webview jako `AutoAcceptStatusDTO`.

### DI pattern

`AutoAcceptSession` przyjmuje `AutoAcceptDeps`:
- `triggerDetector: TriggerDetector` — emituje krawędzie working→waiting
- `haikuClient: { invokeHaiku(...) }` — abstrakcja nad `HaikuHeadlessClient`
- `writeToTerminal(id, text): boolean` — `terminalManager.write`; fail → `stop("cli-errors")`
- `getRecentMessages(id, limit): Promise<Message[]>` — `TranscriptReader.readRecentMessages` via `stateWatcher.getTranscriptPath(id)`

Testowalność: smoke testy w sesji 20 (33 asercje) z fake'ami trigger/haiku/write/getRecent.

### Stop reasons

`AutoAcceptStopReason = "user-stop" | "time-limit" | "iter-limit" | "cost-limit" | "circuit-breaker" | "cli-errors" | "panel-dispose"`

- **user-stop** — komenda `ccPanel.stopAutoAccept` lub Stop button w webview banner
- **time/iter/cost-limit** — BudgetEnforcer.check przed i po iteracji
- **circuit-breaker** — pętla wykryta (3× podobna odpowiedź lub 3× ta sama długość)
- **cli-errors** — 3× kolejny exit!=0 z Haiku LUB `writeToTerminal returns false`
- **panel-dispose** — deactivate() lub dispose

### Webview banner

Cienki pasek ~26px pod `bar-top` (nad `bar-terms`):
```
● AA T3 · iter 7/50 · $0.51/$5.00 · time 12m30s · [Stop]
```
- `data-state="active"` — pulsujący żółty dot, tło `#fbbf24 14%`
- `data-state="stopped"` — szary dot, auto-hide po 5s (`aaHideTimer`)
- Countdown liczony **lokalnie w webview** (interval 1s) — extension pushuje status tylko przy zmianie stanu
- Kolor `T#` badge zgodny z AA terminalem (nie aktywnym chipem panelu) — przez fallback `var(--t-color, var(--accent))` i klasę `chip-t1..4` dodawaną w JS
- Stop button → `postMessage({type:"stopAutoAccept"})` → `autoAcceptSession.stop("user-stop")`

### Logowanie (`~/.claude/cc-panel/aa-sessions.jsonl`)

Append-only JSONL. 7 typów eventów (discriminated union):
- `session-start` — config, sessionId, terminalId
- `trigger` — krawędź wykryta, reactionMs
- `haiku-response` — result, costUsd, durationMs, iterationIdx
- `haiku-error` — exitCode, stderr, iterationIdx
- `send-to-terminal` — text (skrócony do 200 zn.)
- `write-failure` — writeToTerminal zwróciło false (dedykowany event, nie recyklowany haiku-error)
- `session-stop` — stopReason, finalCostUsd, totalIterations

`readRecentSessions(limit=20)` zwraca ostatnie starty do QuickPick'a historii.

## Key files
```
src/
  extension.ts              routing, 17 komend, writeAndWarn, cycleActive, startAutoAccept, toAutoAcceptDTO
  panel/
    PanelManager.ts         createWebviewPanel(ViewColumn.Beside), broadcastInit, routing, setAutoAccept
    messages.ts             TS types + AutoAcceptStatusDTO + setAutoAccept/stopAutoAccept
  terminals/
    TerminalManager.ts      lazy spawn z fallback, /k na Windows, spawnDone flag, env CC_PANEL_TERMINAL_ID
  settings/
    slashCommands.ts        35 slash commands (statyczne; /color jako 5 wariantów: cyan/orange/purple/pink/random — mapowane do kolorów T1-T4)
    UserListsStore.ts       ustawienia.json R/W
    editUserLists.ts        QuickPick wizard
  hooks/
    installHooks.ts         upsert ~/.claude/settings.json (statusLine + UserPromptSubmit + Stop)
  state/
    StateWatcher.ts         chokidar na state.*.json + transcript JSONL, event emitter, getTranscriptPath(id)
    TranscriptReader.ts     tail read JSONL z cache incremental, parse cost/total, readRecentMessages(limit)
  auto-accept/
    types.ts                AutoAcceptConfig/Status/StopReason, HaikuResponse, IterationRecord
    HaikuHeadlessClient.ts  invokeHaiku(), resolveClaudePath(), Windows CVE workaround
    TriggerDetector.ts      subskrybuje StateWatcher, emit TriggerEvent (working→waiting, debounce 3s)
    BudgetEnforcer.ts       pure logic: time/iter/cost limity (null = unlimited)
    CircuitBreaker.ts       sliding window 3 odp.: similarity≥0.80 + idle-length±10%
    SessionLogger.ts        append-only JSONL, 7 typów eventów, readRecentSessions(20)
    AutoAcceptSession.ts    orkiestrator z DI, busy-skip, 3× error → stop, restart z dispose
    startWizard.ts          5-krokowy QuickPick (terminal/time/cost/iter/prompt)
resources/
  webview/
    index.html              bar-top + aa-banner + bar-terms (chipy T1-T4) + section.dashboard
    styles.css              frame/bar layout, chip-term-wide, dashboard, last-message, aa-banner, CC pulse
    main.js                 applyAutoAccept, startAaClock/stopAaClock, aaHideTimer (auto-hide 5s), renderDashboard
  hooks/
    statusline.js           chain-capable, liczy ctx_pct, zapisuje state.{id}.json
    userpromptsubmit.js     phase=working + transcript_path
    stop.js                 phase=waiting + last_message (z transcript JSONL)
```

## Decisions
- **Opcja B (floating WebviewPanel)** zamiast WebviewView w kontenerze: pozwala na osobne okno (drag tab poza VS Code) i dowolne ułożenie obok terminala — jedyny sposób, żeby Panel i Terminal były widoczne jednocześnie bez kompromisu w szerokości terminala.
- `cmd.exe /k` zamiast `/c` na Windows: CC może skończyć działanie (błąd, restart) bez zamykania terminala VS Code.
- Lazy spawn z fallback 300ms: rozwiązuje "zjazd" i czarny ekran — CC dostaje prawdziwe wymiary terminala przy starcie.
- `spawnDone` flag: zapobiega podwójnemu spawnowi gdy `open()` + `setDimensions()` są oba obecne.
- Dwa wiersze (bar-top + bar-terms): pasek kontrolny ~40px + wiersz chipów ~34px. Dashboard zwijany pod spodem — maksimum przestrzeni dla terminali CC gdy zwinięty.
- Jeden `<datalist>` z całą listą (slash + user commands + messages) zamiast trybów: prostszy model mentalny, mniej elementów UI.
- **Źródło prawdy metryk: statusline hook CC, NIE parsowanie ANSI z terminala** (zabronione — niestabilne i łamie chain-capable hook).
- **state.{id}.json** jako single source of truth dla webview: chain-capable hook + atomowy zapis + chokidar watcher.

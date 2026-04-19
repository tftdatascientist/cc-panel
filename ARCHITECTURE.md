## Overview
Ekstensja VS Code renderuje cienki panel webview (pływający WebviewPanel) + 1-4 terminale CC (dolny dock panel). Każdy terminal spawnowany przez node-pty z unikalnym `CC_PANEL_TERMINAL_ID`. Panel webview to jeden pasek kontrolek — user przeciąga zakładkę do dolnej grupy edytora lub poza VS Code (osobne okno), dzięki czemu Panel + Terminal widoczne jednocześnie.

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

## Components

- **extension.ts** — entry point; rejestracja 12 komend; `writeAndWarn()`; `cycleActiveTerminal()`; `selectTerminal()`; `projectPathFor(id)`; forward `StateWatcher.onChange` → `PanelManager.setDashboard`

- **PanelManager** — `vscode.window.createWebviewPanel` z `ViewColumn.Beside + preserveFocus`; `broadcastInit()` przy `ready`; routing wszystkich inbound messages; `setSlashCommands()` postuje do webview gdy panel otwarty; `onDidDispose` → zerowanie `this.panel`

- **TerminalManager** — spawn CC przez `Pseudoterminal` + node-pty:
  - `open(initialDimensions)`: jeśli wymiary znane → spawn natychmiast; jeśli nie → fallback timer 300ms
  - `setDimensions(dim)`: przy pierwszym wywołaniu = spawn z prawdziwymi wymiarami; przy kolejnych = resize
  - `spawnDone` flag: jeden spawn na cykl życia terminala
  - Błąd spawnu: wypisywany czerwonym tekstem w terminalu
  - Windows: `cmd.exe /k <command>` — cmd pozostaje po zakończeniu CC
  - `env.COLUMNS`/`env.LINES` ustawiane przed spawnem
  - `env.CC_PANEL_TERMINAL_ID` (1-4) — identyfikacja terminala w hookach

- **UserListsStore** — `~/.claude/cc-panel/ustawienia.json`; user commands + messages + `projectPaths[T1-T4]`. Metoda `saveProjectPath(id, path)` zapisuje konkretny slot. Migracja legacy `projectPath` → slot T1 przy pierwszym odczycie.

- **slashCommands.ts** — 34 statyczne slash commands CC; `/color` jako 5 wariantów (`cyan`/`orange`/`purple`/`pink`/`random`) — nazwy z puli CC CLI, mapowane do kolorystyki T1–T4

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

## Key files
```
src/
  extension.ts              routing, komendy, writeAndWarn, cycleActive
  panel/
    PanelManager.ts         createWebviewPanel(ViewColumn.Beside), broadcastInit, routing
    messages.ts             TS types dla inbound/outbound message
  terminals/
    TerminalManager.ts      lazy spawn z fallback, /k na Windows, spawnDone flag, env CC_PANEL_TERMINAL_ID
  settings/
    slashCommands.ts        34 slash commands (statyczne; /color jako 5 wariantów: cyan/orange/purple/pink/random — mapowane do kolorów T1-T4)
    UserListsStore.ts       ustawienia.json R/W
    editUserLists.ts        QuickPick wizard
  hooks/
    installHooks.ts         upsert ~/.claude/settings.json (statusLine + UserPromptSubmit + Stop)
  state/
    StateWatcher.ts         chokidar na state.*.json + transcript JSONL, event emitter
    TranscriptReader.ts     tail read JSONL z cache incremental, parse cost/total tokenów
resources/
  webview/
    index.html              bar-top (input+send+keystrokes+toggle) + bar-terms (chipy T1-T4) + section.dashboard
    styles.css              frame/bar layout, chip-term-wide, dashboard/dash-table, last-message, CC pulse animation
    main.js                 refreshAllItems(), renderDashboard(), applyDashboard(), renderFolders(), setActive()
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

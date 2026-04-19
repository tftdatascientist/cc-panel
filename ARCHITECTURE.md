## Overview
Ekstensja VS Code renderuje cienki panel webview (pływający WebviewPanel) + 1-4 terminale CC (dolny dock panel). Każdy terminal spawnowany przez node-pty z unikalnym `CC_PANEL_TERMINAL_ID`. Panel webview to jeden pasek kontrolek — user przeciąga zakładkę do dolnej grupy edytora lub poza VS Code (osobne okno), dzięki czemu Panel + Terminal widoczne jednocześnie.

## Osadzenie w VS Code (opcja B: floating WebviewPanel)
- Panel nie ma dedykowanego kontenera w `viewsContainers` — komenda `ccPanel.open` wywołuje `vscode.window.createWebviewPanel(viewType, title, ViewColumn.Beside, {retainContextWhenHidden: true, preserveFocus: true})`.
- Panel ląduje jako zakładka edytora **obok** aktywnego edytora (preserveFocus nie zabiera focusa z edytora).
- User jednorazowo przeciąga zakładkę "CC Panel" w dół (split editor group) albo poza okno VS Code (floating window). VS Code zapamiętuje layout dla workspace.
- `onDidDispose` zeruje referencję — kolejny `ccPanel.open` tworzy nowy panel na ViewColumn.Beside (user musi ponownie ułożyć, jeśli zamknął X-em).

## Panel layout (jeden pasek ≤50px)
```
[input 280px][▶] │ [cmd][user][text] │ [1][2][3][4] │ [Esc][^C]
```
- **input** — wpisywanie tekstu z `<datalist>`; Enter = wyślij. W trybach cmd/user input służy jako opcjonalny suffix do komendy (np. wybór `/model` + wpisanie ` opus` wysyła `/model opus`).
- **tryb** — chip-radio: cmd/user/text; decyduje co jest w datalist i jak interpretowany jest tekst
- **terminal 1-4** — kolorowane chipy (teal/amber/purple/coral); aktywny podświetlony; disabled (szary) → klik = addTerminal
- **Esc/^C** — surowe keystrokes do aktywnego terminala

## Planowany dashboard (Session 11, nie zaimplementowany)
Pod paskiem kontrolnym, tylko gdy okno pływa i ma >150px wysokości:
```
┌─ CC Panel ─────────────────────────────────────────────┐
│ [pasek kontrolny - jak wyżej, ~50px]                   │
├────────────────────────────────────────────────────────┤
│          T1 (teal)  T2 (amber)  T3 (purple)  T4 (coral)│
│  Ctx %    12%         34%          —             —      │
│  Sess %   23%         45%          —             —      │
│  Time     1:07        2:15         —             —      │
│  Cost $   0.34        1.02         —             —      │
│  Week %   27%                                           │  (współdzielone, 1 wartość)
│  Total    24k         67k          —             —      │
├────────────────────────────────────────────────────────┤
│  💬 T1 last: "Pasek wygląda tak samo jak dotychczas..."│
└────────────────────────────────────────────────────────┘
```
- Kolumna aktywnego terminala ma podświetlone tło kolorem terminala.
- Last message: tylko aktywny terminal; badge "🔴" na chipie nieaktywnego terminala gdy dostał nową wiadomość.
- Toggle dashboardu — przycisk zwijania z persistencją w `vscode.workspaceState`.

## Components

- **extension.ts** — entry point; rejestracja 11 komend; `writeAndWarn()`; `cycleActiveTerminal()`; `selectTerminal()`

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

- **slashCommands.ts** — 29 statycznych slash commands CC

- **hooks/statusline.js** — chain-capable; czyta stdin (payload CC), kalkuluje ctx_pct (token_usage / 200k), merge z poprzednim state (zachowuje phase, last_message), zapisuje `~/.claude/cc-panel/state.{id}.json`; jeśli `chain.json` → forwarduje stdin do usera statusLine
- **hooks/userpromptsubmit.js** — ustawia `phase=working` + zapisuje `transcript_path` w state.json
- **hooks/stop.js** — ustawia `phase=waiting`, wyciąga `last_message` z transcript JSONL (ostatni assistant message, max 500 znaków), zapisuje w state.json

## Data flow — wysyłka komendy
```
TRYB INPUT (tekst):
  user wpisuje → Enter → sendRaw{text}
  → extension.ts writeAndWarn(text + "\r") → pty.write do aktywnego terminala

TRYB CMD/USER (komenda z dropdown):
  user wybiera z datalist → opcjonalnie wpisuje suffix w input → Enter/▶
  → extension.ts sendRaw(item.value + " " + extra + "\r") → pty.write

KEYSTROKES:
  klik Esc/^C → sendKeystroke{name} → KEYSTROKES[name] → pty.write raw bytes
```

## Data flow — state.json (planowany dashboard)
```
CC emituje statusline → hook statusline.js czyta stdin (payload JSON)
  → wyciąga: model, cost_usd, ctx_pct (+ planowane: session_pct, session_time, weekly_pct, total_tokens)
  → merge z poprzednim state (phase, last_message)
  → zapis ~/.claude/cc-panel/state.{id}.json

CC kończy turę → hook stop.js:
  → czyta transcript_path z payload
  → parsuje ostatni assistant message z JSONL
  → zapisuje last_message (max 500 znaków) + phase=waiting do state.json

[PLANOWANE] StateWatcher (src/state/StateWatcher.ts):
  chokidar na ~/.claude/cc-panel/state.*.json
  → debounce 150ms (atomowy zapis fs.writeFile triggeruje 2-3× emit)
  → merge w Map<TerminalId, TerminalState>
  → event emitter → PanelManager.setDashboard({1: {...}, 2: {...}, ...})
  → webview renderuje tabelkę 4×6 + last_message aktywnego terminala
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
    slashCommands.ts        29 slash commands (statyczne)
    UserListsStore.ts       ustawienia.json R/W
    editUserLists.ts        QuickPick wizard
  hooks/
    installHooks.ts         upsert ~/.claude/settings.json (statusLine + UserPromptSubmit + Stop)
  state/                    [PLANOWANE Session 11]
    StateWatcher.ts         chokidar na state.*.json, event emitter
resources/
  webview/
    index.html              jeden .bar z wszystkimi kontrolkami
    styles.css              .frame max-height 50px, .chip-group, .sep, kolory terminali
    main.js                 tryby cmd/user/text, rebuildDrop(), setMode(), setActive()
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
- Jeden pasek ≤50px: maksymalna przestrzeń dla terminali CC, dashboard dobudowany pod spodem tylko gdy okno pływa i ma miejsce.
- Tryby cmd/user/text zamiast 3 oddzielnych dropdownów: jeden dropdown (datalist), kontekst zależy od trybu.
- Opcjonalny suffix inputu do komendy: `/model` + ` opus` z pola tekstowego.
- **Źródło prawdy metryk: statusline hook CC, NIE parsowanie ANSI z terminala** (zabronione — niestabilne i łamie chain-capable hook).
- **state.{id}.json** jako single source of truth dla webview: chain-capable hook + atomowy zapis + chokidar watcher.

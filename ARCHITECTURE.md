## Overview
Ekstensja VS Code renderuje cienki panel webview (≤100px, górna część editor group) + 1-4 terminale CC (dolna część, split). Każdy terminal spawnowany przez node-pty z unikalnym `CC_PANEL_TERMINAL_ID`. Panel to jeden pasek kontrolek: input tekstowy, dropdown zależny od trybu, chipy trybu/terminala/modyfikatorów, keystrokes.

## Panel layout (jeden pasek ≤100px)
```
[input 22%] [dropdown] [▶] │ [cmd][user][text][input] │ [1][2][3][4] │ [model][effort][think][plan] │ [Esc][^C][⇧Tab]
```
- **input** — wpisywanie tekstu; Enter = wyślij (z modyfikatorami w trybie `input`; jako opcjonalny suffix do komendy w trybach cmd/user)
- **dropdown** — slash commands (cmd) / user commands (user) / gotowe messages (text) / ukryty (input)
- **tryb** — chip-radio: cmd/user/text/input; decyduje co jest w dropdownie i jak wysyłamy
- **terminal 1-4** — kolorowane chipy (teal/amber/purple/coral); aktywny podświetlony; disabled (szary) → klik = addTerminal
- **model** — default/opus/sonnet/haiku → `/model X\r` przed wiadomością
- **effort** — low/mid/hard/max → `/effort X\r` przed wiadomością
- **think** — "think"/"think harder" → prefix do tekstu wiadomości
- **plan** — checkbox → ⇧Tab×2 przed wiadomością (przełącza CC w plan mode)
- **Esc/^C/⇧Tab** — surowe keystrokes do aktywnego terminala

## Components

- **extension.ts** — entry point; rejestracja 11 komend; `writeAndWarn()`, `sendInputWithModifiers()` (kolejność: plan→model→effort→think+tekst); `cycleActiveTerminal()`; `selectTerminal()`

- **PanelManager** — `WebviewPanel` w `ViewColumn.One`; `broadcastInit()` przy `ready`; routing wszystkich inbound messages; `setSlashCommands()` postuje do webview gdy panel otwarty

- **TerminalManager** — spawn CC przez `Pseudoterminal` + node-pty:
  - `open(initialDimensions)`: jeśli wymiary znane → spawn natychmiast; jeśli nie → fallback timer 300ms
  - `setDimensions(dim)`: przy pierwszym wywołaniu = spawn z prawdziwymi wymiarami; przy kolejnych = resize
  - `spawnDone` flag: jeden spawn na cykl życia terminala
  - Błąd spawnu: wypisywany czerwonym tekstem w terminalu
  - Windows: `cmd.exe /k <command>` — cmd pozostaje po zakończeniu CC
  - `env.COLUMNS`/`env.LINES` ustawiane przed spawnem

- **UserListsStore** — `~/.claude/cc-panel/ustawienia.json`; user commands + messages

- **slashCommands.ts** — 29 statycznych slash commands CC

- **hooks/statusline.js** — chain-capable; kalkuluje ctx_pct; zapisuje state.{id}.json

## Data flow (tryb input)
```
user wpisuje → Enter → sendInput{text, model, effort, think, plan}
→ sendInputWithModifiers():
    plan   → ⇧Tab+⇧Tab → sleep 60ms
    model  → /model X\r → sleep 120ms
    effort → /effort X\r → sleep 120ms
    think  → prefix "think: " lub "think harder: "
    → tekst + \r → pty.write
```

## Data flow (tryb cmd/user)
```
user wybiera z dropdown → opcjonalnie wpisuje suffix w input → Enter/▶
→ sendSlash/sendUserCommand{index, extra}
→ extension: item.value + (extra ? " "+extra : "") + \r → pty.write
```

## Key files
```
src/
  extension.ts              routing, sendInputWithModifiers, cycleActive
  panel/
    PanelManager.ts         WebviewPanel, broadcastInit, message routing
    messages.ts             TS types: SendInputOptions{text,model,effort,think,plan}
  terminals/
    TerminalManager.ts      lazy spawn z fallback, /k na Windows, spawnDone flag
  settings/
    slashCommands.ts        29 slash commands (statyczne)
    UserListsStore.ts       ustawienia.json R/W
    editUserLists.ts        QuickPick wizard
  hooks/
    installHooks.ts         upsert ~/.claude/settings.json
resources/
  webview/
    index.html              jeden .bar z wszystkimi kontrolkami
    styles.css              .frame max-height 100px, .chip-group, .sel-sm
    main.js                 tryby cmd/user/text/input, rebuildDrop(), setMode()
  hooks/
    statusline.js           chain-capable hook
    userpromptsubmit.js     phase=working
    stop.js                 phase=waiting + last_message
```

## Decisions
- `/k` zamiast `/c` na Windows: CC może skończyć działanie (błąd, restart) bez zamykania terminala VS Code
- Lazy spawn z fallback 300ms: rozwiązuje "zjazd" i czarny ekran — CC dostaje prawdziwe wymiary terminala przy starcie
- `spawnDone` flag: zapobiega podwójnemu spawnowi gdy `open()` + `setDimensions()` są oba obecne
- Jeden pasek ≤100px: maksymalna przestrzeń dla terminali CC
- Tryby cmd/user/text/input zamiast 3 oddzielnych dropdownów: jeden dropdown, kontekst zależy od trybu
- `effort` i `think` jako osobne selekty (nie checkboxy): effort ma 4 wartości, think ma 2 + brak
- Opcjonalny suffix inputu do komendy: `/model` + ` opus` z pola tekstowego

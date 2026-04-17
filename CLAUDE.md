<!-- CLAUDE v1.0 -->

# cc-panel

Rozszerzenie VS Code do równoległej obsługi 1-4 sesji Claude Code z graficznego panelu sterowania w obszarze edytora.

@STATUS.md
@ARCHITECTURE.md

## Project
<!-- SECTION:project -->
- name: cc-panel
- type: VS Code extension
- client: własny
<!-- /SECTION:project -->

## Stack
<!-- SECTION:stack -->
- TypeScript 5.x
- VS Code Extension API (min. 1.85)
- node-pty: spawnowanie CC z kontrolą PTY I/O
- Webview API: panel w obszarze edytora
- chokidar: obserwacja plików stanu z CC hooks
- esbuild: bundling
<!-- /SECTION:stack -->

## Key Files
<!-- SECTION:key_files -->
- package.json: manifest + contributions (commands, configuration, keybindings)
- src/extension.ts: entry point, activate/deactivate
- src/panel/: PanelManager i kod webview (layout trzyrzędowy + ramka aktywnego)
- src/terminals/: spawn i cykl życia 1-4 terminali CC
- src/state/: fs.watch na plikach stanu z CC hooks
- src/buttons/: akcje sendText/keystroke na aktywnym terminalu
- resources/hooks/: statusline.sh, userpromptsubmit.sh, stop.sh
- resources/default-buttons.json: domyślny zestaw przycisków MVP
<!-- /SECTION:key_files -->

## Specifics
<!-- SECTION:specifics -->
- CC ZAWSZE spawnowany przez ekstensję (nigdy attach do istniejącego terminala) — potrzebna kontrola env i PTY I/O
- Identyfikacja terminala: env CC_PANEL_TERMINAL_ID=1..4 przekazywane do CC i czytane przez wszystkie hooki
- Źródło prawdy metryk (Ctx%, cost, model, mode, session%): statusLine hook CC. Parsowanie ANSI z terminala ZABRONIONE
- Layout webview sztywny: 20% górny rząd (4 status tiles) / 60% środek (buttons | messages) / 20% dolny rząd (4 info bars); wszystkie rzędy full-width
- Przyciski WSPÓLNE dla wszystkich terminali, sterują aktualnie aktywnym. MVP: tylko typy sendText i keystroke
- Ramka aktywnego terminala: 4 kolory (T1=teal, T2=amber, T3=purple, T4=coral), obejmuje cały panel
- Tab koliduje z terminal completion — przełączanie terminali przez komendę ccPanel.cycleActive (user bind w keybindings.json)
- Webview: vanilla HTML/CSS/JS bez frameworka (MVP) — mały bundle, prostota debugowania
- Konfiguracja przycisków w vscode.workspace.getConfiguration('ccPanel.buttons') — idzie z settings sync
<!-- /SECTION:specifics -->

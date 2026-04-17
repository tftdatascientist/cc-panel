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
- src/buttons/: Actions (sendText/keystroke/vsCodeCommand), ButtonStore (load/save), EditButton (wizard QuickPick/InputBox)
- resources/hooks/: statusline.js (liczy ctx_pct), userpromptsubmit.js, stop.js
- resources/default-buttons.json: domyślny zestaw przycisków MVP
<!-- /SECTION:key_files -->

## Specifics
<!-- SECTION:specifics -->
- CC ZAWSZE spawnowany przez ekstensję (nigdy attach do istniejącego terminala) — potrzebna kontrola env i PTY I/O
- Identyfikacja terminala: env CC_PANEL_TERMINAL_ID=1..4 przekazywane do CC i czytane przez wszystkie hooki
- Źródło prawdy metryk (Ctx%, cost, model, mode, session%): statusLine hook CC. Parsowanie ANSI z terminala ZABRONIONE
- Layout webview sztywny: 20% górny rząd (4 status tiles) / 60% środek (buttons | messages) / 20% dolny rząd (4 info bars); wszystkie rzędy full-width
- Przyciski WSPÓLNE dla wszystkich terminali, sterują aktualnie aktywnym. Typy akcji: sendText (pty.write + \r), keystroke (pty.write raw — Esc/Ctrl+C/Shift+Tab), vsCodeCommand (vscode.commands.executeCommand)
- Ramka aktywnego terminala: 4 kolory (T1=teal, T2=amber, T3=purple, T4=coral), obejmuje cały panel
- Tab koliduje z terminal completion — przełączanie terminali przez komendę ccPanel.cycleActive, keybinding contribution w package.json (default Ctrl+Alt+Tab)
- ctx≥70% → klasa is-ctx-warn na tile (czerwony border + bg 12% red), ortogonalna do phase; ctx_pct liczone w statusline.js (limit 200k — wszystkie Claude 4.x)
- Webview: vanilla HTML/CSS/JS bez frameworka — mały bundle; edycja przycisków przez natywne VS Code QuickPick/InputBox (nie custom modal)
- Konfiguracja przycisków w vscode.workspace.getConfiguration('ccPanel.buttons') — Global (Settings Sync) lub Workspace (.vscode/settings.json), target wybierany w wizardzie EditButton
<!-- /SECTION:specifics -->

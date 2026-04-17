<!-- ARCHITECTURE v1.0 -->

## Overview
<!-- SECTION:overview -->
Ekstensja VS Code renderuje dwuwarstwowy układ w obszarze edytora: webview panel sterujący (górna połowa editor group) + 1-4 terminale z Claude Code (dolna połowa, split). Ekstensja spawnuje każdą instancję CC przez node-pty nadając jej unikalny CC_PANEL_TERMINAL_ID w env. CC emituje swój stan przez natywne hooki (statusLine, UserPromptSubmit, Stop), które zapisują JSON do plików per-terminal w ~/.claude/cc-panel/; ekstensja obserwuje katalog przez chokidar i przekazuje zmiany do webview. Akcje użytkownika (kliknięcie przycisku, przełączenie terminala) wracają z webview do ekstensji przez postMessage i są realizowane jako pty.write na aktywnym terminalu lub jako komenda VS Code.
<!-- /SECTION:overview -->

## Components
<!-- SECTION:components -->
- extension.ts: entry point, rejestracja komend (ccPanel.open, ccPanel.cycleActive, ccPanel.editButton), aktywacja panelu
- PanelManager: tworzy/trzyma WebviewPanel w ViewColumn.One, inicjuje split pionowy (panel nad terminalami), agreguje stan z terminalManager i stateWatcher, pushuje do webview przez postMessage
- webview (HTML/CSS/JS vanilla): trzy rzędy — górny (4 status tiles z kolorem working/waiting/red i timerem), środek (left: button grid, right: messages feed), dolny (4 info bars z metrykami CC); zewnętrzna ramka w kolorze aktywnego terminala
- TerminalManager: mapa id→{pty, state, created}, spawn CC przez Pseudoterminal + node-pty z env CC_PANEL_TERMINAL_ID, zarządza aktywnym terminalem, focus API
- StateWatcher: chokidar na ~/.claude/cc-panel/state.*.json → emit change → PanelManager → webview
- MessageBus: subskrypcja hook eventów (working/waiting) + messages feed (zapis wiadomości CC po Stop)
- ButtonStore: odczyt workspace.getConfiguration('ccPanel.buttons'), fallback do resources/default-buttons.json, walidacja schematu (label, type, value, icon?)
- Actions: executor akcji — sendText (pty.write(value + '\r')), keystroke (pty.write(escape sequence)); działa na TerminalManager.activeId
- resources/hooks/statusline.sh: CC uruchamia dla każdej aktualizacji status line — czyta JSON ze stdin + env CC_PANEL_TERMINAL_ID, zapisuje ~/.claude/cc-panel/state.{id}.json, wypluwa tekst status line na stdout (CC go renderuje w terminalu)
- resources/hooks/userpromptsubmit.sh, stop.sh: aktualizują pole phase w state.{id}.json (working/waiting) i timestamp phase_changed
<!-- /SECTION:components -->

## Data Flow
<!-- SECTION:data_flow -->
User action (click/keybind) → webview postMessage → PanelManager → Actions.execute(activeId) → pty.write → CC
CC output (tool use, text) → pty → xterm w editor group (widoczne)
CC statusLine tick → statusline.sh → write state.{id}.json → chokidar event → PanelManager → webview postMessage → render info bars + status tiles
CC UserPromptSubmit → userpromptsubmit.sh → state.{id}.json phase=working, timer reset → chokidar → webview → zielony status tile + timer rośnie
CC Stop → stop.sh → state.{id}.json phase=waiting + ostatnia wiadomość → chokidar → webview → żółty status tile + messages feed update
User Tab/ccPanel.cycleActive → TerminalManager.setActive(next) → PanelManager broadcast → webview → zmiana koloru ramki + highlight aktywnego kafelka
<!-- /SECTION:data_flow -->

## Decisions
<!-- SECTION:decisions -->
- Spawn CC przez ekstensję (nie attach): jedyny sposób zapewnienia env CC_PANEL_TERMINAL_ID i kontroli PTY I/O
- statusLine hook jako źródło metryk (nie parsowanie ANSI): deterministyczne, odporne na kosmetyczne zmiany CC
- Per-terminal plik JSON (nie in-memory state): przeżywa reload window VS Code, debugowalny
- WebviewPanel (nie TreeView, nie StatusBar): bogaty layout siatki z kolorami, timerami, edytowalny
- Vanilla JS w webview dla MVP (bez React/Vue): minimalny bundle, prosta komunikacja postMessage, HMR niepotrzebny
- Konfiguracja przycisków w settings.json VS Code (nie własny plik): Settings Sync across devices, standardowy UX
- Przełączanie terminali przez komendę + user binding (nie przechwycenie Tab): unika konfliktu z autouzupełnieniem w terminalu
- Ramka aktywnego terminala renderowana przez webview panel (nie podświetlenie xterm): webview jest jedyną spójną powierzchnią dla wszystkich terminali
- Identyfikacja terminala przez env (nie przez pid/title): env przeżywa restart, czytane natywnie przez każdy skrypt hook
- Brak PLAN.md na starcie: CC wygeneruje PLAN.md przez Plan Mode dla konkretnych faz (Phase 0, potem Phase 1, itd.) gdy każda się zacznie
<!-- /SECTION:decisions -->

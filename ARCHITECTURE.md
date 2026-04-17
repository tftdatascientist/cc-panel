<!-- ARCHITECTURE v1.0 -->

## Overview
<!-- SECTION:overview -->
Ekstensja VS Code renderuje dwuwarstwowy układ w obszarze edytora: webview panel sterujący (górna połowa editor group) + 1-4 terminale z Claude Code (dolna połowa, split). Ekstensja spawnuje każdą instancję CC przez node-pty nadając jej unikalny CC_PANEL_TERMINAL_ID w env. CC emituje swój stan przez natywne hooki (statusLine, UserPromptSubmit, Stop), które zapisują JSON do plików per-terminal w ~/.claude/cc-panel/; ekstensja obserwuje katalog przez chokidar i przekazuje zmiany do webview. Akcje użytkownika (kliknięcie przycisku, przełączenie terminala) wracają z webview do ekstensji przez postMessage i są realizowane jako pty.write na aktywnym terminalu lub jako komenda VS Code.
<!-- /SECTION:overview -->

## Components
<!-- SECTION:components -->
- extension.ts: entry point, rejestracja komend (ccPanel.open, ccPanel.addTerminal, ccPanel.cycleActive, ccPanel.editButton, ccPanel.installHooks), aktywacja panelu, routing zdarzeń TerminalManager/StateWatcher → PanelManager
- PanelManager: tworzy/trzyma WebviewPanel w ViewColumn.One, inicjuje split pionowy (panel nad terminalami), agreguje stan z terminalManager i stateWatcher, pushuje do webview przez postMessage, buforuje MessageItem (rolling 100) + re-hydruje przy reveal
- webview (HTML/CSS/JS vanilla): trzy rzędy — górny (4 status tiles z fazą working/waiting + timer; klasa `is-ctx-warn` gdy ctx≥70%), środek (left: button grid grupowany przez `section` nagłówki, right: messages feed z paskiem koloru per terminal), dolny (4 info bars z metrykami CC: model/ctx/cost/mode); zewnętrzna ramka w kolorze aktywnego terminala
- TerminalManager: mapa id→{pty, terminal, subscriptions}, spawn CC przez Pseudoterminal + node-pty z env CC_PANEL_TERMINAL_ID, `activeIds()` sortowane asc, `onTerminalsChanged` EventEmitter (fire po create/close), `write(id, data)` dla Actions. `create(id, location)` akceptuje `ViewColumn` (dla T1 — nowa grupa edytora pod webview panelem) lub `{ parentTerminal }` (T2/T3/T4 jako split przy T1 w tej samej grupie, `TerminalSplitLocationOptions`). Ikona taba kolorowana przez `vscode.ThemeColor("ccPanel.terminal.tN")` (paleta T1 teal / T2 amber / T3 purple / T4 coral zadeklarowana w `package.json` `contributes.colors`, spójna z ramką webview)
- StateWatcher: chokidar na ~/.claude/cc-panel/state.*.json → emit TerminalState → extension.onStateChange → PanelManager.setMetrics/setPhase/addMessage
- ButtonStore: odczyt workspace.getConfiguration('ccPanel.buttons'), fallback do resources/default-buttons.json, walidacja schematu (label, type ∈ {sendText, keystroke, vsCodeCommand, multiStep}, value: string | ButtonStep[], icon?, section?); metoda `save(buttons, target)` wypisuje do config (Global|Workspace)
- EditButton: wizard runEditButton(store) — QuickPick (edit/new/delete) → collectSpec (label → type → value → section → icon) → pickTarget (Global vs Workspace) → store.save; encode/decode escapes dla keystroke (\u001b ↔ 0x1B); multiStep edytowalny tylko przez label/section/icon (kroki z settings.json)
- Actions: executor akcji na TerminalManager.activeId — sendText (pty.write(value + '\r')), keystroke (pty.write(raw)), vsCodeCommand (vscode.commands.executeCommand(value)), multiStep (sekwencyjne await sub-akcji, anulacja placeholder przerywa łańcuch)
- resources/hooks/statusline.js: CC uruchamia per tick status line — czyta JSON ze stdin + env CC_PANEL_TERMINAL_ID, kalkuluje ctx_pct = (input + cache_read + cache_creation) / 200k, zapisuje ~/.claude/cc-panel/state.{id}.json, wypluwa tekst status line na stdout (T{id} model $cost ctx:NN%). Wszystkie trzy hooki (`statusline.js`/`userpromptsubmit.js`/`stop.js`) na wejściu sprawdzają `CC_PANEL_TERMINAL_ID` regexem `/^[1-4]$/` i robią cichy `process.exit(0)` dla sesji CC spoza cc-panel — hooki w `~/.claude/settings.json` są globalne i odpalą się dla każdej sesji CC na systemie
- resources/hooks/userpromptsubmit.js, stop.js: aktualizują phase (working/waiting) + phase_changed_at w state.{id}.json; stop.js dodatkowo czyta ostatnie 64 KB transcript_path, wyciąga ostatnią wiadomość assistant, zapisuje last_message + last_message_at
- installHooks: komenda ccPanel.installHooks — upsertHook() w ~/.claude/settings.json (deduplikacja po ścieżce skryptu, backup settings.json przy kolizji). Przy istniejącym `statusLine` modal z 3 opcjami: **Podmień (backup)** — zastępuje własnym (metryki model/ctx/cost w kafelkach), **Zachowaj mój** — zostawia użytkownika (metryki puste, ale fazy working/waiting i messages feed dalej działają przez UserPromptSubmit/Stop), **Cancel** — pełny abort
<!-- /SECTION:components -->

## Data Flow
<!-- SECTION:data_flow -->
User action (button click) → webview postMessage {invokeButton, index} → PanelManager → extension.onInvokeButton → Actions.execute(spec, activeId) → pty.write (sendText/keystroke) lub vscode.commands.executeCommand (vsCodeCommand) → CC/VS Code
CC output (tool use, text) → pty → xterm w editor group (widoczne bezpośrednio)
CC statusLine tick → statusline.js → write state.{id}.json (model, cost, ctx_pct, token_usage) → chokidar event → StateWatcher.emit → extension.onStateChange → PanelManager.setMetrics → webview → info bars + ewentualny toggle is-ctx-warn na tile (ctx≥70%)
CC UserPromptSubmit → userpromptsubmit.js → state.{id}.json phase=working + phase_changed_at → chokidar → PanelManager.setPhase → webview → zielony kolor tile-phase + timer od sinceMs
CC Stop → stop.js → state.{id}.json phase=waiting + last_message + last_message_at → chokidar → PanelManager.setPhase + addMessage (jeśli last_message_at różny od poprzednio widzianego, Map<id,at> w extension) → webview → żółty kolor tile-phase + wpis w messages feed z paskiem koloru T{id}
User klik w disabled tile lub komenda ccPanel.addTerminal → webview postMessage {addTerminal, id} → extension.addTerminal → TerminalManager.create (dla T1: `ViewColumn.Two` → nowa grupa pod panelem; dla T2/T3/T4: `{ parentTerminal: T1 }` → split w grupie T1) → onTerminalsChanged → PanelManager.setTerminals → webview enable tile + setActive
User Ctrl+Alt+Tab → ccPanel.cycleActive → cycleActiveTerminal() → indexOf(activeId) na activeIds() sorted, modulo → terminal.show(false) + PanelManager.setActive → webview zmiana koloru ramki + highlight aktywnego tile
User Ctrl+Shift+P → CC Panel: Edit Buttons → runEditButton → QuickPick/InputBox wizard → ButtonStore.save(buttons, target) → config.update → onDidChangeConfiguration → ButtonStore.onChange → PanelManager.setButtons → webview re-render grid
<!-- /SECTION:data_flow -->

## Decisions
<!-- SECTION:decisions -->
- Spawn CC przez ekstensję (nie attach): jedyny sposób zapewnienia env CC_PANEL_TERMINAL_ID i kontroli PTY I/O
- statusLine hook jako źródło metryk (nie parsowanie ANSI): deterministyczne, odporne na kosmetyczne zmiany CC
- Per-terminal plik JSON (nie in-memory state): przeżywa reload window VS Code, debugowalny
- WebviewPanel (nie TreeView, nie StatusBar): bogaty layout siatki z kolorami, timerami, edytowalny
- Vanilla JS w webview dla MVP (bez React/Vue): minimalny bundle, prosta komunikacja postMessage, HMR niepotrzebny
- Konfiguracja przycisków w settings.json VS Code (nie własny plik): Settings Sync across devices, standardowy UX; save target wybierany przez QuickPick (Global domyślny, Workspace gdy są workspaceFolders)
- Przełączanie terminali przez komendę + keybinding contribution (Ctrl+Alt+Tab, nie przechwycenie Tab): unika konfliktu z autouzupełnieniem w terminalu
- Ramka aktywnego terminala renderowana przez webview panel (nie podświetlenie xterm): webview jest jedyną spójną powierzchnią dla wszystkich terminali
- Identyfikacja terminala przez env (nie przez pid/title): env przeżywa restart, czytane natywnie przez każdy skrypt hook
- Hooki CC w Node.js (nie bash): cross-platform Windows/Linux/Mac, JSON parse w stdlib, brak dependencji shell
- ctx_pct liczone w hooku (nie w ekstensji): statusLine już ma token_usage payload, uniknięcie duplikacji logiki i dodatkowych wywołań; stały limit 200k (wszystkie Claude 4.x)
- ctx-warn ortogonalne do phase (nie zastępuje): user ma widzieć working/waiting jednocześnie z ostrzeżeniem o pamięci, więc osobna klasa CSS `is-ctx-warn` zamiast phase="red"
- Natywne VS Code dialogs dla EditButton (QuickPick + InputBox, nie custom HTML modal): spójne UX, zero kodu webview do utrzymania, escape encode/decode inline
- Brak PLAN.md na starcie: CC wygeneruje PLAN.md przez Plan Mode dla konkretnych faz (Phase 0, potem Phase 1, itd.) gdy każda się zacznie
- Terminale T2-T4 jako split T1 przez `parentTerminal` (nie `ViewColumn` per instancja): VS Code z `TerminalSplitLocationOptions` trzyma je razem w jednej grupie edytora pod webview panelem; `ViewColumn.Two` dla nie-pierwszych otwierałby osobne grupy/okna
- Hooki filtrują CC_PANEL_TERMINAL_ID lokalnie (nie filter w StateWatcher): `~/.claude/settings.json` jest globalny — każda sesja CC na maszynie odpali hooki. Bez filtra obce sesje pisałyby `state.0.json` zużywając IO i zaśmiecając stan; filtr w StateWatcher (`isTerminalId`) i tak obecny jako defense-in-depth
- installHooks z 3-opcyjnym dialogiem przy kolizji statusLine: zachowanie istniejącego statusLine (np. `ccstatusline@latest`) vs podmiana na własny to trade-off (metryki model/ctx/cost vs wizualna kontynuacja) — wybór użytkownika, nie decyzja ekstensji
- multiStep value jako tablica ButtonStep (nie osobne buttony w sekwencji): jeden klik → pełny łańcuch, umożliwia placeholder anulować cały przepływ; kroki bez własnego label/section/icon, dziedziczą je z parent buttona
- Sekcje jako pole `section` na spec (nie osobny typ separatora): zachowuje kolejność tablicy jako source of truth, webview grupuje kolejne wpisy z tym samym `section` pod jednym nagłówkiem; wpisy bez section tworzą domyślną grupę; nagłówek czyści się automatycznie przy zmianie sekcji
<!-- /SECTION:decisions -->

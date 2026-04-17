<!-- PLAN v1.5 -->

## Meta
<!-- SECTION:meta -->
- status: active
- goal: Phase 4 (phase hooks + timer) + Phase 5 (button grid sendText)
- session: 2
- updated: 2026-04-17 20:10
<!-- /SECTION:meta -->

## Steps
<!-- SECTION:steps -->
### Phase 4
- [x] `resources/hooks/userpromptsubmit.js` — stdin consumer, state.phase="working" + phase_changed_at ISO
- [x] `resources/hooks/stop.js` — analogicznie, phase="waiting"
- [x] `installHooks.ts` → `upsertHook()` wstawia wpisy do `settings.hooks.UserPromptSubmit` i `settings.hooks.Stop`, deduplikuje po nazwie skryptu
- [x] `TerminalState.phase` + `phase_changed_at`; `messages.ts` `setPhase` z `sinceMs`; `PanelManager.setPhase()`
- [x] `main.js` — per-tile timer interval (1s) formatujący `Ns` / `NmSSs`, start/stop zależnie od fazy i `sinceMs`
- [x] `extension.ts.onStateChange` → forward `phase` do `panelManager.setPhase()`
### Phase 5
- [x] `resources/default-buttons.json` — 8 slash-command buttons MVP
- [x] `package.json` configuration `ccPanel.buttons` (schema array of {label, type: sendText|keystroke, value, icon?})
- [x] `src/buttons/ButtonStore.ts` — config > fallback default-buttons.json, walidacja, onDidChangeConfiguration watcher
- [x] `src/buttons/Actions.ts` — `execute(button, activeId)` delegujący do `terminalManager.write`
- [x] `TerminalManager.write(id, data)` — pobiera pty z ManagedTerminal, wywołuje `.write()`
- [x] `messages.ts` — `setButtons` outbound z `ButtonViewSpec {label, icon?}`, `invokeButton` inbound z `index`
- [x] `PanelManager.setButtons()` + routing `invokeButton` → callback
- [x] `main.js` — render `.action-btn` do `#button-grid`, klik → postMessage `invokeButton` z indeksem
- [x] `styles.css` — `.action-btn` hover/active
- [x] `extension.ts` — `activeTerminalId` tracked, `onInvokeButton` → `Actions.execute` z fallback warning toast
- [x] `npm run build` → out/extension.js 18.3 KB, `tsc --noEmit` czysto
### Ręczna weryfikacja
- [ ] `Ctrl+Shift+P → CC Panel: Install Hooks` — instaluje 3 hooki (statusLine + UserPromptSubmit + Stop)
- [ ] Restart `cc` w terminalu T1
- [ ] Wysłać prompt → tile T1 → phase "working" + timer tika (zielony)
- [ ] CC kończy odpowiedź → tile → phase "waiting" + timer tika (żółty)
- [ ] Klik "Compact" / "Help" w button grid → tekst pojawia się w terminalu T1
<!-- /SECTION:steps -->

## Notes
<!-- SECTION:notes -->
- Phase red (ctx>70%) odłożone — wymaga kalkulacji ctx% z `token_usage` i context window per model; dojdzie gdy CC payload da deterministyczne ctx% pole albo wyliczymy z `input_tokens + output_tokens + cache_*`
- Timer per-tile: `Map<id, intervalHandle>` w main.js; setPhase resetuje poprzedni interval i startuje nowy; phase "idle" czyści tekst timer
- Button `keystroke` używa surowego `value` (escape sequences np. `\u001b` dla Esc) — dojdzie w Phase 8; MVP ma tylko `sendText`
- `ButtonViewSpec` nie zawiera `value` — ekstensja trzyma pełny spec w ButtonStore, webview operuje tylko indeksami; to chroni przed wyciekiem potencjalnie wrażliwych promptów do DOM
- `TerminalManager.write` tolerantny — zwraca `false` gdy pty nieaktywny (CC zakończone), wtedy ekstensja pokazuje warning zamiast crashować
- `upsertHook` dedupe po `path.basename(scriptPath)` — re-install nie duplikuje; jeśli user ma własne hooki innych skryptów, zostają nietknięte (zostają w tej samej tablicy jako inne wpisy albo inna pozycja `hooks[]`)
- `ccPanel.buttons` config w settings.json idzie z Settings Sync przez VS Code (cross-device), jak chcieliśmy w ARCHITECTURE.md
<!-- /SECTION:notes -->

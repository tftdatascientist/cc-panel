<!-- PLAN v2.0 — zastępuje STATUS.md jako centrum statusu projektu -->

## Meta
<!-- SECTION:meta -->
- project: cc-panel
- version: 0.0.22
- session: 32
- updated: 2026-04-26
- repo: https://github.com/tftdatascientist/cc-panel (public, main)
- publisher: LokalnaAutomatyzacjaBiznesu
<!-- /SECTION:meta -->

## Hard Constraints (NIETYKALNE)
<!-- SECTION:constraints -->
- **Dystrybucja tylko przez Marketplace.** Lokalny `code --install-extension ... --force` tworzy duplikaty w `~/.vscode/extensions/`. Dla dev — F5 (Extension Development Host). Dla release — upload VSIX na Marketplace.
- **Statusline CC w terminalu jest święty.** cc-panel NIGDY nie podmienia statusline CC. Opcja "Podmień" wykluczona. Jeśli funkcja wymaga podmiany statusline → rezygnujemy z funkcji, NIE ze statusline.
<!-- /SECTION:constraints -->

## Stan bieżący
<!-- SECTION:current -->
- **Build:** `tsc --noEmit` czysto; esbuild bundle ~255 KB (dev) / ~116 KB (prod).
- **VSIX:** `cc-panel-0.0.18.vsix` — w sklepie Marketplace.
- **Komendy:** 17 (12 core + 5 AA). Keybindings: `Ctrl+Alt+\`` / `Ctrl+Alt+1-4` / `F1-F4` / `Ctrl+Alt+A`.
- **Slash commands:** 35 pozycji; `/color` jako 5 wariantów (cyan/orange/purple/pink/random).
- **Auto-Accept:** pipeline 7/7 zaimplementowany. E2E headless zweryfikowany (sesja 23). **E2E przez F5 jeszcze nieprzetestowane.**
- **Dźwięki WAV:** `stop.js` + `userpromptsubmit.js`; `~/.claude/cc-panel/sounds/{1-4}{stop|user}.wav`.
- **Hooki:** instalują się automatycznie przy starcie ekstensji (0.0.18) — ręczne `CC Panel: Install Hooks` niepotrzebne.
- **Chipy T1–T4:** jednopoziomowe (`flex-direction:row`); metryki `$X · Ntok · Ctx%` bezpośrednio w chipie.
<!-- /SECTION:current -->

## Done — główne kamienie milowe
<!-- SECTION:done -->
- **Sesje 0-16:** fundament — TerminalManager (node-pty), hooki CC, UserListsStore, 12 komend, dashboard (Ctx%/Cost/Total), projectPaths[T1-T4], bypassPermissions, lazy spawn, floating WebviewPanel.
- **Sesje 17-22:** Auto-Accept pipeline (TriggerDetector → BudgetEnforcer → HaikuHeadlessClient → CircuitBreaker → SessionLogger → AutoAcceptSession → webview banner).
- **Sesja 23:** wzmocnienie wskaźników working/waiting; historia komend (LRU); dropdown z dedup + sort.
- **Sesja 26:** AA banner kolor terminala; auto-color po spawnie; limit kosztowy AA = koszt sesji CC; fix system promptu Haiku.
- **Sesja 28:** fix chip visibility; folder+timer współistnienie w chipie; stale-guard (2h) dla timera; cache-bust zasobów webview.
- **Sesja 29:** chipy spłaszczone do jednego wiersza; context menu → VS Code QuickPick z sekcjami.
- **Sesja 30:** dźwięki WAV (spawnSync, env var); auto-sync ścieżek hooków przy starcie (0.0.18).
<!-- /SECTION:done -->

## Next
<!-- SECTION:next -->
- [ ] **E2E AA przez F5** — test od UI: start wizard → trigger → Haiku response → banner. Jedyna rzecz nieprzetestowana end-to-end przez interfejs użytkownika.
<!-- /SECTION:next -->

## Backlog
<!-- SECTION:backlog -->
- [ ] Testy jednostkowe: `tests/state/transcriptReader.test.ts` z fikstur JSONL (incremental cache, reset przy shrink, cost cumulative).
<!-- /SECTION:backlog -->

## Known bugs
<!-- SECTION:bugs -->
- (brak)
<!-- /SECTION:bugs -->

<!-- SECTION:session_log -->
- 2026-04-25 21:08 | HANDOFF: sesja zamknięta, ostatnie current='(brak)'
- 2026-04-25 20:14 | HANDOFF: sesja zamknięta, ostatnie current='(brak)'
- 2026-04-25 20:10 | HANDOFF: sesja zamknięta, ostatnie current='(brak)'
- 2026-04-25 20:07 | HANDOFF: sesja zamknięta, ostatnie current='(brak)'
- 2026-04-25 19:51 | HANDOFF: sesja zamknięta, ostatnie current='(brak)'
- 2026-04-25 19:34 | HANDOFF: sesja zamknięta, ostatnie current='(brak)'
- 2026-04-25 12:05 | HANDOFF: sesja zamknięta, ostatnie current='(brak)'
- 2026-04-25 12:01 | HANDOFF: sesja zamknięta, ostatnie current='(brak)'
- 2026-04-25 10:57 | HANDOFF: sesja zamknięta, ostatnie current='(brak)'
- 2026-04-25 10:46 | HANDOFF: sesja zamknięta, ostatnie current='(brak)'
<!-- /SECTION:session_log -->

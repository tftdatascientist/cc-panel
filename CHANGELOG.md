# Changelog — cc-panel

Format: `[wersja] YYYY-MM-DD HH:MM` · status: `implemented` | `planned` | `released`

---

## [0.0.10] — zbudowany, oczekuje na upload (sesja 29, 2026-04-23)

### Implemented

| Czas | Zmiana | Pliki |
|------|--------|-------|
| 2026-04-23 | **Spłaszczenie chipów do jednego wiersza** — `.chip-term-wide` zmienione z `flex-direction:column` na `row`; wszystkie elementy (`T# · folder · timer · $X · Ntok · Ctx%`) w jednym wierszu; `bar-terms` zmniejszone z 80px do 36px; `chip-term-row1`/`chip-term-row2` usunięte z HTML; font-size ujednolicony do 11px (był miks 10/11/12/13px); folder `flex:1 1 auto` absorbuje wolne miejsce, metryki `flex:0 0 auto` nie są wypychane | `resources/webview/index.html`, `resources/webview/styles.css` |
| 2026-04-23 | **Context menu → VS Code QuickPick** — prawy klik na chipie wysyła `postMessage({type:"showContextMenu",chipId})` do extension zamiast otwierać HTML menu w iframe; extension otwiera natywny `vscode.window.showQuickPick` z sekcjami (Historia / Slash commands / Komendy / Wiadomości) przez `QuickPickItemKind.Separator`; wybrana pozycja wysyłana do terminala + `recordCommand`; cały blok HTML/CSS/JS `ctx-menu` usunięty (~70 linii) | `resources/webview/main.js`, `resources/webview/index.html`, `resources/webview/styles.css`, `src/panel/messages.ts`, `src/panel/PanelManager.ts`, `src/extension.ts` |

### Status
- `tsc --noEmit` — czysto
- `npm run build` — esbuild bundle OK (255.8 KB)
- `cc-panel-0.0.10.vsix` — zbudowany (59.56 KB, 2026-04-23)
- Marketplace — **oczekuje na upload**
- git commit — **brak** (uncommitted)

---

## [0.0.9] — opublikowany na Marketplace (sesja 28, 2026-04-22)

### Implemented

| Czas | Zmiana | Pliki |
|------|--------|-------|
| 2026-04-22 | **Fix: chipy T2-T4 widoczne mimo że terminale nieuruchomione** — `.chip-term-wide { display: flex !important }` blokował atrybut HTML `hidden` (UA-rule `[hidden] { display: none }` przegrywał z `!important`). Usunięto `!important`, dodano jawną regułę `.chip-term-wide[hidden] { display: none !important }` | `resources/webview/styles.css` |
| 2026-04-22 | **Fix: folder projektu znikał z chipa gdy faza = waiting** — stary kod podmieniał `folderEl.hidden` na `timerEl` przy `phase==="waiting"`. Folder jest priorytetowy — zawsze widoczny. Timer pokazuje się obok folderu (row1: `T# · folder · timer`), a nie zamiast | `resources/webview/main.js` |
| 2026-04-22 | **Fix: timer oczekiwania liczył od stale `lastMessageAt`** — po nocy z wyłączonym kompem `state.{id}.json` trzymał wczorajszy timestamp → timer pokazywał 12h+. Dodano guard `STALE_MS = 2h`: jeśli `Date.now() - lastMessageAt > 2h`, `waitingSince` nie zostaje ustawiony, timer nie startuje | `resources/webview/main.js` |
| 2026-04-22 | **Cache-bust zasobów webview** — `PanelManager.renderHtml` dopisuje `?v=<timestamp>` do URI `styles.css` i `main.js`. Wymusza reload zasobów przy każdym `CC Panel: Open` niezależnie od webview cache VS Code (który jest agresywny przy `retainContextWhenHidden:true`) | `src/panel/PanelManager.ts` |

### Process notes

- VSIX 0.0.8 zbudowany, ale instalacja przez `code --install-extension ... --force` produkowała duplikaty w `~/.vscode/extensions/` (0.0.3, 0.0.6, 0.0.7, 0.0.8, 0.0.9 razem aktywne → „scanning extensions" error). Remediacja: PowerShell skrypt usuwający foldery + `.obsolete` + `CachedExtensionVSIXs`, potem upload 0.0.9 na Marketplace.
- Marketplace ma pierwszeństwo nad lokalnym VSIX dla tego samego publisher ID — ścieżka produkcyjna to `vsce package → manual upload → czekaj na propagację`. F5 (Ext Dev Host) jest zalecany dla iteracji dev.

### Status
- `tsc --noEmit` — czysto
- `npm run build` — esbuild bundle OK (253.6 KB)
- `cc-panel-0.0.9.vsix` — zbudowany (59.67 KB, 2026-04-22)
- Marketplace — **opublikowany** (manual upload przez user), zainstalowany pomyślnie, E2E weryfikacja: tylko T1 widoczny przy starcie
- git commit — **brak** (uncommitted)

---

## [0.0.8] — zbudowany lokalnie, nieopublikowany (sesja 28, 2026-04-22)

Pośredni bump — zawiera ten sam zestaw fixów co 0.0.9 bez cache-bustu. Zastąpiony przez 0.0.9 z powodu problemów z cache webview w Ext Dev Host (cache-bust to deterministyczne obejście).

### Status
- `cc-panel-0.0.8.vsix` — zbudowany, ale **zastąpiony przez 0.0.9** (nie instalować)
- git commit — **brak**

---

## [0.0.7] — opublikowany na Marketplace (sesja 27, 2026-04-22)

### Implemented

| Czas | Zmiana | Pliki |
|------|--------|-------|
| 2026-04-22 | **Fix: `/color <color>` — polling na state.{id}.json** — zastąpiono `setTimeout(4000)` obserwatorem `setInterval(500ms)` na `~/.claude/cc-panel/state.{id}.json`; plik pojawia się gdy statusline hook CC zapiszę stan po pierwszym promptcie = CC załadowany; `/color` wysyłany 600ms po sygnale gotowości; fallback 15s jeśli hook nie wystrzelił | `src/terminals/TerminalManager.ts` |
| 2026-04-22 | **Przebudowa panelu — tylko uruchomione terminale widoczne** — chipy T1-T4 dostają `hidden` attr gdy terminal nie jest uruchomiony (całkowicie nieobecne, nie wyszarzone); `setTerminals()` używa `chip.hidden = !s.has(id)` zamiast `is-disabled` klasy; usunięto przycisk `▼` (btn-dash) i całą sekcję `#dashboard` (tabelka 4×2 + last-message) z HTML i CSS | `resources/webview/index.html`, `resources/webview/main.js`, `resources/webview/styles.css` |
| 2026-04-22 | **Metryki w chipach — 2 wiersze** — `.chip-term-wide` zmienione na `flex-direction:column`; wiersz 1 = `T# · folder · (timer gdy waiting)`; wiersz 2 = `$X.XX · Ntok · Ctx%`; `bar-terms` podniesione do 68px; `renderDashboard()` wypełnia spans `.chip-term-cost/.chip-term-tokens/.chip-term-ctx` | `resources/webview/index.html`, `resources/webview/main.js`, `resources/webview/styles.css` |
| 2026-04-22 | **Dropdown prawym klikiem na chipie** — `contextmenu` event na każdym `.chip-t`; prawy klik na T2 przełącza aktywny terminal na T2 i otwiera `<ul id="ctx-menu">` z sekcjami Historia/Slash commands/Komendy/Wiadomości; wybór pozycji wysyła komendę do aktywnego terminala; menu zamknięte kliknięciem poza nim lub Escape | `resources/webview/index.html`, `resources/webview/main.js`, `resources/webview/styles.css` |

### Planned (0.0.8)

| Zgłoszone | Zmiana | Opis |
|-----------|--------|------|
| — | — | — |

### Status
- `tsc --noEmit` — czysto
- `npm run build` — esbuild bundle OK (253.5 KB)
- `cc-panel-0.0.7.vsix` — zbudowany (59.48 KB, 2026-04-22)
- git commit — **brak** (uncommitted)

---

## [0.0.6] — niezcommitowane (sesja 26, 2026-04-21)

### Implemented

| Czas | Zmiana | Pliki |
|------|--------|-------|
| 2026-04-21 | **AA banner kolor terminala** — `.aa-banner` dostaje klasę `chip-t{id}` w `renderAaMetrics`; banner świeci przez `var(--t-color)` kolorem terminala AA zamiast hardkodowanego `#fbbf24` | `resources/webview/main.js`, `resources/webview/styles.css` |
| 2026-04-21 | **Auto-color po spawnie** — `TerminalManager.create()` wysyła `/color cyan\|orange\|purple\|pink` po 4000ms; stała `TERMINAL_COLOR_MAP` mapuje T1→cyan, T2→orange, T3→purple, T4→pink | `src/terminals/TerminalManager.ts` |
| 2026-04-21 | **Limit kosztowy AA = koszt sesji CC** — `BudgetEnforcer` usunął tracking kosztu Haiku; `AutoAcceptSession` trzyma `startCostUsd` (baseline przy starcie) i oblicza deltę przez `deps.getCcCostUsd(id)` po każdej iteracji; `StateWatcher` dostał metodę `getSnapshot(id)` | `src/auto-accept/AutoAcceptSession.ts`, `src/auto-accept/BudgetEnforcer.ts`, `src/state/StateWatcher.ts`, `src/extension.ts` |
| 2026-04-21 | **Fix system promptu Haiku** — `--append-system-prompt` → `--system` (pełne zastąpienie); domyślny system prompt zmieniony na "You are the USER in an ongoing Claude Code session..."; etykiety `User/Assistant` → `USER/CLAUDE CODE` w preamble `buildPromptWithContext` | `src/auto-accept/HaikuHeadlessClient.ts`, `src/auto-accept/AutoAcceptSession.ts`, `package.json` |
| 2026-04-21 | **Fix `TerminalManager.write()` — `\r` handling** — `sendText(data, false)` → `sendText(text, endsWithCR)` żeby VS Code dodawał platform-native newline zamiast surowego `\r` (fix: Enter nie triggerował CC niezawodnie) | `src/terminals/TerminalManager.ts` |
| 2026-04-21 | `README.md` usunięty (127 linii — outdated, zastąpiony przez CLAUDE.md + ARCHITECTURE.md) | `README.md` |

### Status
- `tsc --noEmit` — czysto
- `npm run build` — esbuild bundle OK
- `cc-panel-0.0.6.vsix` — **niezbudowany** (zastąpiony przez 0.0.7)
- git commit — **brak** (uncommitted)

---

## [0.0.5] — zbudowany lokalnie, niezcommitowany (sesja 26, 2026-04-21)

> Nota: wersja 0.0.5 była nazwą VSIX zbudowanego w sesji 26 przed bumpe package.json do 0.0.6. Tożsama z zawartością 0.0.6 — nie ma osobnego commitu.

---

## [0.0.4] — committed `326764a` (sesje 18-23, 2026-04-20)

### Implemented

| Zmiana | Pliki |
|--------|-------|
| **SessionLogger** — append-only JSONL `~/.claude/cc-panel/aa-sessions.jsonl`; 7 typów eventów discriminated union | `src/auto-accept/SessionLogger.ts` |
| **TriggerDetector** — subskrybuje StateWatcher, emituje `TriggerEvent` na krawędzi `working→waiting`; debounce 3000ms | `src/auto-accept/TriggerDetector.ts` |
| **BudgetEnforcer** — pure logic: time/iter/cost, każdy `null` = unlimited (D4 wariant c) | `src/auto-accept/BudgetEnforcer.ts` |
| **CircuitBreaker** — sliding window 3 odp.: similarity Levenshtein ≥0.80 + idle-length ±10% | `src/auto-accept/CircuitBreaker.ts` |
| **AutoAcceptSession** — orkiestrator z DI (triggerDetector, haikuClient, writeToTerminal, getRecentMessages); busy-skip; 3× error → stop | `src/auto-accept/AutoAcceptSession.ts` |
| **Command Palette wiring** — 5 komend AA: startAutoAccept (Ctrl+Alt+A), stopAutoAccept, autoAcceptStatus, showAutoAcceptHistory, editAutoAcceptSystemPrompt | `src/extension.ts`, `package.json` |
| **startWizard** — 5-krokowy QuickPick: terminal / czas / cost / iter / system prompt | `src/auto-accept/startWizard.ts` |
| **Webview banner AA** — cienki pasek ~26px; `● AA T# · iter N/L · $X/$Y · time left · [Stop]`; countdown lokalny w webview; auto-hide 5s po stopie | `resources/webview/index.html`, `resources/webview/main.js`, `resources/webview/styles.css` |
| **Historia komend** — `UserListsStore.recordCommand()`; LRU dedup + cap 100; `usageStats` z `count`/`lastUsedAt`; dropdown z sekcjami ⏱/⭐ | `src/settings/UserListsStore.ts`, `resources/webview/main.js` |
| **Wskaźniki working/waiting** — `working` = pulsujący glow box-shadow + dot z halo; `waiting` = statyczny outline (zero layout shift) | `resources/webview/styles.css`, `resources/webview/main.js` |
| **E2E headless AA** zweryfikowane — fake StateWatcher + realny pipeline; cache hit drugiej iteracji: $0.0067 | — |

### Released
- `cc-panel-0.0.4.vsix` — zbudowany 2026-04-20, commit `326764a`
- Upload na Marketplace: **brak** (brak PAT)

---

## [0.0.3] — committed `5e62882` (sesje 13-15, wcześniej)

| Zmiana |
|--------|
| Fix `TerminalManager` czytającego `workspaceFolders[0]` zamiast `ustawienia.json` |
| Widoczność folderu w chipach (`chip-term-folder`) |
| Publisher `LokalnaAutomatyzacjaBiznesu` |
| Fix koloru ikony terminala (`ThemeIcon(name, ThemeColor)`) |
| Opcja `ccPanel.bypassPermissions` z `--dangerously-skip-permissions` |
| Skracanie nazwy folderu do 14 znaków |
| `/color` poprawiony do 5 wariantów CC CLI (cyan/orange/purple/pink/random) |

---

## [0.0.2] — committed `cdea2ea` (sesje 10-12, wcześniej)

| Zmiana |
|--------|
| Dashboard: StateWatcher + TranscriptReader, tabelka 4×2 (Cost/Total), last-message, toggle ▼/▲ |
| `projectPaths[T1-T4]` w `ustawienia.json`, komenda `setProjectFolder` |
| Migracja legacy `projectPath` → slot T1 |
| Pływający WebviewPanel (`ViewColumn.Beside + preserveFocus`) |

---

## [0.0.1] — committed `b39efc4` (sesje 8-9, wcześniej)

| Zmiana |
|--------|
| Fix pustego dropdownu `/COMMANDS` (nowy typ `setSlashCommands`) |
| Lazy spawn z fallback 300ms + `spawnDone` flag (fix "zjazdu"/czarnego ekranu CC) |
| `cmd.exe /k` na Windows |
| Layout: input+▶+keystrokes+chipy T1-T4 w jednym pasku |

---

## [0.0.0] — committed `ffdd9f3` (sesje 0-7, wcześniej)

MVP: scaffolding, TerminalManager z node-pty, hooki statusline/userpromptsubmit/stop, UserListsStore, 12 komend z keybindingami.

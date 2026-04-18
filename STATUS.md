## Meta
- project: cc-panel
- session: 9
- updated: 2026-04-18
- repo: https://github.com/tftdatascientist/cc-panel (public, main)

## Done
- **Phase 0-2** — scaffold, webview layout, event bus. Potwierdzone F5.
- **Phase 1** — TerminalManager z node-pty, split terminali T2-T4 przez `parentTerminal`. Kolory tabów przez `contributes.colors`.
- **Phase 3+** — hooki statusline (chain-capable), userpromptsubmit, stop. `installHooks.ts`.
- **Komendy** — `ccPanel.open/addTerminal/cycleActive/selectTerminal1-4/editUserCommands/editMessages/reloadUserLists/installHooks`. Keybindingi Ctrl+Alt+` i Ctrl+Alt+1-4. F1-F4 gdy fokus na panelu.
- **UserListsStore** — `~/.claude/cc-panel/ustawienia.json`, wizard QuickPick/InputBox.
- **Slash commands** — statyczna lista 29 komend w `slashCommands.ts`.
- **Session 8** — fix pustego dropdownu `/COMMANDS` (`setSlashCommands` postuje do webview gdy panel otwarty). Nowy typ `setSlashCommands` w messages.ts.
- **Session 9 — przeprojektowanie panelu:**
  - Jeden pasek ≤100px high, full-width: `[input 22%][dropdown][▶] | [cmd][user][text][input] | [1][2][3][4] | [model][effort][think][plan] | [Esc][^C][⇧Tab]`
  - Tryb `cmd` → dropdown slash commands; `user` → user commands; `text` → gotowe messages; `input` → dropdown ukryty, wpisujemy tekst z modyfikatorami
  - `effort`: low/mid/hard/max → wysyła `/effort X\r` przed wiadomością
  - `think`: "think" / "think harder" → prefix do tekstu
  - Terminal chips 1-4 kolorowane, klik na disabled = addTerminal
  - Opcjonalny tekst z inputu doklejany do komendy cmd/user (np. `/model opus`)
- **Session 9 — fix terminali CC (zjazd/czarny ekran):**
  - Lazy spawn z fallbackiem: jeśli `open()` dostaje `initialDimensions` → spawn natychmiast; jeśli nie → czeka na `setDimensions()`; po 300ms fallback spawn z 220×50
  - `spawnDone` flag zapobiega double-spawn przy kolejnych `setDimensions()`
  - Błąd spawnu wypisywany w terminalu (czerwony tekst) zamiast cichego fail
  - `resolveShell` na Windows: `cmd.exe /k` zamiast `/c` — cmd pozostaje otwarty po zakończeniu CC

## Current
- state: `tsc --noEmit` czysto, bundle 33.7 KB. Zmiany sesji 8+9 niezacommitowane.
- weryfikacja: terminale CC wymagają F5 w Extension Dev Host po przeładowaniu

## Next
- [ ] Weryfikacja ręczna F5 — terminale CC startują i render poprawny
- [ ] StateWatcher (opcjonalnie) — metryki model/ctx/cost z state.json
- [ ] VSIX packaging + publishing

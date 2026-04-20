# Auto-Accept Mode (AA) — plan implementacji

> **Status:** `gotowy-do-implementacji` (po decyzjach z 2026-04-20). Patrz sekcja "Zatwierdzone decyzje" niżej.
>
> **Pochodzenie:** transkrypt sesji 19-20 kwietnia 2026 (pliki JSONL `31aca16c...`, `425ebced...`, `a30e17e9...` w projekcie `C--Users-S-awek-claude-env-manager-VS-CLAUDE`). Sesja zakończyła się wyczerpaniem kontekstu, plan nie został zapisany ani scommitowany. Ten dokument jest rekonstrukcją z transkryptu z 2026-04-20 00:23:13Z.

## Zatwierdzone decyzje (2026-04-20, Session 17)

| # | Pytanie | Decyzja | Źródło |
|---|---------|---------|--------|
| D1 | Keybinding startu AA | **`Ctrl+Alt+A`** ✅ | user 2026-04-20 |
| D2 | Scope cap w MVP | **single-active globalnie** (1 aktywna sesja AA naraz, nie per-terminal) | user 2026-04-20 |
| D3 | Budżet domyślny | **15 min / $5.00 / 50 iter** (cost urealniony z $1 → $5 po smoke teście — realny koszt Haiku headless ~$0.07/iter) + **wymagana opcja "bez limitu"** | user 2026-04-20 + smoke test |
| D4 | Semantyka "bez limitu" (a/b/c) | **PENDING** — do rozstrzygnięcia przed `BudgetEnforcer.ts`. Rekomendacja: **wariant (b)** — time+cost unlimited, iter cap 500 jako backstop przed runaway loop | advisor |

## Smoke test CLI (2026-04-20)

```
echo "Say hi in 3 words" | claude -p --output-format json --model haiku
```

Zwraca JSON z polami: `result` (tekst), `total_cost_usd`, `duration_ms`, `usage.input_tokens/output_tokens/cache_creation_input_tokens`, `session_id`, `modelUsage`.

**Kluczowe obserwacje:**
- `--model haiku` → alias rozwijany do `claude-haiku-4-5-20251001`
- Każde wywołanie `claude -p` buduje pełny system prompt = **cache_creation ~58k tokens** na iterację
- Realny koszt: **~$0.0730/iter**, NIE $0.002 jak zakładał plan
- `duration_ms` ~5000-5500 ms dla krótkiego promptu
- Pole wyjścia nazywa się `result`, nie `text` — **HaikuHeadlessClient.ts** musi parsować `response.result`

## Cel funkcji

Nowy tryb `auto-accept` w cc-panel: po każdej wiadomości asystenta w terminalu T1-T4 (gdy CC wchodzi w `phase=waiting`), model Haiku generuje następną instrukcję kontynuującą pracę i wysyła ją do terminala. User startuje AA z Command Palette, ustawia limity (czas, iteracje, budżet $), może w każdej chwili zatrzymać. Celem jest autonomiczne dokończenie dobrze zdefiniowanych, długich zadań bez obecności usera przy klawiaturze.

## Konfiguracja wyborów (zatwierdzone)

| # | Wybór | Decyzja | Uzasadnienie |
|---|-------|---------|--------------|
| 1 | Jak uruchamiamy Haiku? | **1b**: `claude -p --output-format json --model haiku` przez `child_process.execFile` | Bez osobnego klucza API, jeden bill przez subskrypcję CC, jeden weekly limit |
| 2 | Kiedy Haiku przejmuje klawiaturę? | **2a**: tylko na krawędzi `working→waiting` terminala | `bypassPermissions=true` w cc-panel → permission prompts nie występują, nie trzeba obsługiwać 2b |
| 3 | Co Haiku dostaje jako kontekst? | **3b**: ostatnie 5 wiadomości z transcript JSONL + system prompt + meta-prompt | Najlepszy balans koszt/jakość decyzji |
| 4 | Gdzie logujemy sesje? | **4a**: lokalny `~/.claude/cc-panel/aa-sessions.jsonl` | Notion wymaga tokenu, MVP bez zewnętrznych zależności |

## Nowe pliki

```
src/auto-accept/
  AutoAcceptSession.ts      # orkiestrator: subskrybuje StateWatcher, trzyma budget, loguje, dispatch do Haiku
  HaikuHeadlessClient.ts    # execFile('claude', ['-p','--output-format','json','--model','haiku']) + stdin prompt
  TriggerDetector.ts        # per-terminal lastPhase map; emit 'waiting-edge' tylko gdy working→waiting
  BudgetEnforcer.ts         # limity: time (ms), iterations (count), cost ($); check przed każdym dispatch
  CircuitBreaker.ts         # Levenshtein na ostatnich 3 outputach Haiku; stop jeśli similarity > 0.85
  SessionLogger.ts          # append-only JSONL: start/trigger/haiku-response/send-to-t1/stop events
  types.ts                  # AutoAcceptConfig, AutoAcceptStatus, IterationRecord
```

## Zmodyfikowane pliki

- `src/extension.ts` — rejestracja 5 nowych komend, dispose AA session w deactivate
- `src/panel/messages.ts` — `AutoAcceptStatusDTO`, outbound `setAutoAcceptStatus`
- `src/panel/PanelManager.ts` — routing `setAutoAcceptStatus`, broadcast w `broadcastInit`
- `src/settings/UserListsStore.ts` — sekcja `autoAccept: { systemPrompt, lastConfig }` w `ustawienia.json`
- `package.json` — 5 nowych komend, 1 keybinding (Ctrl+Alt+A dla `startAutoAccept`)
- `resources/webview/main.js` + `index.html` + `styles.css` — banner pod paskiem gdy AA aktywny (terminal T#, iteration N, time left, cost $X.XX, przycisk Stop)

## Nowe Command Palette entries

| Komenda | Flow |
|---------|------|
| `ccPanel.startAutoAccept` | QuickPick terminal T1-T4 → QuickPick czas (5min/15min/1h/5h/∞) → InputBox limit $ (default 1.00) → QuickPick "Użyj zapisanego system prompt?" (Y/N) → jeśli N: showInputBox → QuickPick meta-prompt (editable textbox) → start |
| `ccPanel.stopAutoAccept` | Jeśli aktywny — QuickPick "Stop (bez Ctrl+C)" / "Stop + Ctrl+C do T#" / "Anuluj" |
| `ccPanel.editAutoAcceptSystemPrompt` | InputBox multiline, persist do `ustawienia.json` |
| `ccPanel.showAutoAcceptHistory` | Czyta `aa-sessions.jsonl`, pokazuje QuickPick z ostatnimi 20 sesjami (data, terminal, iterations, cost); wybór → otwiera JSON w edytorze |
| `ccPanel.autoAcceptStatus` | InformationMessage z aktualnym stanem (aktywny T#, iter N/limit, cost $X/$Y, time left) lub "AA nieaktywny" |

## Hard-stop conditions (każdy → `dispose()` + banner "AA: stopped (reason)")

1. **Time**: `Date.now() - startedAt > timeLimitMs`
2. **Iterations**: MVP cap = 50 (configurable później)
3. **Cost**: cumulative cost z `state.{id}.json` od startu > budżet $
4. **Repetition**: CircuitBreaker wykrywa 3 kolejne podobne outputy (Levenshtein ratio > 0.85)
5. **User stop**: `ccPanel.stopAutoAccept`
6. **Panel dispose**: webview zamknięty → abort pending execFile + dispose session
7. **Error**: `claude -p` exit code != 0 trzy razy z rzędu

## Semantyka interrupt

- In-flight `execFile` owinięty `AbortController` — `abort()` na dispose/stop
- Ctrl+C do T1 **opcjonalny** przy stop (QuickPick, nie default) — user może chcieć zostawić CC w trakcie odpowiedzi
- Nowy trigger podczas trwającego dispatch = **skip** (nie kolejkujemy, logujemy `skipped-busy`)

## Scope cap (MVP)

- **Jedna aktywna sesja AA naraz** (nie per-terminal). Start gdy inna aktywna → InformationMessage "AA już działa na T#, zatrzymaj najpierw".
- Uzasadnienie: sekwencyjność diagnozy, prostsze logi, brak race na `execFile`.

## Edge detection (szczegół 2a)

```typescript
// TriggerDetector.ts
class TriggerDetector {
  private lastPhase = new Map<TerminalId, 'working' | 'waiting' | undefined>();

  onStateChange(id: TerminalId, newPhase: 'working' | 'waiting') {
    const prev = this.lastPhase.get(id);
    this.lastPhase.set(id, newPhase);
    if (prev === 'working' && newPhase === 'waiting') {
      this.emitter.fire({ id, timestamp: Date.now() });
    }
  }
}
```

Podpięte pod `StateWatcher.onChange` — filtruje event tylko dla terminala objętego AA.

## Format logu JSONL (`~/.claude/cc-panel/aa-sessions.jsonl`)

```json
{"t":"2026-04-20T10:00:00Z","type":"session-start","sessionId":"...","terminalId":1,"config":{"timeLimitMs":300000,"costLimitUsd":1.0,"systemPrompt":"...","metaPrompt":"..."}}
{"t":"2026-04-20T10:00:15Z","type":"trigger","sessionId":"...","terminalId":1,"iter":1,"reason":"waiting-edge","reactionMs":12500}
{"t":"2026-04-20T10:00:18Z","type":"haiku-response","sessionId":"...","iter":1,"output":"...","costUsd":0.002,"durationMs":2800}
{"t":"2026-04-20T10:00:18Z","type":"send-to-t1","sessionId":"...","iter":1,"text":"..."}
{"t":"2026-04-20T10:15:00Z","type":"session-stop","sessionId":"...","reason":"time-limit","totalIter":8,"totalCostUsd":0.18}
```

## Kolejność implementacji

1. **`HaikuHeadlessClient.ts`** — samodzielnie testowalny: `execFile('claude',['-p','--output-format','json','--model','haiku'])`, stdin = prompt, parse stdout JSON → `{result, total_cost_usd, duration_ms, usage}` (pola potwierdzone smoke testem 2026-04-20; pole z tekstem to `result`, NIE `text`). Timeout 60s, AbortController. **Test ręczny**: wywołać raz, zobaczyć czy CLI odpowiada.
2. **`SessionLogger.ts`** — `fs.appendFileSync` do JSONL. Prosty, trywialny.
3. **`TriggerDetector.ts`** — subscribe do StateWatcher, test przez ręczne przełączenie phase w state.json.
4. **`BudgetEnforcer.ts` + `CircuitBreaker.ts`** — pure logic, unit-testable (jeśli byłyby testy; tu F5 manual).
5. **`AutoAcceptSession.ts`** — orkiestrator składający wszystko.
6. **Command Palette wiring** w `extension.ts` — 5 komend, keybinding Ctrl+Alt+A.
7. **Banner w webview** — ostatni, kosmetyczny.

## Co NIE wchodzi w MVP

- Notion logging (→ 4b w przyszłości)
- Multi-model evaluation (rotacja Haiku/Sonnet/Opus jako asystent)
- Per-terminal równoległe AA (scope cap: single active)
- Automatyczna eskalacja do większego modelu przy powtórzeniach
- Webview UI do edycji promptu (tylko Command Palette)

## Persystencja w `ustawienia.json`

```json
{
  "userCommands": [],
  "messages": [],
  "projectPaths": [],
  "autoAccept": {
    "systemPrompt": "Jesteś asystentem kontynuującym pracę użytkownika. Bądź zwięzły, nie wymyślaj wymagań.",
    "lastConfig": {
      "timeLimitMs": 900000,
      "costLimitUsd": 5.0,
      "maxIterations": 50
    }
  }
}
```

## Otwarte pytania (zatrzymanie wymagało decyzji)

Przed startem implementacji user ma podjąć 3 decyzje:

1. **Budżet domyślny:** domyślne wartości (15 min / $1.00 / 50 iter) — akceptowalne dla MVP, czy chcesz inne (np. 5 min / $0.50 jako bezpieczniejszy start)?
2. **Keybinding `Ctrl+Alt+A`:** wolny w Twoim VS Code, czy koliduje z innym skrótem? Alternatywy: `Ctrl+Alt+Shift+A`, brak keybindingu (tylko Command Palette).
3. **Scope cap:** jedna aktywna sesja globalnie (prostsze), czy per-terminal (można np. równolegle iterować T1 i T3)? MVP zakłada single-active.

## Decyzje odłożone z wcześniejszych sesji

Z transkryptu `31aca16c...` (19-04 ~23:20):

- **Debounce 3 sekundy** przed triggerem Haiku — kompromis między natychmiastową reakcją a szansą usera na samodzielny wpis. Wartość może się zmienić po testach; domyślnie 3000 ms.
- **Reset tygodniowy budżetu:** ISO week (poniedziałek UTC) vs. niedziela lokalnie vs. rolling 7 dni — do decyzji jeśli dodamy weekly limit (nie w MVP, MVP liczy tylko per-sesja).

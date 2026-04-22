(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();

  const frame       = document.getElementById("frame");
  const inputLine   = document.getElementById("input-text");
  const dataList    = document.getElementById("cmd-list");
  const btnSend     = document.getElementById("btn-send");
  const btnEsc      = document.getElementById("btn-esc");
  const btnCtrlC    = document.getElementById("btn-ctrlc");
  const termChips    = Array.from(document.querySelectorAll(".chip-t"));
  const folderSpans  = Array.from(document.querySelectorAll(".chip-term-folder"));
  const aaBanner    = document.getElementById("aa-banner");
  const aaTermEl    = document.getElementById("aa-banner-term");
  const aaIterEl    = document.getElementById("aa-banner-iter");
  const aaCostEl    = document.getElementById("aa-banner-cost");
  const aaTimeEl    = document.getElementById("aa-banner-time");
  const aaStopBtn   = document.getElementById("aa-banner-stop");
  const ctxMenu     = document.getElementById("ctx-menu");

  let activeTermId = 1;
  const enabledTerms = new Set([1]);
  let dashboardState = {};
  const unreadTerms = new Set();
  const lastSeenMessageAt = new Map();
  let aaStatus = null;
  let aaClockTimer = null;
  let aaHideTimer = null;
  /** Map<termId, Date> — moment wejścia w fazę waiting (start licznika) */
  const waitingSince = new Map();
  let waitTimerInterval = null;

  // Stan list — aktualizowane partiami przez setSlashCommands / setUserLists
  let _slashItems    = [];
  let _slashDropdown = [];
  let _userItems     = [];
  let _textItems     = [];
  let _history       = [];
  let _usageStats    = {};

  /**
   * Buduje datalist z 3 sekcjami, dedup po `value`:
   *  1) ⏱ Historia — top 20 ostatnio użytych (history[] z UserListsStore, już dedup+cap 100)
   *  2) ⭐ Najczęstsze — top 10 wg usageStats.count (pomija te już w Historia)
   *  3) Reszta — slash+user+messages, sortowane po count DESC (stabilne dla równych)
   * Priorytet deduplikacji: Historia > Najczęstsze > reszta.
   * `<datalist>` w Chromium/Electron renderuje w kolejności DOM — sekcje zachowują kolejność.
   */
  function rebuildDatalist() {
    dataList.innerHTML = "";
    const used = new Set();

    const appendOpt = (value, label) => {
      if (!value || used.has(value)) return;
      used.add(value);
      const opt = document.createElement("option");
      opt.value = value;
      if (label && label !== value) opt.label = label;
      dataList.appendChild(opt);
    };

    // Sekcja 1: Historia (ostatnio wpisane)
    const histTop = _history.slice(0, 20);
    for (const value of histTop) {
      appendOpt(value, `⏱ ${value}`);
    }

    // Sekcja 2: Najczęstsze (top 10 wg count, pomijając już dodane z history)
    const statsEntries = Object.entries(_usageStats)
      .filter(([v]) => !used.has(v))
      .sort((a, b) => b[1].count - a[1].count || b[1].lastUsedAt - a[1].lastUsedAt)
      .slice(0, 10);
    for (const [value, stat] of statsEntries) {
      appendOpt(value, `⭐ ${value} (${stat.count})`);
    }

    // Sekcja 3: reszta — slash+user+messages, sort po count DESC
    const slash = _slashDropdown.length ? _slashDropdown : _slashItems;
    const rest = [];
    for (const it of slash)      rest.push({ label: it.label, value: it.value });
    for (const it of _userItems) rest.push({ label: it.label, value: it.value });
    for (const it of _textItems) rest.push({ label: it.label, value: it.text });

    rest.sort((a, b) => {
      const ca = (_usageStats[a.value]?.count) || 0;
      const cb = (_usageStats[b.value]?.count) || 0;
      return cb - ca;
    });

    for (const it of rest) {
      appendOpt(it.value, it.label);
    }
  }

  function refreshAllItems() {
    rebuildDatalist();
  }

  // ── Foldery projektów ───────────────────────────────────────────────────

  function renderFolders(paths) {
    for (const span of folderSpans) {
      const id = Number(span.dataset.id);
      const p = (paths && paths[id - 1]) || "";
      const base = p ? p.replace(/\\/g, "/").split("/").pop() : "";
      span.textContent = base.length > 14 ? base.slice(0, 13) + "…" : base;
      span.title = p || "";
    }
  }

  // ── Terminale ───────────────────────────────────────────────────────────

  function setTerminals(ids) {
    const s = new Set(ids.map(Number));
    enabledTerms.clear();
    for (const v of s) enabledTerms.add(v);
    for (const c of termChips) {
      const id = Number(c.dataset.id);
      c.hidden = !s.has(id);
    }
  }

  function setActive(id) {
    const n = Number(id);
    if (!(n >= 1 && n <= 4)) return;
    activeTermId = n;
    frame.classList.remove("frame-t1", "frame-t2", "frame-t3", "frame-t4");
    frame.classList.add(`frame-t${n}`);
    for (const c of termChips) c.classList.toggle("is-active", Number(c.dataset.id) === n);
    unreadTerms.delete(n);
    renderDashboard();
  }

  // ── Dashboard — metryki w chipach ───────────────────────────────────────

  function renderDashboard() {
    let anyWaiting = false;
    for (const chip of termChips) {
      const id = Number(chip.dataset.id);
      chip.dataset.unread = unreadTerms.has(id) ? "true" : "false";
      const snap = dashboardState[id];
      const phase = snap && (snap.phase === "working" || snap.phase === "waiting") ? snap.phase : "idle";
      chip.dataset.phase = phase;
      chip.dataset.working = phase === "working" ? "true" : "false";

      // Synchronizuj waitingSince na podstawie lastMessageAt + fazy.
      // Guard: ignoruj stale timestampy (starsze niż 2h) — zwykle pochodzą z state.{id}.json
      // zapisanego w poprzedniej sesji VS Code / przed rebootem maszyny.
      const STALE_MS = 2 * 60 * 60 * 1000;
      if (phase === "waiting" && snap && snap.lastMessageAt) {
        const ts = new Date(snap.lastMessageAt);
        const fresh = Date.now() - ts.getTime() < STALE_MS;
        if (fresh) {
          const prev = waitingSince.get(id);
          if (!prev || prev.toISOString() !== snap.lastMessageAt) {
            waitingSince.set(id, ts);
          }
          anyWaiting = true;
        } else {
          waitingSince.delete(id);
        }
      } else if (phase !== "waiting") {
        waitingSince.delete(id);
      }

      const timerEl = chip.querySelector(".chip-wait-timer");
      const folderEl = chip.querySelector(".chip-term-folder");
      if (folderEl) folderEl.hidden = false;
      if (phase === "waiting" && waitingSince.has(id)) {
        if (timerEl) {
          timerEl.hidden = false;
          timerEl.textContent = formatWaitTime(Date.now() - waitingSince.get(id).getTime());
        }
      } else {
        if (timerEl) timerEl.hidden = true;
      }

      // Metryki wiersz 2: cost · tokens · ctx
      const costEl = chip.querySelector(".chip-term-cost");
      const tokEl  = chip.querySelector(".chip-term-tokens");
      const ctxEl  = chip.querySelector(".chip-term-ctx");
      if (costEl) costEl.textContent = formatMetric(snap, "cost");
      if (tokEl)  tokEl.textContent  = formatMetric(snap, "total");
      if (ctxEl)  ctxEl.textContent  = formatMetric(snap, "ctx");
    }

    // Globalny interval: odświeżaj timery co sekundę gdy ktokolwiek czeka
    if (anyWaiting && !waitTimerInterval) {
      waitTimerInterval = setInterval(tickWaitTimers, 1000);
    } else if (!anyWaiting && waitTimerInterval) {
      clearInterval(waitTimerInterval);
      waitTimerInterval = null;
    }
  }

  function formatMetric(snap, metric) {
    if (!snap) return "—";
    if (metric === "ctx") {
      return typeof snap.ctxPct === "number" ? `${snap.ctxPct}%` : "—";
    }
    if (metric === "cost") {
      return typeof snap.costUsd === "number" ? `$${snap.costUsd.toFixed(2)}` : "—";
    }
    if (metric === "total") {
      return typeof snap.totalTokens === "number" ? formatTokens(snap.totalTokens) : "—";
    }
    return "—";
  }

  function formatTokens(n) {
    if (n < 1000) return String(n);
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(2)}M`;
  }

  function formatWaitTime(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m < 60) return `${m}:${String(rs).padStart(2, "0")}`;
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return `${h}h${String(rm).padStart(2, "0")}m`;
  }

  function tickWaitTimers() {
    for (const chip of termChips) {
      const id = Number(chip.dataset.id);
      if (chip.dataset.phase !== "waiting") continue;
      const since = waitingSince.get(id);
      if (!since) continue;
      const timerEl = chip.querySelector(".chip-wait-timer");
      if (timerEl && !timerEl.hidden) {
        timerEl.textContent = formatWaitTime(Date.now() - since.getTime());
      }
    }
  }

  function applyDashboard(map) {
    dashboardState = map || {};
    for (const idStr of Object.keys(dashboardState)) {
      const id = Number(idStr);
      const snap = dashboardState[id];
      if (!snap || !snap.lastMessageAt) continue;
      const prev = lastSeenMessageAt.get(id);
      if (prev !== snap.lastMessageAt) {
        lastSeenMessageAt.set(id, snap.lastMessageAt);
        if (id !== activeTermId) unreadTerms.add(id);
      }
    }
    renderDashboard();
  }

  // ── Auto-Accept banner ──────────────────────────────────────────────────

  function applyAutoAccept(status) {
    aaStatus = status;
    clearAaHideTimer();
    if (!status) {
      aaBanner.hidden = true;
      stopAaClock();
      return;
    }
    const visible = status.active || !!status.lastError;
    aaBanner.hidden = !visible;
    if (!visible) {
      stopAaClock();
      return;
    }
    aaBanner.dataset.state = status.active ? "active" : "stopped";
    renderAaMetrics();
    if (status.active && status.timeLimitMs !== null) {
      startAaClock();
    } else {
      stopAaClock();
      renderAaTime();
    }
    if (!status.active) {
      aaHideTimer = setTimeout(() => {
        aaBanner.hidden = true;
        aaHideTimer = null;
      }, 5000);
    }
  }

  function clearAaHideTimer() {
    if (aaHideTimer) {
      clearTimeout(aaHideTimer);
      aaHideTimer = null;
    }
  }

  function renderAaMetrics() {
    if (!aaStatus) return;
    aaTermEl.textContent = aaStatus.terminalId != null ? `T${aaStatus.terminalId}` : "T?";
    aaTermEl.className = "aa-banner-term";
    if (aaStatus.terminalId) aaTermEl.classList.add(`chip-t${aaStatus.terminalId}`);
    // --t-color na poziomie bannera → dot, label, ramka dziedziczą kolor terminala AA
    aaBanner.className = "aa-banner";
    if (aaStatus.terminalId) aaBanner.classList.add(`chip-t${aaStatus.terminalId}`);

    const iterLimit = aaStatus.maxIterations;
    const iterStr = iterLimit === null ? `${aaStatus.iterationsUsed}/∞` : `${aaStatus.iterationsUsed}/${iterLimit}`;
    aaIterEl.textContent = `iter ${iterStr}`;
    aaIterEl.classList.toggle("is-limit-near", iterLimit !== null && aaStatus.iterationsUsed >= iterLimit * 0.9);

    const costLimit = aaStatus.costLimitUsd;
    const costStr = costLimit === null
      ? `$${aaStatus.cumulativeCostUsd.toFixed(2)}/∞`
      : `$${aaStatus.cumulativeCostUsd.toFixed(2)}/$${costLimit.toFixed(2)}`;
    aaCostEl.textContent = costStr;
    aaCostEl.classList.toggle("is-limit-near", costLimit !== null && aaStatus.cumulativeCostUsd >= costLimit * 0.9);

    renderAaTime();
  }

  function renderAaTime() {
    if (!aaStatus) return;
    if (!aaStatus.active) {
      aaTimeEl.textContent = aaStatus.lastError ? `stopped: ${truncate(aaStatus.lastError, 40)}` : "stopped";
      aaTimeEl.classList.remove("is-limit-near");
      return;
    }
    if (aaStatus.timeLimitMs === null || aaStatus.startedAt === null) {
      aaTimeEl.textContent = "time ∞";
      aaTimeEl.classList.remove("is-limit-near");
      return;
    }
    const leftMs = (aaStatus.startedAt + aaStatus.timeLimitMs) - Date.now();
    if (leftMs <= 0) {
      aaTimeEl.textContent = "time 0s";
      aaTimeEl.classList.add("is-limit-near");
      return;
    }
    aaTimeEl.textContent = `time ${formatDuration(leftMs)}`;
    aaTimeEl.classList.toggle("is-limit-near", leftMs < 60_000);
  }

  function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rest = s % 60;
    if (m < 60) return `${m}m${rest.toString().padStart(2, "0")}s`;
    const h = Math.floor(m / 60);
    return `${h}h${(m % 60).toString().padStart(2, "0")}m`;
  }

  function truncate(s, n) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function startAaClock() {
    if (aaClockTimer) return;
    aaClockTimer = setInterval(renderAaTime, 1000);
  }
  function stopAaClock() {
    if (aaClockTimer) {
      clearInterval(aaClockTimer);
      aaClockTimer = null;
    }
  }

  aaStopBtn.addEventListener("click", () => {
    vscode.postMessage({ type: "stopAutoAccept" });
  });

  // ── Context menu (prawy klik na chipie) ────────────────────────────────

  function buildCtxMenuItems() {
    const items = [];
    // Sekcja 1: Historia
    const histTop = _history.slice(0, 10);
    if (histTop.length) {
      items.push({ section: "Historia" });
      for (const v of histTop) items.push({ value: v, label: v });
    }
    // Sekcja 2: Slash commands
    const slash = _slashDropdown.length ? _slashDropdown : _slashItems;
    if (slash.length) {
      items.push({ section: "Slash commands" });
      for (const it of slash.slice(0, 20)) items.push({ value: it.value, label: it.label || it.value });
    }
    // Sekcja 3: User commands
    if (_userItems.length) {
      items.push({ section: "Komendy" });
      for (const it of _userItems) items.push({ value: it.value, label: it.label || it.value });
    }
    // Sekcja 4: Messages
    if (_textItems.length) {
      items.push({ section: "Wiadomości" });
      for (const it of _textItems) items.push({ value: it.text, label: it.label || it.text });
    }
    return items;
  }

  let ctxMenuTargetId = null;

  function openCtxMenu(chipId, x, y) {
    ctxMenuTargetId = chipId;
    ctxMenu.innerHTML = "";
    const items = buildCtxMenuItems();
    for (const item of items) {
      const li = document.createElement("li");
      if (item.section) {
        li.className = "ctx-menu-section";
        li.textContent = item.section;
      } else {
        li.textContent = item.label;
        li.title = item.value;
        li.addEventListener("click", () => {
          closeCtxMenu();
          const text = item.value;
          vscode.postMessage({ type: "sendRaw", text: text + "\r" });
        });
      }
      ctxMenu.appendChild(li);
    }
    // Pozycjonuj menu — nie wychodź poza viewport
    ctxMenu.hidden = false;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const mw = ctxMenu.offsetWidth || 220;
    const mh = ctxMenu.offsetHeight || 200;
    ctxMenu.style.left = `${Math.min(x, vw - mw - 4)}px`;
    ctxMenu.style.top  = `${Math.min(y, vh - mh - 4)}px`;
  }

  function closeCtxMenu() {
    ctxMenu.hidden = true;
    ctxMenuTargetId = null;
  }

  // Nasłuch contextmenu na wszystkich chipach
  for (const c of termChips) {
    c.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const id = Number(c.dataset.id);
      if (!enabledTerms.has(id)) return;
      // Przełącz aktywny terminal na kliknięty chip
      vscode.postMessage({ type: "selectTerminal", id });
      openCtxMenu(id, e.clientX, e.clientY);
    });
  }

  // Zamknij menu przy kliknięciu poza nim
  document.addEventListener("click", (e) => {
    if (!ctxMenu.hidden && !ctxMenu.contains(e.target)) {
      closeCtxMenu();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCtxMenu();
  });

  // ── Wysyłanie ───────────────────────────────────────────────────────────

  function doSend() {
    const text = inputLine.value.trim();
    if (!text) return;
    // sendRaw w extension.ts sam woła recordCommand — nie duplikujemy postMessage
    vscode.postMessage({ type: "sendRaw", text: text + "\r" });
    inputLine.value = "";
  }

  // ── Eventy UI ───────────────────────────────────────────────────────────

  for (const c of termChips) {
    c.addEventListener("click", () => {
      const id = Number(c.dataset.id);
      if (enabledTerms.has(id)) {
        vscode.postMessage({ type: "selectTerminal", id });
      } else {
        vscode.postMessage({ type: "addTerminal", id });
      }
    });
  }

  btnSend.addEventListener("click", doSend);

  inputLine.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doSend();
    }
  });

  btnEsc.addEventListener("click", () => {
    vscode.postMessage({ type: "sendKeystroke", name: "esc" });
    inputLine.value = "";
    inputLine.focus();
  });
  btnCtrlC.addEventListener("click", () => {
    vscode.postMessage({ type: "sendKeystroke", name: "ctrlC" });
    inputLine.value = "";
    inputLine.focus();
  });

  // ── Wiadomości z ekstensji ──────────────────────────────────────────────

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "init":
        setTerminals(msg.terminals || [1]);
        setActive(msg.activeId || 1);
        _slashItems    = msg.slashCommands || [];
        _slashDropdown = msg.slashDropdown || [];
        _userItems     = msg.userCommands  || [];
        _textItems     = msg.messages      || [];
        _history       = msg.history       || [];
        _usageStats    = msg.usageStats    || {};
        refreshAllItems();
        applyDashboard(msg.dashboard || {});
        renderFolders(msg.projectPaths || ["", "", "", ""]);
        applyAutoAccept(msg.autoAccept || null);
        break;
      case "setActive":
        setActive(msg.id);
        break;
      case "setTerminals":
        setTerminals(msg.terminals || []);
        break;
      case "setSlashCommands":
        _slashItems = msg.slashCommands || [];
        refreshAllItems();
        break;
      case "setUserLists":
        _slashDropdown = msg.slashDropdown || [];
        _userItems     = msg.userCommands  || [];
        _textItems     = msg.messages      || [];
        _history       = msg.history       || _history;
        _usageStats    = msg.usageStats    || _usageStats;
        refreshAllItems();
        break;
      case "setDashboard":
        applyDashboard(msg.dashboard || {});
        break;
      case "setProjectPaths":
        renderFolders(msg.projectPaths || ["", "", "", ""]);
        break;
      case "setAutoAccept":
        applyAutoAccept(msg.autoAccept || null);
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
  inputLine.focus();
})();

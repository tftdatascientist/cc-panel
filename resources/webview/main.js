(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();

  const frame       = document.getElementById("frame");
  const inputLine   = document.getElementById("input-text");
  const dataList    = document.getElementById("cmd-list");
  const btnSend     = document.getElementById("btn-send");
  const btnEsc      = document.getElementById("btn-esc");
  const btnCtrlC    = document.getElementById("btn-ctrlc");
  const btnDash     = document.getElementById("btn-dash");
  const lastMsgBody = document.getElementById("last-msg-body");
  const lastMsgMeta = document.getElementById("last-msg-meta");
  const dashCells    = Array.from(document.querySelectorAll(".dash-cell"));
  const termChips    = Array.from(document.querySelectorAll(".chip-t"));
  const folderSpans  = Array.from(document.querySelectorAll(".chip-term-folder"));
  const aaBanner    = document.getElementById("aa-banner");
  const aaTermEl    = document.getElementById("aa-banner-term");
  const aaIterEl    = document.getElementById("aa-banner-iter");
  const aaCostEl    = document.getElementById("aa-banner-cost");
  const aaTimeEl    = document.getElementById("aa-banner-time");
  const aaStopBtn   = document.getElementById("aa-banner-stop");

  let activeTermId = 1;
  const enabledTerms = new Set([1]);
  let dashboardState = {};
  const unreadTerms = new Set();
  const lastSeenMessageAt = new Map();
  let aaStatus = null;
  let aaClockTimer = null;
  let aaHideTimer = null;

  const prevState = vscode.getState && vscode.getState();
  let dashCollapsed = !!(prevState && prevState.dashCollapsed);
  applyDashToggle();

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
      c.classList.toggle("is-disabled", !s.has(id));
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

  // ── Dashboard ───────────────────────────────────────────────────────────

  function applyDashToggle() {
    frame.classList.toggle("dash-collapsed", dashCollapsed);
    if (btnDash) btnDash.textContent = dashCollapsed ? "▲" : "▼";
    if (vscode.setState) vscode.setState({ dashCollapsed });
  }

  function renderDashboard() {
    for (const cell of dashCells) {
      const id = Number(cell.dataset.id);
      const metric = cell.dataset.metric;
      const snap = dashboardState[id];
      cell.dataset.active = id === activeTermId ? "true" : "false";
      cell.dataset.stale = snap && snap.phase === "working" ? "true" : "false";
      cell.textContent = formatMetric(snap, metric);
    }
    for (const chip of termChips) {
      const id = Number(chip.dataset.id);
      chip.dataset.unread = unreadTerms.has(id) ? "true" : "false";
      const snap = dashboardState[id];
      // Dwa stany fazy — working/waiting — każdy ma osobną, wyraźną sygnalizację.
      // Brak snap lub inna faza = "idle" (np. zaraz po starcie terminala przed pierwszym hookiem).
      const phase = snap && (snap.phase === "working" || snap.phase === "waiting") ? snap.phase : "idle";
      chip.dataset.phase = phase;
      // Kompat wstecznie — istniejący CSS aa-banner, itp. czyta data-working
      chip.dataset.working = phase === "working" ? "true" : "false";
      const ctxEl = chip.querySelector(".chip-term-ctx");
      if (ctxEl) ctxEl.textContent = formatMetric(snap, "ctx");
    }
    const active = dashboardState[activeTermId];
    if (active && active.lastMessage) {
      lastMsgBody.textContent = active.lastMessage;
      lastMsgMeta.textContent = formatMeta(active);
    } else {
      lastMsgBody.textContent = "—";
      lastMsgMeta.textContent = "";
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

  function formatMeta(snap) {
    const parts = [];
    if (snap.model) parts.push(snap.model.replace(/^claude-/, ""));
    if (snap.lastMessageAt) {
      const t = new Date(snap.lastMessageAt);
      if (!isNaN(t.getTime())) parts.push(t.toLocaleTimeString());
    }
    return parts.join(" · ");
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

  if (btnDash) {
    btnDash.addEventListener("click", () => {
      dashCollapsed = !dashCollapsed;
      applyDashToggle();
    });
  }

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

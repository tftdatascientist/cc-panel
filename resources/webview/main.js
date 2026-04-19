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
  const dashCells   = Array.from(document.querySelectorAll(".dash-cell"));
  const termChips   = Array.from(document.querySelectorAll(".chip-t"));

  let activeTermId = 1;
  const enabledTerms = new Set([1]);
  let dashboardState = {};
  const unreadTerms = new Set();
  const lastSeenMessageAt = new Map();

  const prevState = vscode.getState && vscode.getState();
  let dashCollapsed = !!(prevState && prevState.dashCollapsed);
  applyDashToggle();

  // Wszystkie komendy w jednej liście: slash commands + user commands + messages
  let allItems = [];

  function rebuildDatalist() {
    dataList.innerHTML = "";
    for (const it of allItems) {
      const opt = document.createElement("option");
      opt.value = it.value ?? it.text ?? "";
      if (it.label && it.label !== opt.value) opt.label = it.label;
      dataList.appendChild(opt);
    }
  }

  function mergeAllItems({ slashItems = [], slashDropdown = [], userItems = [], textItems = [] }) {
    // Priorytet: własna lista slash (ustawienia.json) > statyczna > user commands > messages
    const slash = slashDropdown.length ? slashDropdown : slashItems;
    const merged = [];
    for (const it of slash)     merged.push(it);
    for (const it of userItems) merged.push(it);
    for (const it of textItems) merged.push({ label: it.label, value: it.text });
    return merged;
  }

  // Bieżące listy — aktualizowane partiami przez setSlashCommands / setUserLists
  let _slashItems    = [];
  let _slashDropdown = [];
  let _userItems     = [];
  let _textItems     = [];

  function refreshAllItems() {
    allItems = mergeAllItems({
      slashItems:    _slashItems,
      slashDropdown: _slashDropdown,
      userItems:     _userItems,
      textItems:     _textItems,
    });
    rebuildDatalist();
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
      chip.dataset.unread   = unreadTerms.has(id) ? "true" : "false";
      const snap = dashboardState[id];
      // Wskaźnik pracy: pulsujący dot gdy working
      chip.dataset.working  = (snap && snap.phase === "working") ? "true" : "false";
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

  // ── Wysyłanie ───────────────────────────────────────────────────────────

  function doSend() {
    const text = inputLine.value.trim();
    if (!text) return;
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
        refreshAllItems();
        applyDashboard(msg.dashboard || {});
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
        refreshAllItems();
        break;
      case "setDashboard":
        applyDashboard(msg.dashboard || {});
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
  inputLine.focus();
})();

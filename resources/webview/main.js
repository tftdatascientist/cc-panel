(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();

  const frame = document.getElementById("frame");
  const tiles = Array.from(document.querySelectorAll(".tile"));
  const infobars = Array.from(document.querySelectorAll(".infobar"));
  const buttonGrid = document.getElementById("button-grid");
  const messagesFeed = document.getElementById("messages-feed");
  const enabledTerminals = new Set([1]);

  function setActive(id) {
    const n = Number(id);
    if (!(n >= 1 && n <= 4)) return;
    document.body.dataset.active = String(n);
    frame.classList.remove("frame-t1", "frame-t2", "frame-t3", "frame-t4");
    frame.classList.add(`frame-t${n}`);
    for (const tile of tiles) {
      tile.classList.toggle("is-active", Number(tile.dataset.id) === n);
    }
  }

  function setTerminals(ids) {
    const set = new Set(ids.map(Number));
    enabledTerminals.clear();
    for (const v of set) enabledTerminals.add(v);
    for (const tile of tiles) {
      const id = Number(tile.dataset.id);
      const enabled = set.has(id);
      tile.classList.toggle("is-disabled", !enabled);
      tile.disabled = false;
      const phaseEl = tile.querySelector(".tile-phase");
      if (phaseEl && !enabled) phaseEl.textContent = "+ add";
    }
    for (const bar of infobars) {
      const id = Number(bar.dataset.id);
      bar.classList.toggle("is-disabled", !set.has(id));
    }
  }

  const timerIntervals = new Map();

  function formatSeconds(sec) {
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m${s.toString().padStart(2, "0")}s`;
  }

  function setPhase(id, phase, sinceMs) {
    const tile = tiles.find((t) => Number(t.dataset.id) === Number(id));
    if (!tile) return;
    const normalized = phase || "idle";
    tile.dataset.phase = normalized;
    const phaseEl = tile.querySelector(".tile-phase");
    const timerEl = tile.querySelector(".tile-timer");
    if (phaseEl) phaseEl.textContent = normalized;

    const prev = timerIntervals.get(id);
    if (prev) {
      clearInterval(prev);
      timerIntervals.delete(id);
    }

    const ticking = normalized === "working" || normalized === "waiting";
    if (!ticking || !sinceMs) {
      if (timerEl) timerEl.textContent = "";
      return;
    }

    const render = () => {
      const elapsed = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
      if (timerEl) timerEl.textContent = formatSeconds(elapsed);
    };
    render();
    timerIntervals.set(id, setInterval(render, 1000));
  }

  function setButtons(buttons) {
    if (!buttonGrid) return;
    buttonGrid.innerHTML = "";
    if (!Array.isArray(buttons) || buttons.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "Brak przycisków (skonfiguruj ccPanel.buttons)";
      buttonGrid.appendChild(hint);
      return;
    }
    let currentSection;
    let isFirst = true;
    buttons.forEach((b, index) => {
      const section = b && typeof b.section === "string" ? b.section.trim() : "";
      const normalized = section.length > 0 ? section : undefined;
      if (normalized !== currentSection) {
        currentSection = normalized;
        if (normalized !== undefined) {
          const header = document.createElement("div");
          header.className = "section-header";
          if (isFirst) header.classList.add("section-header-first");
          header.textContent = normalized;
          buttonGrid.appendChild(header);
        } else if (!isFirst) {
          const sep = document.createElement("div");
          sep.className = "section-separator";
          buttonGrid.appendChild(sep);
        }
      }
      isFirst = false;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "action-btn";
      btn.dataset.index = String(index);
      btn.textContent = b && typeof b.label === "string" ? b.label : `#${index}`;
      btn.addEventListener("click", () => {
        vscode.postMessage({ type: "invokeButton", index });
      });
      buttonGrid.appendChild(btn);
    });
  }

  function formatTimestamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function appendMessage(message) {
    if (!messagesFeed || !message) return;
    const hint = messagesFeed.querySelector(".empty-hint");
    if (hint) hint.remove();

    const id = Number(message.terminalId);
    const item = document.createElement("div");
    item.className = `msg msg-t${id}`;
    item.dataset.id = String(id);

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    const label = document.createElement("span");
    label.className = "msg-label";
    label.textContent = `T${id}`;
    const ts = document.createElement("span");
    ts.className = "msg-ts";
    ts.textContent = formatTimestamp(message.at);
    meta.appendChild(label);
    meta.appendChild(ts);

    const body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = message.text || "";

    item.appendChild(meta);
    item.appendChild(body);
    messagesFeed.appendChild(item);

    while (messagesFeed.children.length > 100) {
      messagesFeed.removeChild(messagesFeed.firstElementChild);
    }
    messagesFeed.scrollTop = messagesFeed.scrollHeight;
  }

  function setMessages(messages) {
    if (!messagesFeed) return;
    messagesFeed.innerHTML = "";
    if (!Array.isArray(messages) || messages.length === 0) {
      const hint = document.createElement("div");
      hint.className = "empty-hint";
      hint.textContent = "Brak wiadomości";
      messagesFeed.appendChild(hint);
      return;
    }
    for (const m of messages) appendMessage(m);
  }

  function setMetrics(id, metrics) {
    const bar = infobars.find((b) => Number(b.dataset.id) === Number(id));
    if (bar) {
      const apply = (field, value, prefix) => {
        if (value === undefined || value === null) return;
        const el = bar.querySelector(`[data-field="${field}"]`);
        if (!el) return;
        el.textContent = prefix ? `${prefix} ${value}` : String(value);
      };
      apply("model", metrics.model);
      apply("ctx", metrics.ctx, "Ctx");
      apply("cost", metrics.cost);
      apply("mode", metrics.mode);
    }

    // ctx>=70 → czerwona ramka i tło na tile (ostrzeżenie o pamięci)
    if (typeof metrics.ctxPct === "number") {
      const tile = tiles.find((t) => Number(t.dataset.id) === Number(id));
      if (tile) tile.classList.toggle("is-ctx-warn", metrics.ctxPct >= 70);
    }
  }

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "init":
        setTerminals(msg.terminals || [1]);
        setActive(msg.activeId || 1);
        break;
      case "setActive":
        setActive(msg.id);
        break;
      case "setTerminals":
        setTerminals(msg.terminals || []);
        break;
      case "setPhase":
        setPhase(msg.id, msg.phase, msg.sinceMs);
        break;
      case "setMetrics":
        setMetrics(msg.id, msg);
        break;
      case "setButtons":
        setButtons(msg.buttons);
        break;
      case "setMessages":
        setMessages(msg.messages);
        break;
      case "addMessage":
        appendMessage(msg.message);
        break;
    }
  });

  for (const tile of tiles) {
    tile.addEventListener("click", () => {
      const id = Number(tile.dataset.id);
      if (!(id >= 1 && id <= 4)) return;
      if (enabledTerminals.has(id)) {
        vscode.postMessage({ type: "selectTerminal", id });
      } else {
        vscode.postMessage({ type: "addTerminal", id });
      }
    });
  }

  vscode.postMessage({ type: "ready" });
})();

(function () {
  // eslint-disable-next-line no-undef
  const vscode = acquireVsCodeApi();

  // Elementy
  const frame     = document.getElementById("frame");
  const inputLine = document.getElementById("input-text");
  const selMain   = document.getElementById("sel-main");
  const btnSend   = document.getElementById("btn-send");
  const selModel  = document.getElementById("sel-model");
  const selEffort = document.getElementById("sel-effort");
  const selThink  = document.getElementById("sel-think");
  const cbPlan    = document.getElementById("cb-plan");
  const btnEsc    = document.getElementById("btn-esc");
  const btnCtrlC  = document.getElementById("btn-ctrlc");
  const btnShiftTab = document.getElementById("btn-shifttab");
  const modeChips = Array.from(document.querySelectorAll(".chip-mode"));
  const termChips = Array.from(document.querySelectorAll(".chip-t"));

  // Stan
  let activeMode = "cmd";          // cmd | user | text | input
  let activeTermId = 1;
  const enabledTerms = new Set([1]);

  // Dane list
  let slashItems = [];
  let userItems  = [];
  let textItems  = [];

  // ── Tryb ────────────────────────────────────────────────────────────────────

  function setMode(mode) {
    activeMode = mode;
    for (const c of modeChips) c.classList.toggle("is-active", c.dataset.mode === mode);

    // Dropdown widoczny tylko gdy nie-input
    const showDrop = mode !== "input";
    selMain.classList.toggle("hidden", !showDrop);
    inputLine.placeholder = mode === "input"
      ? "Wpisz — Enter = wyślij do terminala"
      : "Opcjonalny tekst (Enter = wyślij dropdown)";

    rebuildDrop();
  }

  function rebuildDrop() {
    selMain.innerHTML = "";
    let items = [];
    if (activeMode === "cmd")  items = slashItems;
    if (activeMode === "user") items = userItems;
    if (activeMode === "text") items = textItems;

    if (items.length === 0) {
      const o = document.createElement("option");
      o.value = "";
      o.textContent = activeMode === "cmd"
        ? "— brak slash commands —"
        : "— brak — (edytuj w ustawienia.json)";
      selMain.appendChild(o);
      return;
    }
    items.forEach((item, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = item.label ?? item.value ?? String(i);
      o.title = item.value ?? item.text ?? "";
      selMain.appendChild(o);
    });
  }

  // ── Terminale ───────────────────────────────────────────────────────────────

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
  }

  // ── Wysyłanie ───────────────────────────────────────────────────────────────

  function buildModifiers() {
    return {
      model:  selModel.value  || "",
      effort: selEffort.value || "",
      think:  selThink.value  || "",   // "" | "think" | "think harder"
      plan:   !!cbPlan.checked,
    };
  }

  function doSend() {
    if (activeMode === "input") {
      // Tryb input: tekst z pola + modyfikatory
      const text = inputLine.value.trim();
      if (!text) return;
      vscode.postMessage({ type: "sendInput", options: { text, ...buildModifiers() } });
      inputLine.value = "";
      return;
    }

    // Tryby cmd/user/text: dropdown
    if (selMain.value === "") return;
    const idx = Number(selMain.value);
    if (!Number.isFinite(idx)) return;

    const extra = inputLine.value.trim(); // opcjonalny tekst doklejony po komendzie

    if (activeMode === "cmd")  vscode.postMessage({ type: "sendSlash", index: idx, extra });
    if (activeMode === "user") vscode.postMessage({ type: "sendUserCommand", index: idx, extra });
    if (activeMode === "text") vscode.postMessage({ type: "sendMessage", index: idx });
    inputLine.value = "";
  }

  // ── Eventy UI ───────────────────────────────────────────────────────────────

  for (const c of modeChips) {
    c.addEventListener("click", () => setMode(c.dataset.mode));
  }

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
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      vscode.postMessage({ type: "sendKeystroke", name: "esc" });
      inputLine.value = "";
      return;
    }
    if (e.ctrlKey && e.key === "c") {
      e.preventDefault();
      vscode.postMessage({ type: "sendKeystroke", name: "ctrlC" });
      inputLine.value = "";
      return;
    }
    if (e.shiftKey && e.key === "Tab") {
      e.preventDefault();
      vscode.postMessage({ type: "sendKeystroke", name: "shiftTab" });
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
  btnShiftTab.addEventListener("click", () => {
    vscode.postMessage({ type: "sendKeystroke", name: "shiftTab" });
    inputLine.focus();
  });

  // ── Wiadomości z ekstensji ───────────────────────────────────────────────────

  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (!msg || typeof msg.type !== "string") return;
    switch (msg.type) {
      case "init":
        setTerminals(msg.terminals || [1]);
        setActive(msg.activeId || 1);
        slashItems = msg.slashCommands || [];
        userItems  = msg.userCommands  || [];
        textItems  = msg.messages      || [];
        rebuildDrop();
        break;
      case "setActive":
        setActive(msg.id);
        break;
      case "setTerminals":
        setTerminals(msg.terminals || []);
        break;
      case "setSlashCommands":
        slashItems = msg.slashCommands || [];
        if (activeMode === "cmd") rebuildDrop();
        break;
      case "setUserLists":
        userItems = msg.userCommands || [];
        textItems = msg.messages     || [];
        if (activeMode === "user" || activeMode === "text") rebuildDrop();
        break;
    }
  });

  vscode.postMessage({ type: "ready" });
  inputLine.focus();
})();

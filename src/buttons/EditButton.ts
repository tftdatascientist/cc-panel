import * as vscode from "vscode";
import { ButtonActionType, ButtonSpec, ButtonStore } from "./ButtonStore";

type PickAction = "edit" | "new" | "delete";

interface RootPickItem extends vscode.QuickPickItem {
  action: PickAction;
  index?: number;
}

interface TypePickItem extends vscode.QuickPickItem {
  value: ButtonActionType;
}

interface IndexedPickItem extends vscode.QuickPickItem {
  index: number;
}

export async function runEditButton(store: ButtonStore): Promise<void> {
  const current = store.current();
  const items: RootPickItem[] = [
    ...current.map((b, i) => ({
      label: `$(edit) ${b.label}`,
      description: b.type,
      detail: previewValue(b),
      action: "edit" as const,
      index: i,
    })),
    { label: "$(add) Dodaj nowy przycisk", action: "new" },
  ];
  if (current.length > 0) {
    items.push({ label: "$(trash) Usuń przycisk(i)...", action: "delete" });
  }

  const picked = await vscode.window.showQuickPick(items, {
    title: "CC Panel: edytor przycisków",
    placeHolder: "Wybierz przycisk do edycji lub dodaj nowy",
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return;

  if (picked.action === "delete") {
    await runDelete(store);
    return;
  }

  const existing =
    picked.action === "edit" && picked.index !== undefined
      ? current[picked.index]
      : undefined;

  const edited = await collectSpec(existing);
  if (!edited) return;

  const target = await pickTarget();
  if (target === undefined) return;

  const next = [...current];
  if (picked.action === "edit" && picked.index !== undefined) {
    next[picked.index] = edited;
  } else {
    next.push(edited);
  }
  await store.save(next, target);
  void vscode.window.showInformationMessage(
    `CC Panel: zapisano przycisk "${edited.label}" (${describeTarget(target)}).`
  );
}

async function runDelete(store: ButtonStore): Promise<void> {
  const current = store.current();
  if (current.length === 0) {
    void vscode.window.showInformationMessage("CC Panel: brak przycisków do usunięcia.");
    return;
  }
  const items: IndexedPickItem[] = current.map((b, i) => ({
    label: b.label,
    description: b.type,
    detail: previewValue(b),
    index: i,
  }));
  const picks = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    title: "CC Panel: usuń przyciski",
    placeHolder: "Zaznacz przyciski do usunięcia",
  });
  if (!picks || picks.length === 0) return;
  const target = await pickTarget();
  if (target === undefined) return;
  const toRemove = new Set(picks.map((p) => p.index));
  const next = current.filter((_, i) => !toRemove.has(i));
  await store.save(next, target);
  void vscode.window.showInformationMessage(
    `CC Panel: usunięto ${toRemove.size} przycisk(ów) (${describeTarget(target)}).`
  );
}

async function pickTarget(): Promise<vscode.ConfigurationTarget | undefined> {
  const hasWorkspace = (vscode.workspace.workspaceFolders?.length ?? 0) > 0;
  if (!hasWorkspace) return vscode.ConfigurationTarget.Global;

  const items: Array<vscode.QuickPickItem & { target: vscode.ConfigurationTarget }> = [
    {
      label: "$(globe) Globalnie",
      description: "User Settings",
      detail: "Synchronizuje się przez Settings Sync; dotyczy wszystkich projektów",
      target: vscode.ConfigurationTarget.Global,
    },
    {
      label: "$(folder) Workspace",
      description: "Workspace Settings",
      detail: "Tylko ten projekt; nadpisuje ustawienia globalne",
      target: vscode.ConfigurationTarget.Workspace,
    },
  ];
  const pick = await vscode.window.showQuickPick(items, {
    title: "CC Panel: gdzie zapisać?",
    placeHolder: "Wybierz zakres zapisu ccPanel.buttons",
  });
  return pick?.target;
}

function describeTarget(target: vscode.ConfigurationTarget): string {
  switch (target) {
    case vscode.ConfigurationTarget.Global:
      return "user settings";
    case vscode.ConfigurationTarget.Workspace:
      return "workspace settings";
    case vscode.ConfigurationTarget.WorkspaceFolder:
      return "workspace folder settings";
    default:
      return "?";
  }
}

async function collectSpec(existing?: ButtonSpec): Promise<ButtonSpec | undefined> {
  const label = await vscode.window.showInputBox({
    title: existing ? `Edycja: ${existing.label}` : "Nowy przycisk — label",
    prompt: "Nazwa wyświetlana w button grid",
    value: existing?.label ?? "",
    validateInput: (v) =>
      v.trim().length === 0 ? "Label nie może być pusty" : undefined,
  });
  if (label === undefined) return undefined;

  if (existing?.type === "multiStep") {
    void vscode.window.showInformationMessage(
      "CC Panel: edycja kroków multiStep dostępna tylko w settings.json — wizard zostawia value bez zmian."
    );
    const section = await collectSection(existing?.section);
    if (section === undefined) return undefined;
    const iconRaw = await vscode.window.showInputBox({
      title: "Ikona (opcjonalnie)",
      prompt: "Nazwa codicon — zostaw puste aby pominąć",
      value: existing.icon ?? "",
    });
    if (iconRaw === undefined) return undefined;
    const spec: ButtonSpec = {
      label: label.trim(),
      type: "multiStep",
      value: existing.value,
    };
    const iconTrim = iconRaw.trim();
    if (iconTrim.length > 0) spec.icon = iconTrim;
    if (section.length > 0) spec.section = section;
    return spec;
  }

  const typeItems: TypePickItem[] = [
    {
      label: "sendText",
      description: "wpisuje tekst + Enter",
      detail: "np. /clear, /compact, /status",
      value: "sendText",
    },
    {
      label: "keystroke",
      description: "surowe bajty bez Enter",
      detail: "np. Esc (\\u001b), Ctrl+C (\\u0003), Shift+Tab (\\u001b[Z)",
      value: "keystroke",
    },
    {
      label: "vsCodeCommand",
      description: "VS Code command ID",
      detail: "np. workbench.action.files.save, editor.action.formatDocument",
      value: "vsCodeCommand",
    },
  ];
  const typePick = await vscode.window.showQuickPick(typeItems, {
    title: "Typ akcji",
    placeHolder: existing ? `obecny: ${existing.type}` : "Wybierz typ akcji",
  });
  if (!typePick) return undefined;
  const type = typePick.value;

  const prevValue =
    existing && typeof existing.value === "string" ? existing.value : "";
  const initialValue =
    type === "keystroke" ? encodeForDisplay(prevValue) : prevValue;
  const titleForValue = {
    sendText: "Tekst do wysłania",
    keystroke: "Bajty do wysłania",
    vsCodeCommand: "VS Code command ID",
  }[type];
  const promptForValue = {
    sendText:
      "Tekst + \\r na końcu; placeholdery {input:Label} → InputBox przy kliknięciu",
    keystroke: "Wspierane escape: \\u001b, \\x1b, \\n, \\r, \\t",
    vsCodeCommand: "Command ID z Command Palette (np. workbench.action.files.save)",
  }[type];
  const rawValue = await vscode.window.showInputBox({
    title: titleForValue,
    prompt: promptForValue,
    value: initialValue,
    validateInput: (v) =>
      v.length === 0 ? "Wartość nie może być pusta" : undefined,
  });
  if (rawValue === undefined) return undefined;

  const value = type === "keystroke" ? decodeEscapes(rawValue) : rawValue;

  const section = await collectSection(existing?.section);
  if (section === undefined) return undefined;

  const iconRaw = await vscode.window.showInputBox({
    title: "Ikona (opcjonalnie)",
    prompt: "Nazwa codicon (np. 'trash', 'sync') — zostaw puste aby pominąć",
    value: existing?.icon ?? "",
  });
  if (iconRaw === undefined) return undefined;

  const spec: ButtonSpec = {
    label: label.trim(),
    type,
    value,
  };
  const iconTrim = iconRaw.trim();
  if (iconTrim.length > 0) spec.icon = iconTrim;
  if (section.length > 0) spec.section = section;
  return spec;
}

async function collectSection(current?: string): Promise<string | undefined> {
  const raw = await vscode.window.showInputBox({
    title: "Sekcja (opcjonalnie)",
    prompt: "Nagłówek grupy przycisków — puste = brak sekcji",
    value: current ?? "",
  });
  if (raw === undefined) return undefined;
  return raw.trim();
}

function previewValue(b: ButtonSpec): string {
  if (b.type === "multiStep" && Array.isArray(b.value)) {
    const steps = b.value
      .map((s) => (s.type === "keystroke" ? encodeForDisplay(s.value) : s.value))
      .join(" → ");
    return `⛓ ${b.value.length} kroków: ${steps}`;
  }
  const raw = typeof b.value === "string" ? b.value : "";
  const display = b.type === "keystroke" ? encodeForDisplay(raw) : raw;
  const icon = b.type === "keystroke" ? "⌨" : b.type === "vsCodeCommand" ? "⚙" : "➤";
  return `${icon} ${display}`;
}

function encodeForDisplay(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function decodeEscapes(input: string): string {
  return input
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t");
}

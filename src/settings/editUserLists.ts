import * as vscode from "vscode";
import {
  MessageItem,
  UserCommandItem,
  UserListsStore,
} from "./UserListsStore";

type RootAction = "edit" | "new" | "delete";

interface RootPick extends vscode.QuickPickItem {
  action: RootAction;
  index?: number;
}

export async function runEditUserCommands(store: UserListsStore): Promise<void> {
  const items = store.current().userCommands;
  const picks: RootPick[] = [
    ...items.map((it, i) => ({
      label: `$(edit) ${it.label}`,
      detail: `➤ ${it.value}`,
      action: "edit" as const,
      index: i,
    })),
    { label: "$(add) Dodaj nową komendę użytkownika", action: "new" },
  ];
  if (items.length > 0) {
    picks.push({ label: "$(trash) Usuń komendy…", action: "delete" });
  }
  const picked = await vscode.window.showQuickPick(picks, {
    title: "CC Panel: komendy użytkownika",
    placeHolder: "Wybierz komendę do edycji albo dodaj nową",
  });
  if (!picked) return;

  if (picked.action === "delete") {
    await deleteUserCommands(store);
    return;
  }

  const existing =
    picked.action === "edit" && picked.index !== undefined
      ? items[picked.index]
      : undefined;
  const edited = await collectUserCommand(existing);
  if (!edited) return;

  const next = [...items];
  if (picked.action === "edit" && picked.index !== undefined) {
    next[picked.index] = edited;
  } else {
    next.push(edited);
  }
  await store.save({ ...store.current(), userCommands: next });
  void vscode.window.showInformationMessage(
    `CC Panel: zapisano komendę "${edited.label}".`
  );
}

export async function runEditMessages(store: UserListsStore): Promise<void> {
  const items = store.current().messages;
  const picks: RootPick[] = [
    ...items.map((it, i) => ({
      label: `$(edit) ${it.label}`,
      detail: preview(it.text),
      action: "edit" as const,
      index: i,
    })),
    { label: "$(add) Dodaj nową wiadomość", action: "new" },
  ];
  if (items.length > 0) {
    picks.push({ label: "$(trash) Usuń wiadomości…", action: "delete" });
  }
  const picked = await vscode.window.showQuickPick(picks, {
    title: "CC Panel: gotowe wiadomości",
    placeHolder: "Wybierz wiadomość do edycji albo dodaj nową",
  });
  if (!picked) return;

  if (picked.action === "delete") {
    await deleteMessages(store);
    return;
  }

  const existing =
    picked.action === "edit" && picked.index !== undefined
      ? items[picked.index]
      : undefined;
  const edited = await collectMessage(existing);
  if (!edited) return;

  const next = [...items];
  if (picked.action === "edit" && picked.index !== undefined) {
    next[picked.index] = edited;
  } else {
    next.push(edited);
  }
  await store.save({ ...store.current(), messages: next });
  void vscode.window.showInformationMessage(
    `CC Panel: zapisano wiadomość "${edited.label}".`
  );
}

async function deleteUserCommands(store: UserListsStore): Promise<void> {
  const items = store.current().userCommands;
  const picks = await vscode.window.showQuickPick(
    items.map((it, i) => ({ label: it.label, detail: `➤ ${it.value}`, index: i })),
    {
      canPickMany: true,
      title: "CC Panel: usuń komendy użytkownika",
      placeHolder: "Zaznacz komendy do usunięcia",
    }
  );
  if (!picks || picks.length === 0) return;
  const toRemove = new Set(picks.map((p) => p.index));
  const next = items.filter((_, i) => !toRemove.has(i));
  await store.save({ ...store.current(), userCommands: next });
  void vscode.window.showInformationMessage(
    `CC Panel: usunięto ${toRemove.size} komend(y).`
  );
}

async function deleteMessages(store: UserListsStore): Promise<void> {
  const items = store.current().messages;
  const picks = await vscode.window.showQuickPick(
    items.map((it, i) => ({ label: it.label, detail: preview(it.text), index: i })),
    {
      canPickMany: true,
      title: "CC Panel: usuń wiadomości",
      placeHolder: "Zaznacz wiadomości do usunięcia",
    }
  );
  if (!picks || picks.length === 0) return;
  const toRemove = new Set(picks.map((p) => p.index));
  const next = items.filter((_, i) => !toRemove.has(i));
  await store.save({ ...store.current(), messages: next });
  void vscode.window.showInformationMessage(
    `CC Panel: usunięto ${toRemove.size} wiadomość(ci).`
  );
}

async function collectUserCommand(
  existing?: UserCommandItem
): Promise<UserCommandItem | undefined> {
  const label = await vscode.window.showInputBox({
    title: existing ? `Edycja: ${existing.label}` : "Nowa komenda użytkownika — label",
    prompt: "Nazwa wyświetlana w dropdown",
    value: existing?.label ?? "",
    validateInput: (v) => (v.trim().length === 0 ? "Label nie może być pusty" : undefined),
  });
  if (label === undefined) return undefined;

  const value = await vscode.window.showInputBox({
    title: "Komenda / tekst do wysłania",
    prompt: "Wysyłane do aktywnego terminala + Enter (np. /clear, 'git status', custom slash)",
    value: existing?.value ?? "",
    validateInput: (v) => (v.length === 0 ? "Wartość nie może być pusta" : undefined),
  });
  if (value === undefined) return undefined;

  return { label: label.trim(), value };
}

async function collectMessage(
  existing?: MessageItem
): Promise<MessageItem | undefined> {
  const label = await vscode.window.showInputBox({
    title: existing ? `Edycja: ${existing.label}` : "Nowa wiadomość — label",
    prompt: "Krótka nazwa wyświetlana w dropdown",
    value: existing?.label ?? "",
    validateInput: (v) => (v.trim().length === 0 ? "Label nie może być pusty" : undefined),
  });
  if (label === undefined) return undefined;

  const text = await vscode.window.showInputBox({
    title: "Treść wiadomości",
    prompt: "Pełna treść wysyłana do CC (np. 'Wyjaśnij mi ten kod krok po kroku')",
    value: existing?.text ?? "",
    validateInput: (v) => (v.length === 0 ? "Treść nie może być pusta" : undefined),
  });
  if (text === undefined) return undefined;

  return { label: label.trim(), text };
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? flat.slice(0, 77) + "…" : flat;
}

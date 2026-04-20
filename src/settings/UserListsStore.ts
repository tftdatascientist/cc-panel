import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface UserCommandItem {
  label: string;
  value: string;
}

export interface MessageItem {
  label: string;
  text: string;
}

/** Folder projektu dla każdego terminala T1-T4 (indeks 0-3). "" = nieustawiony. */
export type ProjectPaths = [string, string, string, string];

/** Liczniki użycia per value — zasilają sekcję "⭐ Najczęstsze" w dropdownie. */
export interface UsageStat {
  count: number;
  lastUsedAt: number;
}

/** Limity deduplikacji/cap'a — trzymane tu, żeby łatwo zmienić w jednym miejscu. */
const HISTORY_CAP = 100;

export interface UserLists {
  slashDropdown: UserCommandItem[];
  userCommands: UserCommandItem[];
  messages: MessageItem[];
  projectPaths: ProjectPaths;
  /** LRU ostatnio użytych komend (najnowsza na pozycji 0), cap 100, dedup exact-match. */
  history: string[];
  /** Licznik użycia per value — ranking dla sortowania dropdownu po częstości. */
  usageStats: Record<string, UsageStat>;
}

const EMPTY: UserLists = {
  slashDropdown: [],
  userCommands: [],
  messages: [],
  projectPaths: ["", "", "", ""],
  history: [],
  usageStats: {},
};

function settingsPath(): string {
  return path.join(os.homedir(), ".claude", "cc-panel", "ustawienia.json");
}

export class UserListsStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<UserLists>();
  readonly onChange = this.emitter.event;
  private lists: UserLists = EMPTY;

  constructor() {
    this.lists = this.load();
  }

  current(): UserLists {
    return this.lists;
  }

  async saveProjectPath(terminalId: 1 | 2 | 3 | 4, p: string): Promise<void> {
    const paths: ProjectPaths = [...this.lists.projectPaths] as ProjectPaths;
    paths[terminalId - 1] = p;
    await this.save({ ...this.lists, projectPaths: paths });
  }

  /** Odnotuj użycie komendy — aktualizuje history (LRU, dedup, cap 100) i usageStats. */
  async recordCommand(value: string): Promise<void> {
    const v = value.trim();
    if (v.length === 0) return;
    const now = Date.now();

    const filtered = this.lists.history.filter((h) => h !== v);
    filtered.unshift(v);
    const history = filtered.slice(0, HISTORY_CAP);

    const prev = this.lists.usageStats[v];
    const usageStats = {
      ...this.lists.usageStats,
      [v]: {
        count: (prev?.count ?? 0) + 1,
        lastUsedAt: now,
      },
    };

    await this.save({ ...this.lists, history, usageStats });
  }

  async save(next: UserLists): Promise<void> {
    const p = settingsPath();
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify(next, null, 2) + "\n", "utf8");
      this.lists = next;
      this.emitter.fire(next);
    } catch (err) {
      void vscode.window.showErrorMessage(
        `CC Panel: nie udało się zapisać ${p} — ${(err as Error).message}`
      );
    }
  }

  reload(): void {
    this.lists = this.load();
    this.emitter.fire(this.lists);
  }

  dispose(): void {
    this.emitter.dispose();
  }

  private load(): UserLists {
    const p = settingsPath();
    if (!fs.existsSync(p)) return { ...EMPTY };
    try {
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as unknown;
      return validate(raw);
    } catch (err) {
      void vscode.window.showWarningMessage(
        `CC Panel: ustawienia.json niepoprawny JSON — ${(err as Error).message}. Używam pustych list.`
      );
      return { ...EMPTY };
    }
  }
}

function validate(raw: unknown): UserLists {
  const out: UserLists = { ...EMPTY, projectPaths: ["", "", "", ""] };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;

  if (Array.isArray(obj.slashDropdown)) {
    for (const it of obj.slashDropdown) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      if (typeof o.label !== "string" || typeof o.value !== "string") continue;
      if (o.label.trim().length === 0 || o.value.length === 0) continue;
      out.slashDropdown.push({ label: o.label, value: o.value });
    }
  }
  if (Array.isArray(obj.userCommands)) {
    for (const it of obj.userCommands) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      if (typeof o.label !== "string" || typeof o.value !== "string") continue;
      if (o.label.trim().length === 0 || o.value.length === 0) continue;
      out.userCommands.push({ label: o.label, value: o.value });
    }
  }
  if (Array.isArray(obj.messages)) {
    for (const it of obj.messages) {
      if (!it || typeof it !== "object") continue;
      const o = it as Record<string, unknown>;
      if (typeof o.label !== "string" || typeof o.text !== "string") continue;
      if (o.label.trim().length === 0 || o.text.length === 0) continue;
      out.messages.push({ label: o.label, text: o.text });
    }
  }
  // migrate legacy single projectPath → slot T1
  if (Array.isArray(obj.projectPaths)) {
    for (let i = 0; i < 4; i++) {
      const v = obj.projectPaths[i];
      if (typeof v === "string") out.projectPaths[i] = v.trim();
    }
  } else if (typeof obj.projectPath === "string" && obj.projectPath.trim().length > 0) {
    out.projectPaths[0] = obj.projectPath.trim();
  }

  // history: backward-compat — gdy brak pola, zostaje []
  if (Array.isArray(obj.history)) {
    const seen = new Set<string>();
    for (const h of obj.history) {
      if (typeof h !== "string") continue;
      const v = h.trim();
      if (v.length === 0 || seen.has(v)) continue;
      seen.add(v);
      out.history.push(v);
      if (out.history.length >= HISTORY_CAP) break;
    }
  }

  // usageStats: backward-compat — walidujemy count/lastUsedAt, odrzucamy śmieci
  if (obj.usageStats && typeof obj.usageStats === "object" && !Array.isArray(obj.usageStats)) {
    const stats = obj.usageStats as Record<string, unknown>;
    for (const [key, raw] of Object.entries(stats)) {
      if (typeof key !== "string" || key.length === 0) continue;
      if (!raw || typeof raw !== "object") continue;
      const s = raw as Record<string, unknown>;
      const count = typeof s.count === "number" && Number.isFinite(s.count) && s.count > 0 ? Math.floor(s.count) : 0;
      const lastUsedAt = typeof s.lastUsedAt === "number" && Number.isFinite(s.lastUsedAt) ? s.lastUsedAt : 0;
      if (count === 0) continue;
      out.usageStats[key] = { count, lastUsedAt };
    }
  }

  return out;
}

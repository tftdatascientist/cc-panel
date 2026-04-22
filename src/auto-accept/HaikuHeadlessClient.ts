import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import type { HaikuResponse } from "./types";

const execFileAsync = promisify(execFile);

/**
 * Odpala `claude -p --output-format json --model haiku` jako subprocess.
 *
 * Kontrakt CLI (smoke test 2026-04-20, claude 2.1.114):
 *   echo <prompt> | claude -p --output-format json --model haiku
 *   → stdout: JSON z polami result/total_cost_usd/duration_ms/usage/session_id
 *
 * Windows gotcha: `claude` to shim .cmd w AppData\Roaming\npm. execFile bez
 * shell:true nie znajdzie pliku bez rozszerzenia. Resolvujemy pełną ścieżkę
 * ręcznie z PATH (szukając claude.cmd/claude.exe/claude).
 */

const TIMEOUT_MS = 60_000;
const MAX_BUFFER = 2 * 1024 * 1024;

let resolvedClaudePath: string | null | undefined = undefined;

function resolveClaudePath(): string | null {
  if (resolvedClaudePath !== undefined) return resolvedClaudePath;

  const envPath = process.env.PATH || "";
  const sep = process.platform === "win32" ? ";" : ":";
  const candidates = process.platform === "win32"
    ? ["claude.cmd", "claude.exe", "claude"]
    : ["claude"];

  for (const dir of envPath.split(sep)) {
    if (!dir) continue;
    for (const name of candidates) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) {
          resolvedClaudePath = full;
          return full;
        }
      } catch {
        // ignore, try next
      }
    }
  }
  resolvedClaudePath = null;
  return null;
}

export class HaikuCliError extends Error {
  constructor(message: string, public readonly stderr?: string, public readonly exitCode?: number) {
    super(message);
    this.name = "HaikuCliError";
  }
}

export interface HaikuInvokeOptions {
  prompt: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function invokeHaiku(opts: HaikuInvokeOptions): Promise<HaikuResponse> {
  const claudePath = resolveClaudePath();
  if (!claudePath) {
    throw new HaikuCliError(
      "Nie znaleziono CLI `claude` w PATH. Zainstaluj Claude Code CLI i upewnij się że `claude` działa w terminalu."
    );
  }

  const args = ["-p", "--output-format", "json", "--model", "haiku"];
  if (opts.systemPrompt) {
    // --system replaces the default Claude system prompt entirely — required so Haiku
    // doesn't receive "You are Claude, an AI assistant" framing that overrides role instructions
    args.push("--system", opts.systemPrompt);
  }

  // Windows Node 20+ security hardening (CVE-2024-27980): spawn/execFile odmawia
  // uruchomienia .cmd/.bat bez shell:true. claude CLI to shim .cmd w npm global bin.
  // args są kontrolowane przez nas (nie user input), więc shell:true jest bezpieczne.
  const needsShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(claudePath);

  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const child = execFile(claudePath, args, {
    timeout: timeoutMs,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
    signal: opts.signal,
    shell: needsShell,
  });

  child.stdin?.setDefaultEncoding("utf8");
  child.stdin?.end(opts.prompt);

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", (d: Buffer | string) => { stdout += d.toString("utf8"); });
  child.stderr?.on("data", (d: Buffer | string) => { stderr += d.toString("utf8"); });

  const exitCode: number = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });

  if (exitCode !== 0) {
    throw new HaikuCliError(
      `claude CLI zakończył z exit code ${exitCode}`,
      stderr.trim() || undefined,
      exitCode
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch (e) {
    throw new HaikuCliError(
      `Nie udało się sparsować odpowiedzi claude -p jako JSON: ${(e as Error).message}`,
      stdout.slice(0, 500)
    );
  }

  if (parsed.is_error === true || parsed.subtype === "error") {
    throw new HaikuCliError(
      `claude -p zwrócił błąd: ${String(parsed.result ?? parsed.error ?? "unknown")}`,
      JSON.stringify(parsed).slice(0, 500)
    );
  }

  const usage = (parsed.usage ?? {}) as Record<string, unknown>;
  return {
    result: String(parsed.result ?? ""),
    totalCostUsd: Number(parsed.total_cost_usd ?? 0),
    durationMs: Number(parsed.duration_ms ?? 0),
    sessionId: String(parsed.session_id ?? ""),
    inputTokens: Number(usage.input_tokens ?? 0),
    outputTokens: Number(usage.output_tokens ?? 0),
    cacheCreationInputTokens: Number(usage.cache_creation_input_tokens ?? 0),
  };
}

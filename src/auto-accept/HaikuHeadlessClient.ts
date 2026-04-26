import { spawn } from "child_process";
import * as vscode from "vscode";
import type { HaikuResponse } from "./types";

/**
 * Odpala `<ccPanel.command> -p --output-format json --model haiku` jako subprocess.
 *
 * Używa spawn({ shell: true }) zamiast execFile — shell sam rozwiązuje PATH
 * (w tym .cmd shimsy npm na Windows), bez konieczności skanowania process.env.PATH
 * z poziomu VS Code extension host (który ma uboższy PATH niż terminal usera).
 *
 * Prompt przekazywany przez stdin (standardowy interfejs claude -p w print-mode).
 */

export class HaikuCliError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string,
    public readonly exitCode?: number,
  ) {
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

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_STDOUT_BYTES = 2 * 1024 * 1024;

export async function invokeHaiku(opts: HaikuInvokeOptions): Promise<HaikuResponse> {
  const command =
    vscode.workspace.getConfiguration("ccPanel").get<string>("command") ?? "claude";
  const args = ["-p", "--output-format", "json", "--model", "haiku"];
  if (opts.systemPrompt) {
    args.push("--system", opts.systemPrompt);
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const child = spawn(command, args, {
    shell: true,
    windowsHide: true,
  });

  if (opts.signal?.aborted) {
    child.kill();
    throw new HaikuCliError("Przerwano przed startem (abort signal)");
  }

  const onAbort = () => child.kill("SIGTERM");
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  child.stdin?.setDefaultEncoding("utf8");
  child.stdin?.end(opts.prompt);

  let stdout = "";
  let stderr = "";
  let stdoutBytes = 0;
  child.stdout?.on("data", (d: Buffer | string) => {
    const chunk = Buffer.isBuffer(d) ? d.toString("utf8") : d;
    stdoutBytes += chunk.length;
    if (stdoutBytes <= MAX_STDOUT_BYTES) stdout += chunk;
  });
  child.stderr?.on("data", (d: Buffer | string) => {
    const chunk = Buffer.isBuffer(d) ? d.toString("utf8") : d;
    stderr += chunk.slice(0, 2000);
  });

  const exitCode = await Promise.race<number>([
    new Promise<number>((resolve, reject) => {
      child.on("error", (err) =>
        reject(new HaikuCliError(`Nie udało się uruchomić '${command}': ${err.message}`))
      );
      child.on("close", (code) => resolve(code ?? -1));
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        child.kill("SIGTERM");
        reject(new HaikuCliError(`Timeout po ${timeoutMs}ms`));
      }, timeoutMs)
    ),
  ]);

  opts.signal?.removeEventListener("abort", onAbort);

  if (opts.signal?.aborted) {
    throw new HaikuCliError("Przerwano (abort signal)");
  }

  if (exitCode !== 0) {
    throw new HaikuCliError(
      `'${command} -p' zakończył z exit code ${exitCode}`,
      stderr.trim() || undefined,
      exitCode,
    );
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stdout) as Record<string, unknown>;
  } catch (e) {
    throw new HaikuCliError(
      `Nie udało się sparsować odpowiedzi jako JSON: ${(e as Error).message}`,
      stdout.slice(0, 500),
    );
  }

  if (parsed.is_error === true || parsed.subtype === "error") {
    throw new HaikuCliError(
      `CLI zwrócił błąd: ${String(parsed.result ?? parsed.error ?? "unknown")}`,
      JSON.stringify(parsed).slice(0, 500),
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

import * as fs from "fs";

const CONTEXT_WINDOW = 200_000;

interface PricePerMTok {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

const PRICING: Record<string, PricePerMTok> = {
  "sonnet-4": { input: 3, output: 15, cacheRead: 0.3, cacheCreation: 3.75 },
  "opus-4": { input: 15, output: 75, cacheRead: 1.5, cacheCreation: 18.75 },
  "haiku-4": { input: 1, output: 5, cacheRead: 0.1, cacheCreation: 1.25 },
};

function matchModelPricing(modelId: string): PricePerMTok {
  const id = modelId.toLowerCase();
  if (id.includes("sonnet")) return PRICING["sonnet-4"];
  if (id.includes("opus")) return PRICING["opus-4"];
  if (id.includes("haiku")) return PRICING["haiku-4"];
  return PRICING["sonnet-4"];
}

export interface TranscriptMetrics {
  model: string | null;
  ctxTokens: number;
  ctxPct: number;
  totalTokens: number;
  costUsd: number;
}

interface IncrementalCache {
  size: number;
  totalTokens: number;
  costUsd: number;
  lastModel: string | null;
  lastCtxTokens: number;
}

const cache = new Map<string, IncrementalCache>();

interface AssistantUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  output_tokens?: number;
}

interface AssistantLine {
  type?: string;
  message?: {
    model?: string;
    usage?: AssistantUsage;
  };
}

export async function readMetrics(path: string): Promise<TranscriptMetrics | null> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(path);
  } catch {
    cache.delete(path);
    return null;
  }

  const prev = cache.get(path);
  if (prev && stat.size < prev.size) {
    cache.delete(path);
  }

  const current = cache.get(path) ?? {
    size: 0,
    totalTokens: 0,
    costUsd: 0,
    lastModel: null,
    lastCtxTokens: 0,
  };

  if (stat.size === current.size) {
    return buildResult(current);
  }

  const fd = await fs.promises.open(path, "r");
  try {
    const start = current.size;
    const length = stat.size - start;
    const buf = Buffer.alloc(length);
    await fd.read(buf, 0, length, start);
    const text = buf.toString("utf8");
    parseChunkInto(text, current);
  } finally {
    await fd.close();
  }

  current.size = stat.size;
  cache.set(path, current);
  return buildResult(current);
}

function parseChunkInto(chunk: string, acc: IncrementalCache): void {
  const lines = chunk.split(/\r?\n/);
  for (const raw of lines) {
    if (!raw) continue;
    let obj: AssistantLine;
    try {
      obj = JSON.parse(raw) as AssistantLine;
    } catch {
      continue;
    }
    if (obj.type !== "assistant" || !obj.message?.usage) continue;
    const usage = obj.message.usage;
    const inp = num(usage.input_tokens);
    const cRead = num(usage.cache_read_input_tokens);
    const cCreate = num(usage.cache_creation_input_tokens);
    const out = num(usage.output_tokens);
    const ctxForThis = inp + cRead + cCreate;
    acc.totalTokens += ctxForThis + out;
    const price = matchModelPricing(obj.message.model ?? "");
    acc.costUsd +=
      (inp * price.input +
        cRead * price.cacheRead +
        cCreate * price.cacheCreation +
        out * price.output) /
      1_000_000;
    acc.lastModel = obj.message.model ?? acc.lastModel;
    acc.lastCtxTokens = ctxForThis;
  }
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function buildResult(c: IncrementalCache): TranscriptMetrics {
  return {
    model: c.lastModel,
    ctxTokens: c.lastCtxTokens,
    ctxPct: Math.min(100, Math.round((c.lastCtxTokens / CONTEXT_WINDOW) * 100)),
    totalTokens: c.totalTokens,
    costUsd: c.costUsd,
  };
}

export function resetCache(path?: string): void {
  if (path) cache.delete(path);
  else cache.clear();
}

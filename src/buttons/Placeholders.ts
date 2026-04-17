import * as vscode from "vscode";

const PLACEHOLDER_RE = /\{input:([^}]+)\}/g;

export function hasPlaceholders(value: string): boolean {
  PLACEHOLDER_RE.lastIndex = 0;
  return PLACEHOLDER_RE.test(value);
}

export function extractPlaceholderLabels(value: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(value)) !== null) {
    const label = match[1].trim();
    if (label.length === 0) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

export async function resolvePlaceholders(
  value: string,
  buttonLabel: string
): Promise<string | undefined> {
  const labels = extractPlaceholderLabels(value);
  if (labels.length === 0) return value;

  const answers = new Map<string, string>();
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const answer = await vscode.window.showInputBox({
      title: `${buttonLabel} — ${label}  (${i + 1}/${labels.length})`,
      prompt: `Wartość dla {input:${label}}`,
      ignoreFocusOut: true,
    });
    if (answer === undefined) return undefined;
    answers.set(label, answer);
  }

  return value.replace(PLACEHOLDER_RE, (full, raw: string) => {
    const label = raw.trim();
    if (label.length === 0) return full;
    return answers.get(label) ?? full;
  });
}

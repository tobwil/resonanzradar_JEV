import type { FeedItem, Question, Report } from './analysis';

export type DebugBatch = {
  id: number; startedAt: string; completedAt?: string; durationMs?: number;
  articles: FeedItem[];
  request: { model: string; state: { articles: { title: string; description: string }[] }; questions: Record<string, Question> };
  response?: { status: number; headers: Record<string, string>; bodyText: string; truncated: boolean };
  validation: { articleId: string; error: string }[];
  error?: string;
};
export type DebugRun = {
  format: 'resonanzradar-debug-v1'; method: string; startedAt: string; completedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  settings: { feedUrls: string[]; limit: number; hours: number };
  batches: DebugBatch[]; error?: string; report?: Report;
};

// Never collect request headers. Also remove the supplied key if an upstream
// error reflects it (including JSON-escaped and URL-encoded representations).
export function redactKey<T>(value: T, key: string): T {
  let json = JSON.stringify(value);
  const variants = [key, encodeURIComponent(key), JSON.stringify(key).slice(1, -1)];
  for (const variant of new Set(variants)) {
    if (variant) json = json.split(JSON.stringify(variant).slice(1, -1)).join('[REDACTED]');
  }
  return JSON.parse(json) as T;
}

export function recordBatch(run: DebugRun, batch: DebugBatch): DebugRun {
  return { ...run, batches: [...run.batches.filter((entry) => entry.id !== batch.id), batch].sort((a, b) => a.id - b.id) };
}

export function updateDebugRun(update: Partial<DebugRun>, run: DebugRun | null): DebugRun | null {
  return run ? { ...run, ...update } : null;
}

// Bound diagnostic retention even if the upstream responds with a large HTML
// error page. Partial bodies are visibly marked and never parsed as answers.
export async function readModelBody(response: Response, maxBytes = 2_000_000) {
  const reader = response.body?.getReader();
  if (!reader) return { bodyText: '', truncated: false };
  const decoder = new TextDecoder(); let bodyText = ''; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return { bodyText: bodyText + decoder.decode(), truncated: false };
      const remaining = maxBytes - size;
      bodyText += decoder.decode(value.subarray(0, remaining), { stream: true });
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return { bodyText: bodyText + decoder.decode(), truncated: true }; }
    }
  } finally { reader.releaseLock(); }
}

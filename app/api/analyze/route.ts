import { decodeAnalysis, METHOD_VERSION, questionsFor, validateAnswers, type AnalysisEvent, type AnalysisItem, type FeedInfo, type FeedItem, type Question, type Report } from '@/lib/analysis';
import { fetchFeed, parseFeed, publicUrl } from '@/lib/feeds';

export async function POST(request: Request) {
  let input: { apiKey: string; feedUrls: string[]; limit: number; hours: number };
  try {
    const body = await request.json() as Record<string, unknown>;
    const urls = body.feedUrls ?? (body.feedUrl ? [body.feedUrl] : []);
    if (typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 1000) throw new Error('Bitte einen gültigen TypeSafe API-Key eingeben.');
    if (!Array.isArray(urls) || urls.length < 1 || urls.length > 5 || urls.some((u) => typeof u !== 'string' || u.length > 2048)) throw new Error('Bitte eine bis fünf Feed-Adressen eingeben.');
    const feedUrls = urls.map((u) => publicUrl(String(u).trim()).toString());
    if (new Set(feedUrls).size !== feedUrls.length) throw new Error('Jeden Feed nur einmal eintragen.');
    const limit = body.limit ?? 30; const hours = body.hours ?? 72;
    if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 40) throw new Error('Ein bis 40 Artikel je Feed sind möglich.');
    if (typeof hours !== 'number' || ![0, 24, 72, 168].includes(hours)) throw new Error('Ungültiges Zeitfenster.');
    input = { apiKey: body.apiKey.trim(), feedUrls, limit, hours };
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Ungültige Eingabe.' }, { status: 400 }); }

  const lifetime = new AbortController();
  const signal = AbortSignal.any([request.signal, lifetime.signal]);
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AnalysisEvent) => { if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); };
      const startedAt = new Date().toISOString();
      const report: Report = { method: METHOD_VERSION, startedAt, completedAt: '', hours: input.hours, limit: input.limit, feeds: [], items: [], models: [], questions: {}, warnings: [] };
      try {
        emit({ type: 'progress', done: 0, total: 0, message: 'Feeds laden und auf Zeitraum und Dubletten prüfen …' });
        const loaded = await Promise.all(input.feedUrls.map(async (url, index) => {
          const id = `feed-${index + 1}`;
          try { return parseFeed(await fetchFeed(url, signal), url, id, input.limit, input.hours, Date.parse(startedAt)); }
          catch (error) { return { info: { id, url, name: new URL(url).hostname, available: 0, duplicates: 0, undated: 0, outsideWindow: 0, eligible: 0, selected: 0, failed: 0, error: error instanceof Error ? error.message : 'Feed konnte nicht gelesen werden.' } as FeedInfo, items: [] as FeedItem[] }; }
        }));
        report.feeds = loaded.map((f) => f.info);
        const items = loaded.flatMap((f) => f.items);
        if (!items.length) { emit({ type: 'complete', report: { ...report, completedAt: new Date().toISOString(), warnings: ['Keine Artikel im gewählten Zeitfenster verfügbar. Feed-Status prüfen oder Zeitraum erweitern.'] } }); return; }
        let done = 0;
        // Interleave sources to distribute failures and latency across feeds.
        const interleaved: FeedItem[] = [];
        for (let i = 0; i < input.limit; i++) for (const feed of loaded) if (feed.items[i]) interleaved.push(feed.items[i]);
        const batches: FeedItem[][] = [];
        for (let i = 0; i < interleaved.length; i += 5) batches.push(interleaved.slice(i, i + 5));
        emit({ type: 'progress', done, total: items.length, message: `${items.length} Artikel ausgewählt. Textanalyse läuft …` });
        async function analyze(batch: FeedItem[]) {
          const questions: Record<string, Question> = {};
          batch.forEach((item, index) => {
            for (const [key, question] of Object.entries(questionsFor(item))) questions[`i${index}_${key}`] = { ...question, instructions: question.instructions.replaceAll('`article.', `\`articles[${index}].`) };
          });
          const response = await fetch('https://api.typesafe.ai/v1/systemone', {
            method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
            headers: { Authorization: `Bearer ${input.apiKey}`, 'Content-Type': 'application/json' },
            // Intentionally omit publisher, URL, feed title, category, and date from inference.
            body: JSON.stringify({ model: 'jev-latest', state: { articles: batch.map(({ title, description }) => ({ title, description })) }, questions }),
          });
          if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'TypeSafe akzeptiert den API-Key nicht.' : `TypeSafe meldet HTTP ${response.status}. Betroffene Artikel wurden nicht gewertet.`);
          const payload = await response.json() as { model?: unknown; answers?: Record<string, unknown> };
          if (typeof payload.model !== 'string' || !payload.answers) throw new Error('JEV lieferte keine vollständige Antwort.');
          if (!report.models.includes(payload.model)) report.models.push(payload.model);
          const valid: AnalysisItem[] = [];
          batch.forEach((item, index) => {
            const itemQuestions = questionsFor(item); report.questions[item.id] = itemQuestions;
            try {
              const raw = Object.fromEntries(Object.keys(itemQuestions).map((k) => [k, payload.answers![`i${index}_${k}`]]));
              valid.push(decodeAnalysis(item, validateAnswers(raw, itemQuestions), payload.model as string));
            } catch (error) {
              report.feeds.find((f) => f.id === item.feedId)!.failed++;
              report.warnings.push(`${item.source}: ${item.title} — ${error instanceof Error ? error.message : 'Ungültige Modellantwort.'}`);
            }
          });
          return valid;
        }
        for (let start = 0; start < batches.length; start += 2) {
          if (signal.aborted) break;
          const pair = batches.slice(start, start + 2);
          const settled = await Promise.allSettled(pair.map(analyze));
          let fatal = false;
          settled.forEach((result, index) => {
            if (result.status === 'fulfilled') report.items.push(...result.value);
            else { const message = result.reason instanceof Error ? result.reason.message : 'JEV-Anfrage fehlgeschlagen.'; report.warnings.push(message); for (const item of pair[index]) report.feeds.find((f) => f.id === item.feedId)!.failed++; if (message.includes('API-Key') || message.includes('HTTP 429')) fatal = true; }
            done += pair[index].length;
          });
          emit({ type: 'progress', done, total: items.length, message: `${done} von ${items.length} Artikeln verarbeitet; ${report.items.length} gültige Auswertungen.` });
          if (fatal) { for (const batch of batches.slice(start + 2)) for (const item of batch) report.feeds.find((f) => f.id === item.feedId)!.failed++; report.warnings.push('Weitere Anfragen wurden wegen Zugang oder Rate-Limit gestoppt.'); break; }
        }
        report.completedAt = new Date().toISOString();
        emit({ type: 'complete', report });
      } catch (error) { emit({ type: 'error', message: error instanceof Error ? error.message : 'Analyse fehlgeschlagen.' }); }
      finally { try { controller.close(); } catch { /* Client disconnected. */ } }
    },
    cancel() { lifetime.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

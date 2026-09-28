'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { Radio, Plus, X, Download, ExternalLink, LoaderCircle, ArrowRight, Search, Info, GitCompareArrows } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { NativeSelect } from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { recordBatch, redactKey, updateDebugRun, type DebugRun } from '@/lib/debug';
import { DIMENSIONS, DIMENSION_KEYS, METHOD_VERSION, NARRATIVES, TOPICS, matchedTopics, summarize, type AnalysisEvent, type AnalysisItem, type Dimension, type Report } from '@/lib/analysis';

const PRESETS = ['https://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml', 'https://www.bild.de/feed/news.xml'];
type RunInput = { apiKey: string; feedUrls: string[]; limit: number; hours: number; debug?: boolean };
type ModelContext = { registerTool(tool: { name: string; description: string; inputSchema: object; annotations: object; execute(input: unknown): Promise<unknown> }, options: { signal: AbortSignal }): void | Promise<void> };
const number = (value: number | null) => value === null ? '—' : String(Math.round(value));
const date = (value?: string) => value ? new Date(value).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : 'ohne Datum';

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [feedUrls, setFeedUrls] = useState(PRESETS);
  const [limit, setLimit] = useState(30);
  const [hours, setHours] = useState(72);
  const [debugEnabled, setDebugEnabled] = useState(true);
  const [debugRun, setDebugRun] = useState<DebugRun | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0, message: '' });
  const [topic, setTopic] = useState('all');
  const [geography, setGeography] = useState('all');
  const [source, setSource] = useState('all');
  const [sort, setSort] = useState<Dimension>('sensationalism');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const running = useRef(false);
  const controller = useRef<AbortController | null>(null);

  const run = useCallback(async (input: RunInput) => {
    if (running.current) throw new Error('Eine Analyse läuft bereits.');
    if (!input.apiKey.trim()) throw new Error('Bitte deinen TypeSafe API-Key eintragen.');
    if (input.feedUrls.length < 1 || input.feedUrls.length > 5 || new Set(input.feedUrls).size !== input.feedUrls.length) throw new Error('Bitte eine bis fünf unterschiedliche Feeds eintragen.');
    running.current = true; setBusy(true); setError(''); setProgress({ done: 0, total: 0, message: 'Analyse wird vorbereitet …' });
    setDebugRun(input.debug ? redactKey({ format: 'resonanzradar-debug-v1', method: METHOD_VERSION, startedAt: new Date().toISOString(), status: 'running', settings: { feedUrls: input.feedUrls, limit: input.limit, hours: input.hours }, batches: [] } as DebugRun, input.apiKey.trim()) : null);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: abort.signal });
      if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? 'Analyse konnte nicht gestartet werden.'); }
      const reader = response.body?.getReader(); if (!reader) throw new Error('Keine Antwort erhalten.');
      const decoder = new TextDecoder(); let buffer = ''; let completed: Report | null = null;
      while (true) {
        const part = await reader.read(); buffer += decoder.decode(part.value, { stream: !part.done });
        const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as AnalysisEvent;
          if (event.type === 'debug') setDebugRun((current) => current ? recordBatch(current, event.batch) : null);
          if (event.type === 'error') throw new Error(event.message);
          if (event.type === 'progress') setProgress(event);
          if (event.type === 'complete') completed = event.report;
        }
        if (part.done) break;
      }
      if (!completed) throw new Error('Die Verbindung wurde vor Abschluss unterbrochen. Bitte erneut starten.');
      setReport(completed); setSelectedId(completed.items[0]?.id ?? ''); setTopic('all'); setSource('all'); setGeography('all'); setQuery('');
      setDebugRun((current) => current ? { ...current, status: 'completed', completedAt: new Date().toISOString(), report: completed! } : null);
      return completed;
    } catch (caught) {
      const message = redactKey(abort.signal.aborted ? 'Analyse abgebrochen. Bereits gestartete API-Anfragen können Kosten verursachen.' : caught instanceof Error ? caught.message : 'Analyse fehlgeschlagen.', input.apiKey.trim());
      setDebugRun(updateDebugRun.bind(null, { status: abort.signal.aborted ? 'cancelled' : 'failed', completedAt: new Date().toISOString(), error: message }));
      setError(message); throw new Error(message);
    } finally { setBusy(false); running.current = false; controller.current = null; }
  }, []);

  useEffect(() => {
    const context = (document as Document & { modelContext?: ModelContext }).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    try {
      void Promise.resolve(context.registerTool({ name: 'analyze_news_feed', description: 'Analysiert bis zu fünf Feeds mit bis zu 40 Artikeln je Feed. Verwendet TypeSafe und verursacht API-Nutzung. Aktualisiert die sichtbare Auswertung.', annotations: { readOnlyHint: false, untrustedContentHint: true }, inputSchema: { type: 'object', properties: { apiKey: { type: 'string' }, feedUrls: { type: 'array', minItems: 1, maxItems: 5, uniqueItems: true, items: { type: 'string', format: 'uri' } }, limit: { type: 'integer', minimum: 1, maximum: 40, default: 30 }, hours: { type: 'integer', enum: [0, 24, 72, 168], default: 72 } }, required: ['apiKey', 'feedUrls'], additionalProperties: false }, async execute(value) {
        const input = value as Partial<RunInput>;
        if (typeof input.apiKey !== 'string' || !Array.isArray(input.feedUrls) || input.feedUrls.some((u) => typeof u !== 'string')) throw new Error('API-Key und Feed-URLs fehlen oder sind ungültig.');
        const result = await run({ apiKey: input.apiKey, feedUrls: input.feedUrls, limit: input.limit ?? 30, hours: input.hours ?? 72 });
        return { analyzed: result.items.length, feeds: result.feeds.length, method: result.method, warnings: result.warnings };
      } }, { signal: lifecycle.signal })).catch(() => undefined);
    } catch { /* Browser support is optional. */ }
    return () => lifecycle.abort();
  }, [run]);
  useEffect(() => () => controller.current?.abort(), []);

  const analysisItems = useMemo(() => (report?.items ?? []).filter((i) => (topic === 'all' || i.topic === topic) && (geography === 'all' || i.geography === geography)), [report, topic, geography]);
  const visible = useMemo(() => analysisItems.filter((i) => (source === 'all' || i.feedId === source) && `${i.title} ${i.description}`.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de'))).sort((a, b) => b.scores[sort] - a.scores[sort]), [analysisItems, source, query, sort]);
  const selected = visible.find((i) => i.id === selectedId) ?? visible[0];
  const matched = matchedTopics(analysisItems, report?.feeds.map((f) => f.id) ?? []);
  const summary = summarize(analysisItems);

  async function submit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    try { await run({ apiKey: apiKey.trim(), feedUrls: feedUrls.map((u) => u.trim()).filter(Boolean), limit, hours, debug: debugEnabled }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Analyse fehlgeschlagen.'); }
  }
  function download() {
    if (!report) return;
    const blob = new Blob([JSON.stringify({ ...report, summaries: report.feeds.map((f) => ({ feed: f.id, ...summarize(report.items.filter((i) => i.feedId === f.id)) })), matchedTopics: matchedTopics(report.items, report.feeds.map((f) => f.id)) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `resonanzradar-v${report.method}-${report.startedAt.slice(0, 10)}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function downloadDebug() {
    if (!debugRun) return;
    const blob = new Blob([JSON.stringify({ ...debugRun, exportedAt: new Date().toISOString(), privacy: 'No API key or authorization headers. Article texts, feed URLs, exact request bodies and provider response text are included. Known key occurrences are replaced with [REDACTED]. No server-side debug persistence. Unfinished batches may have no response.' }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `resonanzradar-debug-${debugRun.startedAt.replace(/[:.]/g, '-')}.json`; a.click(); URL.revokeObjectURL(url);
  }

  return <main>
    <header className="masthead"><div className="shell masthead-inner"><div className="brand"><span className="brand-icon"><Radio size={22} /></span><div><strong>ResonanzRadar</strong><span>Nachrichten im Vergleich</span></div></div><span className="version">Methodik {METHOD_VERSION}</span></div></header>
    <div className="shell">
      <section className="intro"><p className="eyebrow">SPRACHE · BEDROHUNG · POLITISCHE DEUTUNG</p><h1>Wie rahmen Medien ihre Nachrichten?</h1><p>Vergleiche, wie zugespitzt ein Text formuliert ist, welche Bedrohung er beschreibt und wem er politische Verantwortung zuschreibt.</p></section>
      <form className="panel setup" onSubmit={submit}>
        <fieldset disabled={busy}><legend className="sr-only">Analyse konfigurieren</legend><div className="setup-grid">
          <div><div className="section-label"><label htmlFor="feed-0">Quellen vergleichen</label><button className="text-button" type="button" disabled={feedUrls.length >= 5} onClick={() => setFeedUrls([...feedUrls, ''])}><Plus size={15} /> Feed hinzufügen</button></div>
            <div className="feed-fields">{feedUrls.map((url, index) => <div className="feed-input" key={index}><span>{index + 1}</span><input id={`feed-${index}`} type="url" value={url} onChange={(e) => setFeedUrls(feedUrls.map((u, i) => i === index ? e.target.value : u))} placeholder="https://…/feed.xml" aria-label={`Feed ${index + 1}`} /><button type="button" className="icon-button" aria-label={`Feed ${index + 1} entfernen`} disabled={feedUrls.length === 1} onClick={() => setFeedUrls(feedUrls.filter((_, i) => i !== index))}><X size={15} /></button></div>)}</div>
            <p className="fine">Bis zu 5 Feeds. Die vorbelegten URLs stammen aus deinem Vergleich.</p>
          </div>
          <div className="settings"><label htmlFor="key">TypeSafe API-Key<input id="key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Deinen API-Key eintragen" /></label><div className="settings-row"><label htmlFor="hours">Gemeinsamer Zeitraum<NativeSelect id="hours" value={hours} onChange={(e) => setHours(Number(e.target.value))}><option value={24}>Letzte 24 Stunden</option><option value={72}>Letzte 72 Stunden</option><option value={168}>Letzte 7 Tage</option><option value={0}>Alle gelieferten Artikel</option></NativeSelect></label><label htmlFor="limit">Max. Artikel je Feed<NativeSelect id="limit" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>{[5, 8, 12, 20, 30, 40].map((n) => <option key={n} value={n}>{n}</option>)}</NativeSelect></label></div><button className="primary-button" type="submit">{busy ? <LoaderCircle size={17} className="animate-spin" /> : <GitCompareArrows size={17} />}{busy ? 'Analyse läuft' : 'Vergleich starten'}<ArrowRight size={16} /></button><p className="fine">Bis zu {limit * feedUrls.filter(Boolean).length} Artikel. Titel und Kurztexte werden an TypeSafe gesendet. Der Key wird von dieser App nicht gespeichert.</p></div>
        </div><div className="debug-option"><div><Checkbox id="debug" checked={debugEnabled} onCheckedChange={setDebugEnabled} /><label htmlFor="debug">JEV-Debug für diesen Lauf mitschreiben</label></div><p className="fine">Anfragen, Originalantworten und Fehler für die Fehlersuche. Kein API-Key und keine Authorization-Header. Nur im Arbeitsspeicher, bis du neu lädst oder den nächsten Lauf startest. Keine zusätzlichen JEV-Aufrufe.</p></div></fieldset>
        {busy && <div className="run-status"><div><output aria-live="polite">{progress.message}</output><button type="button" className="text-button" onClick={() => controller.current?.abort()}>Abbrechen</button></div><Progress aria-label="Analysefortschritt" value={progress.total ? 100 * progress.done / progress.total : null} /></div>}
        {error && <p role="alert" className="error-message">{error}</p>}
      </form>

      {debugRun && <section className="panel debug-panel" aria-label="JEV-Debug"><div className="results-heading"><div><h2>JEV-Debug zum Weitergeben</h2><p className="fine">Lauf {date(debugRun.startedAt)} · {{ running: 'läuft', completed: 'abgeschlossen', failed: 'fehlgeschlagen', cancelled: 'abgebrochen' }[debugRun.status]} · {debugRun.batches.filter((b) => b.response).length} Antworten aus {debugRun.batches.length} gestarteten Anfragen</p></div><button type="button" className="secondary-button" onClick={downloadDebug}><Download size={16} /> Debug-JSON herunterladen</button></div><p>Nach dem Vergleich herunterladen und die JSON-Datei hier im Chat anhängen. Sie enthält Artikeltexte, Feed-Adressen, die tatsächlich gesendeten Fragen, JEV-Rohantworten und Prüfungsfehler. Vor dem Weitergeben bei Bedarf ansehen.</p><p className="fine">Auch bei Fehlern oder Abbruch verfügbar: Der Export enthält alle bis dahin empfangenen Daten. Offene Anfragen können ohne Antwort bleiben. Ein neuer Lauf ersetzt diesen Mitschnitt; beim Neuladen geht er verloren.</p><details><summary>Mitschnitt ansehen</summary>{debugRun.batches.length ? debugRun.batches.map((batch) => <details key={batch.id}><summary>Anfrage {batch.id} · {batch.articles.length} Artikel · {batch.response ? `HTTP ${batch.response.status}` : 'keine Antwort empfangen'}{batch.durationMs !== undefined ? ` · ${(batch.durationMs / 1000).toFixed(1)} s` : ''}{batch.error || batch.validation.length ? ' · Prüfhinweise' : ''}</summary><pre>{JSON.stringify(batch, null, 2)}</pre></details>) : <p className="fine">Noch kein JEV-Aufruf gestartet.</p>}</details></section>}

      <div className="method-note"><Info size={19} /><p><strong>Ein niedriger Wert ist kein Objektivitätsurteil.</strong> Die Messwerte beschreiben Texte. Sie belegen weder journalistische Qualität noch eine Wirkung auf die AfD-Wahlabsicht. Das neue Schema ersetzt den bisherigen, unkalibrierten Gesamtwert.</p></div>

      {!report ? <section className="panel empty-state"><GitCompareArrows size={30} /><h2>Starte einen überprüfbaren Vergleich</h2><p>Du erhältst separate Messwerte, einen Themenvergleich und Originaltextstellen zu auffälligen Formulierungen. Vor der ersten Analyse werden keine Beispielwerte als Ergebnis angezeigt.</p></section> : <>
        <div className="results-heading"><div><p className="eyebrow">DEINE STICHPROBE</p><h2>{report.items.length} ausgewertete Meldungen · {report.feeds.length} Feeds</h2><p className="fine">Abruf {date(report.startedAt)} · {report.hours ? `letzte ${report.hours} Stunden` : 'ohne Zeitbegrenzung'} · {report.models.join(', ') || 'kein Modellaufruf abgeschlossen'}{busy ? ' · vorheriger Vergleich' : ''}</p></div><button className="secondary-button" onClick={download}><Download size={16} /> Analyse exportieren</button></div>
        {!!report.warnings.length && <details className="notice"><summary>{report.warnings.length} Hinweise zur Verarbeitung — fehlende Werte zählen nicht als null</summary><ul>{report.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></details>}
        <div className="comparison-filters"><label htmlFor="topic">Thema für den Vergleich<NativeSelect id="topic" value={topic} onChange={(e) => setTopic(e.target.value)}><option value="all">Alle Themen</option>{Object.entries(TOPICS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</NativeSelect></label><label htmlFor="geo">Geografischer Bezug<NativeSelect id="geo" value={geography} onChange={(e) => setGeography(e.target.value)}><option value="all">Alle Meldungen</option><option value="germany">Deutschlandbezug</option><option value="foreign">Ausland ohne genannten Deutschlandbezug</option><option value="unclear">Bezug unklar</option></NativeSelect></label><p className="fine">Diese Filter wirken auf den Feedvergleich und die Einzelmeldungen.</p></div>

        <section className="panel compare-panel"><div className="panel-title"><div><h2>Feedprofile nebeneinander</h2><p>Mittelwerte pro Artikel · 0 = nicht ausgeprägt, 100 = sehr stark ausgeprägt</p></div><span className="pill">Kein Gesamtranking</span></div>
          <Table><TableHeader><TableRow><TableHead>Feed / Datenbasis</TableHead><TableHead>n</TableHead><TableHead>Zuspitzung</TableHead><TableHead>Bedrohung</TableHead><TableHead>Politische Rahmung</TableHead><TableHead>Verallgemeinerung</TableHead><TableHead>Prüfbedarf</TableHead></TableRow></TableHeader><TableBody>{report.feeds.map((feed) => {
            const allItems = report.items.filter((i) => i.feedId === feed.id); const rows = analysisItems.filter((i) => i.feedId === feed.id); const stats = summarize(rows);
            const dates = allItems.map((i) => i.publishedAt).filter((d): d is string => !!d).sort();
            return <TableRow key={feed.id}><TableCell className="feed-name"><strong>{feed.name}</strong><span>{allItems.length}/{feed.selected} ausgewertet · {feed.eligible} im Zeitfenster</span><span>{dates.length ? `${date(dates[0])} – ${date(dates.at(-1))}` : 'keine Datumsbasis'}</span>{feed.error && <span className="error-text">{feed.error}</span>}{feed.failed > 0 && <span className="error-text">{feed.failed} Auswertungen fehlen</span>}</TableCell><TableCell>{stats.count}</TableCell>{DIMENSION_KEYS.map((k) => <TableCell key={k}><Score value={stats.scores[k]} /></TableCell>)}<TableCell>{stats.review}/{stats.count}</TableCell></TableRow>;
          })}</TableBody></Table>
          <p className="table-note">n = tatsächlich ausgewertete Artikel nach Filter. Verschiedene Themen, Zeitabdeckungen und Kurztextlängen beeinflussen die Werte. Kleine Unterschiede sind kein belastbarer Nachweis eines Medienunterschieds.</p>
        </section>

        <section className="panel"><div className="panel-title"><div><h2>Vergleich bei gleichem Themenmix</h2><p>Jedes gemeinsame Thema zählt gleich viel — damit etwa mehr Kriminalitätsmeldungen den Vergleich nicht allein bestimmen.</p></div></div>
          {matched.topics.length ? <><p className="table-note">Gemeinsame Themen mit mindestens 2 Artikeln pro Feed: {matched.topics.map((t) => TOPICS[t]).join(', ')}. Verschiedene Ereignisse innerhalb eines Themas bleiben ein Einflussfaktor.</p><Table><TableHeader><TableRow><TableHead>Feed</TableHead><TableHead>Artikel in gemeinsamen Themen</TableHead>{DIMENSION_KEYS.map((k) => <TableHead key={k}>{DIMENSIONS[k].short}</TableHead>)}</TableRow></TableHeader><TableBody>{matched.feeds.map((f) => <TableRow key={f.id}><TableCell>{report.feeds.find((feed) => feed.id === f.id)?.name}</TableCell><TableCell>{f.count}</TableCell>{DIMENSION_KEYS.map((k) => <TableCell key={k}><Score value={f.scores[k]} /></TableCell>)}</TableRow>)}</TableBody></Table></> : <p className="empty-inline">Für einen thematisch angeglichenen Vergleich fehlen gemeinsame Themen mit mindestens zwei Artikeln in jedem Feed. Zeitraum erweitern oder mehr Artikel einlesen.</p>}
        </section>

        <div className="two-panels"><section className="panel"><div className="panel-title"><div><h2>Was steckt im Themenmix?</h2><p>Anteile und Anzahlen in der gefilterten Stichprobe.</p></div></div><div className="mix-list">{report.feeds.map((f) => { const rows = analysisItems.filter((i) => i.feedId === f.id); return <div key={f.id}><h3>{f.name}</h3><div className="topic-list">{Object.entries(TOPICS).map(([key, label]) => { const n = rows.filter((i) => i.topic === key).length; return n ? <span className="pill" key={key}>{label} {Math.round(100 * n / rows.length)} % <small>({n})</small></span> : null; })}{!rows.length && <span className="fine">Keine Artikel</span>}</div></div>; })}</div></section>
        <section className="panel"><div className="panel-title"><div><h2>Politische Narrative im Text</h2><p>Vorab definierte Motive deiner AfD-Fragestellung. Sie sind nicht parteiexklusiv.</p></div></div><div className="mix-list">{report.feeds.map((f) => { const rows = analysisItems.filter((i) => i.feedId === f.id); const narrativeRows = rows.filter((i) => !['none', 'unclear'].includes(i.narrative)); return <div key={f.id}><h3>{f.name}</h3><p className="fine">{narrativeRows.filter((i) => i.narrativeVoice === 'asserted').length} bekräftigt / unmarkiert · {narrativeRows.filter((i) => i.narrativeVoice === 'attributed').length} als fremde Position · {narrativeRows.filter((i) => i.narrativeVoice === 'challenged').length} relativiert / widerlegt · {narrativeRows.filter((i) => ['unclear', 'absent'].includes(i.narrativeVoice)).length} unklar / widersprüchlich · Basis {rows.length}</p><div className="topic-list">{Object.entries(NARRATIVES).filter(([k]) => !['none', 'unclear'].includes(k)).map(([k, label]) => { const n = narrativeRows.filter((i) => i.narrative === k).length; return n ? <span className="pill" key={k}>{label} ({n})</span> : null; })}</div></div>; })}</div></section></div>

        <section className="panel"><div className="panel-title"><div><h2>Einzelmeldungen prüfen</h2><p>{summary.high} von {summary.count} mit Zuspitzung ab 50/100 · {summary.review} mit Prüfhinweisen. Schwelle ist eine Arbeitshilfe, kein validierter Grenzwert.</p></div></div>
          <div className="article-filters"><label htmlFor="source">Feed<NativeSelect id="source" value={source} onChange={(e) => setSource(e.target.value)}><option value="all">Alle Feeds</option>{report.feeds.map((f) => <option value={f.id} key={f.id}>{f.name}</option>)}</NativeSelect></label><label htmlFor="sort">Absteigend sortieren nach<NativeSelect id="sort" value={sort} onChange={(e) => setSort(e.target.value as Dimension)}>{DIMENSION_KEYS.map((k) => <option key={k} value={k}>{DIMENSIONS[k].short}</option>)}</NativeSelect></label><label className="search-label" htmlFor="search"><Search size={15} /> Textsuche<input id="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="In Titel und Kurztext" /></label></div>
          <div className="article-grid"><div className="article-list">{visible.map((item) => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} aria-pressed={selected?.id === item.id} className={`article-button ${selected?.id === item.id ? 'selected' : ''}`}><span className="article-meta">{item.source} · {date(item.publishedAt)}</span><strong>{item.title}</strong><span className="article-values">{DIMENSIONS[sort].short} <b>{number(item.scores[sort])}/100</b> · {TOPICS[item.topic]}{item.review.length > 0 ? ' · prüfen' : ''}</span></button>)}{!visible.length && <p className="empty-inline">Keine Meldungen für diese Filter.</p>}</div><aside>{selected ? <ArticleDetail item={selected} /> : <p className="empty-inline">Wähle eine Meldung.</p>}</aside></div>
        </section>
        <details className="panel methodology"><summary>Datengrundlage und Grenzen dieses Laufs</summary><p>Gleicher Zeitraum und dieselbe Obergrenze bedeuten nicht automatisch gleiche Artikelzahlen oder identische Ereignisse. Die Feeds liefern nur ihren aktuellen Ausschnitt; ältere Meldungen werden nicht aus einem Archiv nachgeladen. Artikel werden nach Datum sortiert und innerhalb jedes Feeds anhand von Link oder Titel dedupliziert.</p><Table><TableHeader><TableRow><TableHead>Feed</TableHead><TableHead>Geliefert</TableHead><TableHead>Dubletten</TableHead><TableHead>Ohne Datum</TableHead><TableHead>Zeitfilter ausgeschlossen</TableHead><TableHead>Nur Titel / gekürzt</TableHead></TableRow></TableHeader><TableBody>{report.feeds.map((f) => <TableRow key={f.id}><TableCell>{f.name}</TableCell><TableCell>{f.available}</TableCell><TableCell>{f.duplicates}</TableCell><TableCell>{f.undated}</TableCell><TableCell>{f.outsideWindow}</TableCell><TableCell>{report.items.filter((i) => i.feedId === f.id && (!i.description || i.truncated)).length}</TableCell></TableRow>)}</TableBody></Table></details>
      </>}

      <details className="panel methodology"><summary>Wie werden die Werte bestimmt?</summary><div className="method-grid">{DIMENSION_KEYS.map((key) => <div key={key}><h3>{DIMENSIONS[key].label}</h3><ol start={0}>{DIMENSIONS[key].levels.map((level, i) => <li key={level}><b>{i * 25}</b> {level}</li>)}</ol></div>)}</div><p>JEV beantwortet jede Frage getrennt. Scores liegen zwischen den fünf Stufen und werden linear auf 0–100 umgerechnet. Es gibt keinen zusammengesetzten AfD- oder Objektivitätswert. Modellkonfidenz beschreibt die Eindeutigkeit der Antwortverteilung und ist kein empirischer Korrektheitsnachweis. Einzelkonfidenzen unter 55 % und widersprüchliche Textbelege führen zu Prüfhinweisen.</p><p>JEV erhält Titel und Kurztext ohne separate Quellenmetadaten. Im Text selbst können Quellen erkennbar bleiben. Die ausgewählten Textstellen stammen wörtlich aus den Eingaben; ihre Auswahl ist ebenfalls eine Modellentscheidung. Alle Fragen, Antworten, Verteilungen und die tatsächlich verwendete Modellversion sind im Export enthalten.</p><p>Die Methodik ist eine explorative Inhaltsanalyse und noch nicht gegen menschlich bewertete Artikel kalibriert. Aussagen über Objektivität, tatsächliche Verunsicherung oder Wahlverhalten benötigen zusätzliche Daten. Werte aus Methodik 1 und 2 sind nicht vergleichbar.</p></details>
      <footer>ResonanzRadar · Methodik {METHOD_VERSION}<a href="https://docs.typesafe.ai/primitives" target="_blank" rel="noreferrer">TypeSafe: Bewertung und Konfidenz <ExternalLink size={13} /></a></footer>
    </div>
  </main>;
}

function Score({ value }: { value: number | null }) { return <span className="score-cell"><b>{number(value)}</b>{value !== null && <span className="score-track"><span style={{ width: `${value}%` }} /></span>}</span>; }
function ArticleDetail({ item }: { item: AnalysisItem }) {
  const voice: Record<string, string> = { absent: 'Keine narrative Aussage', asserted: 'Bekräftigt / unmarkiert', attributed: 'Zugeschriebene Fremdposition', challenged: 'Relativiert / widerlegt', unclear: 'Sprecherhaltung unklar' };
  return <div className="article-detail"><p className="eyebrow">ORIGINALTEXT & EINORDNUNG</p><h3>{item.title}</h3><p className="article-description">{item.description || 'Der Feed enthält keinen Kurztext.'}</p><p className="fine">{item.source} · {date(item.publishedAt)}{item.link && <> · <a href={item.link} target="_blank" rel="noreferrer">Artikel öffnen <ExternalLink size={12} /></a></>}</p><div className="detail-scores">{DIMENSION_KEYS.map((key) => <div key={key}><div><strong>{DIMENSIONS[key].label}</strong><small>Modellkonfidenz {Math.round(item.confidences[key] * 100)} %</small></div><Score value={item.scores[key]} /></div>)}</div><p className="fine">0–100 misst Ausprägung, keine Eintrittswahrscheinlichkeit.</p><div className="evidence"><h4>Ausgewählte Textstellen</h4>{(['sensationalism', 'political'] as const).map((key) => <div key={key}><strong>{DIMENSIONS[key].label}</strong>{item.evidence[key] ? <blockquote>{item.evidence[key]}</blockquote> : <p className="fine">Keine passende Stelle ausgewählt.</p>}<small>Auswahl-Konfidenz {Math.round(item.confidences[`${key}Evidence`] * 100)} %</small></div>)}</div><div className="narrative-detail"><h4>Politisches Narrativ</h4><p>{NARRATIVES[item.narrative]}</p><p className="fine">{voice[item.narrativeVoice]} · {item.geography === 'germany' ? 'Deutschlandbezug' : item.geography === 'foreign' ? 'Ausland ohne genannten Deutschlandbezug' : 'Geografischer Bezug unklar'}</p></div>{item.review.length > 0 && <div className="notice"><strong>Manuell prüfen</strong><ul>{item.review.map((r) => <li key={r}>{r}</li>)}</ul></div>}<details><summary>Modellantworten anzeigen</summary><pre>{JSON.stringify(item.raw, null, 2)}</pre></details></div>;
}

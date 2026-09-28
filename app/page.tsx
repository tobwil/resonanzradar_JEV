'use client';

import { useEffect, useMemo, useState, type SyntheticEvent } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Download,
  ExternalLink,
  Eye,
  KeyRound,
  LoaderCircle,
  Radio,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

type MainTopic =
  | 'migration_asylum'
  | 'crime_security'
  | 'economy_costs_jobs'
  | 'energy_climate'
  | 'public_services_state'
  | 'war_foreign_policy'
  | 'democracy_social_cohesion'
  | 'other'
  | 'unclear';

type ResultItem = {
  id: string;
  title: string;
  description: string;
  source: string;
  link?: string;
  publishedAt?: string;
  topic: MainTopic;
  topicConfidence: number;
  uncertaintyIndex: number;
  resonanceScore: number;
  overlap: number;
  confidence: number;
  dimensions: {
    threat: number;
    controlLoss: number;
    governmentFailure: number;
    personalProximity: number;
    blame: number;
    solutionGap: number;
    polarization: number;
  };
};

type WebMcpContext = {
  registerTool: (
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute: (input: unknown) => Promise<unknown>;
    },
    options: { signal: AbortSignal },
  ) => void | Promise<void>;
};

type AnalyzePayload = {
  items: ResultItem[];
  model?: string;
  error?: string;
};

const TOPICS: Record<MainTopic, { label: string; short: string }> = {
  migration_asylum: { label: 'Migration & Asyl', short: 'Migration' },
  crime_security: { label: 'Kriminalität & Sicherheit', short: 'Sicherheit' },
  economy_costs_jobs: { label: 'Wirtschaft, Kosten & Arbeit', short: 'Wirtschaft' },
  energy_climate: { label: 'Energie & Klima', short: 'Energie' },
  public_services_state: { label: 'Staat & öffentliche Dienste', short: 'Staat' },
  war_foreign_policy: { label: 'Krieg & Außenpolitik', short: 'Außenpolitik' },
  democracy_social_cohesion: { label: 'Demokratie & Zusammenhalt', short: 'Demokratie' },
  other: { label: 'Anderes Thema', short: 'Anderes' },
  unclear: { label: 'Unklar', short: 'Unklar' },
};

const SAMPLE_RESULTS: ResultItem[] = [
  {
    id: 'demo-1',
    title: 'Kommunen warnen vor Überlastung bei Unterbringung und Betreuung',
    description:
      'Mehrere Städte berichten von knappen Kapazitäten und fordern schnellere Entscheidungen von Bund und Ländern.',
    source: 'Beispielquelle',
    topic: 'migration_asylum',
    topicConfidence: 0.93,
    uncertaintyIndex: 72,
    resonanceScore: 76,
    overlap: 0.89,
    confidence: 0.82,
    dimensions: {
      threat: 3.2,
      controlLoss: 3.5,
      governmentFailure: 0.73,
      personalProximity: 2.1,
      blame: 0.74,
      solutionGap: 0.78,
      polarization: 2.2,
    },
  },
  {
    id: 'demo-2',
    title: 'Energiepreise steigen zum Winter leicht an',
    description:
      'Verbraucherzentralen rechnen mit moderaten Mehrkosten und nennen konkrete Sparmöglichkeiten für Haushalte.',
    source: 'Beispielquelle',
    topic: 'energy_climate',
    topicConfidence: 0.91,
    uncertaintyIndex: 38,
    resonanceScore: 49,
    overlap: 0.82,
    confidence: 0.88,
    dimensions: {
      threat: 1.6,
      controlLoss: 1.0,
      governmentFailure: 0.18,
      personalProximity: 2.7,
      blame: 0.31,
      solutionGap: 0.17,
      polarization: 0.8,
    },
  },
  {
    id: 'demo-3',
    title: 'Stadt eröffnet neue Bibliothek im Zentrum',
    description:
      'Das Gebäude bietet mehr Arbeitsplätze, längere Öffnungszeiten und ein erweitertes Bildungsprogramm.',
    source: 'Beispielquelle',
    topic: 'public_services_state',
    topicConfidence: 0.89,
    uncertaintyIndex: 8,
    resonanceScore: 14,
    overlap: 0.29,
    confidence: 0.9,
    dimensions: {
      threat: 0.2,
      controlLoss: 0.1,
      governmentFailure: 0.04,
      personalProximity: 1.1,
      blame: 0.03,
      solutionGap: 0.04,
      polarization: 0.1,
    },
  },
];

function scoreTone(score: number) {
  if (score >= 65) return 'high';
  if (score >= 40) return 'medium';
  return 'low';
}

function scoreLabel(score: number) {
  if (score >= 65) return 'starkes Signal';
  if (score >= 40) return 'mittleres Signal';
  return 'schwaches Signal';
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)} %`;
}

export default function Home() {
  const [apiKey, setApiKey] = useState('');
  const [feedUrl, setFeedUrl] = useState('');
  const [limit, setLimit] = useState('8');
  const [results, setResults] = useState<ResultItem[]>(SAMPLE_RESULTS);
  const [selectedId, setSelectedId] = useState(SAMPLE_RESULTS[0].id);
  const [isDemo, setIsDemo] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc');
  const [topicFilter, setTopicFilter] = useState<MainTopic | 'all'>('all');
  const [query, setQuery] = useState('');
  const [showMethod, setShowMethod] = useState(false);

  const visibleResults = useMemo(() => {
    return [...results]
      .filter((item) => topicFilter === 'all' || item.topic === topicFilter)
      .filter((item) =>
        `${item.title} ${item.description} ${item.source}`
          .toLocaleLowerCase('de')
          .includes(query.toLocaleLowerCase('de')),
      )
      .sort((a, b) =>
        sortDirection === 'desc'
          ? b.resonanceScore - a.resonanceScore
          : a.resonanceScore - b.resonanceScore,
      );
  }, [results, topicFilter, query, sortDirection]);

  const selected =
    results.find((item) => item.id === selectedId) ?? visibleResults[0] ?? null;
  const average = results.length
    ? Math.round(results.reduce((sum, item) => sum + item.resonanceScore, 0) / results.length)
    : 0;
  const strongSignals = results.filter((item) => item.resonanceScore >= 65).length;
  const lowConfidence = results.filter((item) => item.confidence < 0.55).length;

  useEffect(() => {
    const context = (document as Document & { modelContext?: WebMcpContext }).modelContext;
    if (!context?.registerTool) return;

    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'analyze_news_feed',
          title: 'Nachrichtenfeed analysieren',
          description:
            'Analysiert bis zu zwölf Meldungen eines öffentlichen RSS- oder Atom-Feeds mit JEV und aktualisiert die sichtbare ResonanzRadar-Auswertung.',
          inputSchema: {
            type: 'object',
            properties: {
              apiKey: { type: 'string', minLength: 1, description: 'TypeSafe API-Key; wird nicht gespeichert.' },
              feedUrl: { type: 'string', format: 'uri', description: 'Öffentliche RSS- oder Atom-URL.' },
              limit: { type: 'integer', minimum: 1, maximum: 12, default: 8 },
            },
            required: ['apiKey', 'feedUrl'],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          async execute(input) {
            const values = input as { apiKey?: unknown; feedUrl?: unknown; limit?: unknown };
            if (typeof values.apiKey !== 'string' || !values.apiKey.trim()) throw new Error('apiKey ist erforderlich.');
            if (typeof values.feedUrl !== 'string' || !values.feedUrl.trim()) throw new Error('feedUrl ist erforderlich.');
            const requestedLimit = values.limit === undefined ? 8 : Number(values.limit);
            if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 12) throw new Error('limit muss zwischen 1 und 12 liegen.');

            setIsLoading(true);
            setError('');
            try {
              const response = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ apiKey: values.apiKey.trim(), feedUrl: values.feedUrl.trim(), limit: requestedLimit }),
              });
              const payload = (await response.json()) as AnalyzePayload;
              if (!response.ok) throw new Error(payload.error || 'Die Auswertung ist fehlgeschlagen.');
              setResults(payload.items);
              setSelectedId(payload.items[0]?.id ?? '');
              setIsDemo(false);
              setFeedUrl(values.feedUrl.trim());
              setLimit(String(requestedLimit));
              return { analyzed: payload.items.length, model: payload.model, highestResonance: Math.max(...payload.items.map((item: ResultItem) => item.resonanceScore)) };
            } catch (toolError) {
              const message = toolError instanceof Error ? toolError.message : 'Die Auswertung ist fehlgeschlagen.';
              setError(message);
              throw new Error(message);
            } finally {
              setIsLoading(false);
            }
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, []);

  async function analyzeFeed(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!apiKey.trim() || !feedUrl.trim()) {
      setError('Bitte API-Key und RSS- oder Atom-URL eintragen.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: apiKey.trim(),
          feedUrl: feedUrl.trim(),
          limit: Number(limit),
        }),
      });
      const payload = (await response.json()) as AnalyzePayload;
      if (!response.ok) throw new Error(payload.error || 'Die Auswertung ist fehlgeschlagen.');

      setResults(payload.items);
      setSelectedId(payload.items[0]?.id ?? '');
      setIsDemo(false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Die Auswertung ist fehlgeschlagen.',
      );
    } finally {
      setIsLoading(false);
    }
  }

  function exportResults() {
    const blob = new Blob(
      [JSON.stringify({ generatedAt: new Date().toISOString(), items: results }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `jev-resonanzanalyse-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <header className="border-b border-white/10 bg-[var(--navy)] text-white">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-lg bg-[var(--signal)] text-[var(--navy)]">
              <Radio size={20} strokeWidth={2.5} />
            </div>
            <div>
              <p className="font-display text-lg font-semibold leading-none tracking-tight">ResonanzRadar</p>
              <p className="mt-1 text-xs text-slate-400">JEV-Analyse für Nachrichtenframes</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="hidden items-center gap-1.5 sm:flex">
              <ShieldCheck size={14} className="text-[var(--signal)]" />
              Kein Schlüssel wird gespeichert
            </span>
            <span className="rounded-full border border-white/15 px-2.5 py-1">jev-latest</span>
          </div>
        </div>
      </header>

      <section className="border-b border-[var(--line)] bg-[var(--paper)]">
        <div className="mx-auto grid max-w-[1500px] gap-8 px-5 py-7 lg:grid-cols-[minmax(0,1fr)_minmax(520px,1.2fr)] lg:px-8">
          <div className="max-w-xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.15em] text-[var(--teal)]">
              <span className="h-px w-7 bg-[var(--teal)]" />
              Arbeitsinstrument, kein Wahlprognosemodell
            </div>
            <h1 className="font-display text-3xl font-semibold leading-[1.08] tracking-[-0.035em] text-[var(--navy)] sm:text-4xl">
              Welche Nachrichten erzeugen politische Resonanz?
            </h1>
            <p className="mt-3 max-w-[58ch] text-[15px] leading-6 text-[var(--muted-ink)]">
              JEV bewertet beobachtbare Themen und Frames. Der Resonanzwert zeigt, wie stark
              Verunsicherung und AfD-Agenda-Nähe zusammentreffen — nicht, ob Menschen tatsächlich
              ihre Wahlabsicht ändern.
            </p>
          </div>

          <form onSubmit={analyzeFeed} className="grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 shadow-sm sm:grid-cols-[1fr_auto]">
            <label className="sm:col-span-2">
              <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[var(--navy)]">
                <KeyRound size={13} /> TypeSafe API-Key
              </span>
              <input
                type="password"
                autoComplete="off"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="ts_…"
                className="field"
                aria-label="TypeSafe API-Key"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-[var(--navy)]">RSS- oder Atom-Feed</span>
              <input
                type="url"
                value={feedUrl}
                onChange={(event) => setFeedUrl(event.target.value)}
                placeholder="https://…/feed.xml"
                className="field"
                aria-label="RSS- oder Atom-Feed URL"
              />
            </label>
            <div className="grid grid-cols-[86px_1fr] items-end gap-2">
              <label>
                <span className="mb-1.5 block text-xs font-semibold text-[var(--navy)]">Artikel</span>
                <select value={limit} onChange={(event) => setLimit(event.target.value)} className="field">
                  <option value="5">5</option>
                  <option value="8">8</option>
                  <option value="12">12</option>
                </select>
              </label>
              <button type="submit" className="primary-button" disabled={isLoading}>
                {isLoading ? <LoaderCircle className="animate-spin" size={17} /> : <Sparkles size={17} />}
                {isLoading ? 'JEV analysiert …' : 'Feed analysieren'}
              </button>
            </div>
            {error && (
              <p className="flex items-start gap-2 text-sm text-red-700 sm:col-span-2" role="alert">
                <AlertCircle className="mt-0.5 shrink-0" size={16} /> {error}
              </p>
            )}
          </form>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] px-5 py-6 lg:px-8">
        <section className="mb-5 grid gap-3 sm:grid-cols-3">
          <Metric label="Mittleres Resonanzsignal" value={`${average}/100`} detail={scoreLabel(average)} tone={scoreTone(average)} />
          <Metric label="Starke Signale" value={`${strongSignals}`} detail={`von ${results.length} Meldungen`} tone={strongSignals ? 'high' : 'low'} />
          <Metric label="Manuell prüfen" value={`${lowConfidence}`} detail="Konfidenz unter 55 %" tone={lowConfidence ? 'medium' : 'low'} />
        </section>

        <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_12px_40px_rgba(16,31,45,0.06)]">
          <div className="flex flex-col gap-3 border-b border-[var(--line)] px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <h2 className="font-display text-lg font-semibold text-[var(--navy)]">Auswertung</h2>
              {isDemo && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-sky-700">Demo</span>}
              <span className="text-sm text-[var(--muted-ink)]">{visibleResults.length} Meldungen</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="search-field">
                <Search size={15} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Meldungen filtern" aria-label="Meldungen filtern" />
              </label>
              <select value={topicFilter} onChange={(event) => setTopicFilter(event.target.value as MainTopic | 'all')} className="compact-select" aria-label="Thema filtern">
                <option value="all">Alle Themen</option>
                {Object.entries(TOPICS).map(([key, topic]) => <option key={key} value={key}>{topic.short}</option>)}
              </select>
              <button className="icon-button" onClick={() => setSortDirection((current) => (current === 'desc' ? 'asc' : 'desc'))} aria-label="Sortierung wechseln" title="Sortierung wechseln">
                {sortDirection === 'desc' ? <ArrowDown size={16} /> : <ArrowUp size={16} />}
              </button>
              <button className="icon-button" onClick={exportResults} aria-label="Ergebnisse als JSON exportieren" title="JSON exportieren">
                <Download size={16} />
              </button>
            </div>
          </div>

          <div className="grid min-h-[560px] lg:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.8fr)]">
            <div className="overflow-x-auto border-b border-[var(--line)] lg:border-b-0 lg:border-r">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="bg-[var(--soft)] text-[11px] font-bold uppercase tracking-[0.11em] text-slate-500">
                    <th className="px-4 py-3">Meldung</th>
                    <th className="px-3 py-3">Hauptthema</th>
                    <th className="px-3 py-3">Verunsicherung</th>
                    <th className="px-3 py-3">Agenda-Nähe</th>
                    <th className="px-4 py-3 text-right">Resonanz</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleResults.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`cursor-pointer border-t border-[var(--line)] transition-colors hover:bg-cyan-50/40 ${selected?.id === item.id ? 'bg-cyan-50/70' : ''}`}
                    >
                      <td className="max-w-[420px] px-4 py-4 align-top">
                        <p className="font-semibold leading-5 text-[var(--navy)]">{item.title}</p>
                        <p className="mt-1 line-clamp-1 text-xs text-[var(--muted-ink)]">{item.source} · {item.description}</p>
                      </td>
                      <td className="px-3 py-4 align-top"><span className="topic-chip">{TOPICS[item.topic].short}</span></td>
                      <td className="px-3 py-4 align-top"><MiniBar value={item.uncertaintyIndex} /></td>
                      <td className="px-3 py-4 align-top"><span className="tabular-nums text-sm font-semibold">{formatPercent(item.overlap)}</span></td>
                      <td className="px-4 py-4 text-right align-top"><ScorePill score={item.resonanceScore} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!visibleResults.length && (
                <div className="grid min-h-56 place-items-center p-8 text-center">
                  <div><Search className="mx-auto mb-2 text-slate-300" /><p className="font-semibold text-[var(--navy)]">Keine Treffer</p><p className="text-sm text-[var(--muted-ink)]">Filter oder Suchbegriff anpassen.</p></div>
                </div>
              )}
            </div>

            <aside className="bg-[var(--soft)]/55 p-5 lg:p-6">
              {selected ? (
                <ResultDetail item={selected} />
              ) : (
                <div className="grid h-full place-items-center text-center text-sm text-[var(--muted-ink)]">Eine Meldung auswählen.</div>
              )}
            </aside>
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-[var(--line)] bg-white">
          <button onClick={() => setShowMethod((current) => !current)} className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left">
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-lg bg-[var(--soft)] text-[var(--teal)]"><Eye size={16} /></span>
              <div><h2 className="font-display font-semibold text-[var(--navy)]">Methodik & Grenzen</h2><p className="text-xs text-[var(--muted-ink)]">Gewichtung, Prüflogik und Interpretation</p></div>
            </div>
            <ChevronDown className={`transition-transform ${showMethod ? 'rotate-180' : ''}`} size={18} />
          </button>
          {showMethod && <Methodology />}
        </section>
      </div>

      <footer className="mx-auto flex max-w-[1500px] flex-col gap-2 px-5 pb-8 pt-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
        <p>Entscheidungshilfe für Redaktions- und Forschungsarbeit — Ergebnisse stets kontextuell prüfen.</p>
        <a href="https://docs.typesafe.ai/primitives" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--teal)] hover:underline">TypeSafe-Primitives <ExternalLink size={12} /></a>
      </footer>
    </main>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: 'high' | 'medium' | 'low' }) {
  return (
    <article className="flex items-end justify-between rounded-xl border border-[var(--line)] bg-white px-4 py-3.5">
      <div><p className="text-xs font-semibold text-[var(--muted-ink)]">{label}</p><p className="mt-1 text-xs text-slate-400">{detail}</p></div>
      <p className={`font-display text-3xl font-semibold tabular-nums metric-${tone}`}>{value}</p>
    </article>
  );
}

function MiniBar({ value }: { value: number }) {
  return (
    <div className="flex min-w-[118px] items-center gap-2">
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200"><span className={`block h-full rounded-full bar-${scoreTone(value)}`} style={{ width: `${value}%` }} /></span>
      <span className="w-7 text-right text-xs font-semibold tabular-nums">{value}</span>
    </div>
  );
}

function ScorePill({ score }: { score: number }) {
  return <span className={`score-pill score-${scoreTone(score)}`}>{score}</span>;
}

function ResultDetail({ item }: { item: ResultItem }) {
  const dimensions = [
    ['Bedrohung', item.dimensions.threat / 4],
    ['Kontrollverlust', item.dimensions.controlLoss / 4],
    ['Staatsversagen', item.dimensions.governmentFailure],
    ['Alltagsnähe', item.dimensions.personalProximity / 3],
    ['Schuldzuschreibung', item.dimensions.blame],
    ['Lösungslücke', item.dimensions.solutionGap],
    ['Polarisierung', item.dimensions.polarization / 3],
  ] as const;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div><p className="text-[11px] font-bold uppercase tracking-[0.13em] text-[var(--teal)]">Signaldetail</p><h3 className="mt-1 font-display text-xl font-semibold leading-6 text-[var(--navy)]">{item.title}</h3></div>
        <div className={`score-orbit orbit-${scoreTone(item.resonanceScore)}`}><strong>{item.resonanceScore}</strong><span>/100</span></div>
      </div>
      <p className="mt-3 text-sm leading-5 text-[var(--muted-ink)]">{item.description}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="topic-chip">{TOPICS[item.topic].label}</span>
        <span className="text-slate-500">Themen-Konfidenz {formatPercent(item.topicConfidence)}</span>
        {item.link && <a href={item.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-[var(--teal)] hover:underline">Quelle <ExternalLink size={11} /></a>}
      </div>

      <div className="my-5 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-[var(--line)] bg-white p-3"><p className="text-[11px] font-semibold text-slate-500">Verunsicherung</p><p className="mt-1 font-display text-2xl font-semibold text-[var(--navy)]">{item.uncertaintyIndex}<span className="text-sm text-slate-400">/100</span></p></div>
        <div className="rounded-xl border border-[var(--line)] bg-white p-3"><p className="text-[11px] font-semibold text-slate-500">AfD-Agenda-Nähe</p><p className="mt-1 font-display text-2xl font-semibold text-[var(--navy)]">{formatPercent(item.overlap)}</p></div>
      </div>

      <div className="space-y-3">
        {dimensions.map(([label, value]) => (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between text-xs"><span className="font-medium text-slate-600">{label}</span><span className="font-semibold tabular-nums text-[var(--navy)]">{Math.round(value * 100)} %</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-[var(--teal)]" style={{ width: `${value * 100}%` }} /></div>
          </div>
        ))}
      </div>

      <div className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-900">
        <p className="flex items-center gap-1.5 font-bold"><Check size={14} /> Interpretation</p>
        <p className="mt-1">{item.resonanceScore >= 65 ? 'Mehrere verunsichernde Frames treffen deutlich auf ein AfD-nahes Themenfeld.' : item.resonanceScore >= 40 ? 'Einzelne verunsichernde Frames und thematische Überschneidungen sind erkennbar.' : 'Wenig verunsichernde Rahmung oder nur geringe thematische Überschneidung.'}</p>
        {item.confidence < 0.55 && <p className="mt-1 font-semibold text-amber-800">Niedrige Modellkonfidenz: manuelle Prüfung empfohlen.</p>}
      </div>
    </div>
  );
}

function Methodology() {
  return (
    <div className="grid gap-6 border-t border-[var(--line)] px-5 py-5 text-sm leading-6 text-[var(--muted-ink)] md:grid-cols-3">
      <div><h3 className="font-semibold text-[var(--navy)]">1. Atomare JEV-Fragen</h3><p className="mt-1">Thema, Bedrohung, Kontrollverlust, Staatsversagen, Alltagsnähe, Schuldzuschreibung, Lösungslücke und Polarisierung werden unabhängig bewertet. Das vermeidet eine einzige überladene „AfD-Wirkung“-Frage.</p></div>
      <div><h3 className="font-semibold text-[var(--navy)]">2. Transparente Komposition</h3><p className="mt-1">Der Verunsicherungsindex gewichtet sieben beobachtbare Frames. Das Resonanzsignal kombiniert ihn zu 75 % mit 25 % AfD-Agenda-Nähe. Gewichte liegen im Code, nicht in einem versteckten Prompt.</p></div>
      <div><h3 className="font-semibold text-[var(--navy)]">3. Klare Grenze</h3><p className="mt-1">Gemessen wird nur Titel plus Kurzbeschreibung. Keine Aussage über Wahrheit, Reichweite, individuelle Emotionen, Kausalität oder tatsächliche Wahlentscheidung. Niedrige Konfidenzen gehören in eine manuelle Prüfung.</p></div>
    </div>
  );
}

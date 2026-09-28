type FeedItem = {
  id: string;
  feedId: string;
  title: string;
  description: string;
  source: string;
  link?: string;
  publishedAt?: string;
};

type Answer = {
  type: 'choice' | 'score' | 'noul';
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: number;
};

const MAIN_TOPICS = {
  migration_asylum: 'Einwanderung, Asyl, Flucht, Abschiebung oder Integration stehen im Mittelpunkt.',
  crime_security: 'Kriminalität, Polizei, innere Sicherheit, Extremismus oder öffentliche Ordnung stehen im Mittelpunkt.',
  economy_costs_jobs: 'Wirtschaft, Inflation, Preise, Lebenshaltungskosten, Steuern, Arbeit oder Beschäftigung stehen im Mittelpunkt.',
  energy_climate: 'Energieversorgung, Energiepreise, Klima-, Verkehrs- oder Umweltpolitik stehen im Mittelpunkt.',
  public_services_state: 'Öffentliche Dienste, Infrastruktur, Verwaltung oder staatliche Handlungsfähigkeit stehen im Mittelpunkt.',
  war_foreign_policy: 'Krieg, internationale Konflikte, Außen-, Europa- oder Verteidigungspolitik stehen im Mittelpunkt.',
  democracy_social_cohesion: 'Demokratische Institutionen, politische Polarisierung oder gesellschaftlicher Zusammenhalt stehen im Mittelpunkt.',
  other: 'Ein anderes klar bestimmbares Thema steht im Mittelpunkt.',
  unclear: 'Aus Titel und Kurzbeschreibung lässt sich kein Hauptthema bestimmen.',
};

const THREAT_LEVELS = [
  'Keine konkrete Bedrohung oder negative Zukunftsentwicklung wird dargestellt.',
  'Ein begrenztes Problem oder Risiko wird erwähnt; mögliche Folgen wirken überschaubar.',
  'Ein relevantes Risiko oder eine unsichere Entwicklung wird beschrieben, ohne akute oder weitreichende Bedrohung.',
  'Eine ernste mögliche Entwicklung oder deutliche Unsicherheit wird prominent betont.',
  'Eine akute, sehr schwere oder weitreichende Bedrohung wird stark betont.',
];

const CONTROL_LEVELS = [
  'Kein Kontrollverlust; Akteure, Verfahren oder Lösungen wirken handlungsfähig.',
  'Leichte Schwierigkeiten, aber grundsätzliche Handlungsfähigkeit ist erkennbar.',
  'Unklare Steuerung oder begrenzte Kontrolle wird angedeutet.',
  'Deutlicher Kontrollverlust oder fehlende Steuerungsfähigkeit wird hervorgehoben.',
  'Die Lage wird als außer Kontrolle und ohne wirksame Gegenmaßnahmen dargestellt.',
];

const PROXIMITY_LEVELS = [
  'Keine erkennbare Auswirkung auf Alltag, Sicherheit oder finanzielle Lage der Bevölkerung.',
  'Indirekte oder auf einzelne Gruppen begrenzte Alltagsauswirkung.',
  'Konkrete Auswirkung auf viele Haushalte, Arbeit, Preise, Sicherheit oder örtliches Leben.',
  'Unmittelbare und starke Auswirkung auf elementare Sicherheit, Existenz oder täglichen Alltag breiter Gruppen.',
];

const POLARIZATION_LEVELS = [
  'Nüchterne Darstellung ohne ausgeprägtes Konflikt- oder Lagerdenken.',
  'Politischer Streit oder unterschiedliche Positionen werden erwähnt.',
  'Ein scharfer gesellschaftlicher oder politischer Gegensatz wird hervorgehoben.',
  'Die Darstellung teilt Akteure deutlich in gegnerische Lager oder nutzt eskalierende Konfliktsprache.',
];

function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, names: string[]) {
  for (const name of names) {
    const match = block.match(new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${name}>`, 'i'));
    if (match) return decodeXml(match[1]);
  }
  return '';
}

function parseFeed(xml: string, sourceUrl: string, limit: number, feedId: string): FeedItem[] {
  const channelTitle = tag(xml, ['title']) || new URL(sourceUrl).hostname;
  const itemBlocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((match) => match[1]);
  const entryBlocks = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((match) => match[1]);
  const blocks = itemBlocks.length ? itemBlocks : entryBlocks;

  return blocks.slice(0, limit).map((block, index) => {
    const linkText = tag(block, ['link']);
    const href = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
    return {
      id: `${feedId}-item-${index + 1}`,
      feedId,
      title: tag(block, ['title']) || 'Ohne Titel',
      description: tag(block, ['description', 'summary', 'content', 'encoded']).slice(0, 1800),
      source: channelTitle,
      link: href || linkText || undefined,
      publishedAt: tag(block, ['pubDate', 'published', 'updated']) || undefined,
    };
  });
}

function safeNumber(answer: Answer | undefined, field: 'score' | 'noul', fallback = 0) {
  const value = answer?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function buildQuestions(items: FeedItem[]) {
  const questions: Record<string, unknown> = {};
  const basis = 'Bewerte ausschließlich die angegebene Position aus `rss_items`, also Titel und Kurzbeschreibung. Unterstelle weder Fakten außerhalb des Textes noch eine tatsächliche emotionale oder politische Wirkung.';

  items.forEach((_, index) => {
    const path = `rss_items[${index}]`;
    questions[`i${index}_topic`] = {
      type: 'choice',
      instructions: `Was ist das eine zentrale Hauptthema in \`${path}.title\` und \`${path}.description\`? Entscheide nach dem dominanten Gegenstand, nicht nach Nebenbegriffen. ${basis}`,
      criteria: MAIN_TOPICS,
    };
    questions[`i${index}_threat`] = {
      type: 'score',
      instructions: `Wie stark stellt \`${path}\` eine Bedrohung, einen Schaden oder eine unsichere negative Zukunft in den Mittelpunkt? ${basis}`,
      criteria: THREAT_LEVELS,
    };
    questions[`i${index}_control`] = {
      type: 'score',
      instructions: `Wie stark rahmt \`${path}\` die Lage als unkontrolliert, nicht mehr steuerbar oder ohne wirksame Gegenmaßnahmen? Ein Problem allein ist noch kein Kontrollverlust. ${basis}`,
      criteria: CONTROL_LEVELS,
    };
    questions[`i${index}_government`] = {
      type: 'noul',
      instructions: `Stellt \`${path}\` Regierung, Behörden, demokratische Institutionen oder öffentliche Dienste ausdrücklich als unfähig, untätig, überfordert oder gescheitert dar? Ein berichtetes Problem ohne solche Zuschreibung zählt als nein. ${basis}`,
      criteria: { true: 'Eine ausdrückliche negative Zuschreibung staatlicher Handlungsfähigkeit liegt vor.', false: 'Keine solche Zuschreibung; bloße Problembeschreibung oder neutrale Kritik.' },
    };
    questions[`i${index}_proximity`] = {
      type: 'score',
      instructions: `Wie unmittelbar betrifft die in \`${path}\` dargestellte Entwicklung Alltag, finanzielle Lage, Arbeit oder persönliche Sicherheit der Bevölkerung in Deutschland? ${basis}`,
      criteria: PROXIMITY_LEVELS,
    };
    questions[`i${index}_blame`] = {
      type: 'noul',
      instructions: `Weist \`${path}\` einem politischen oder staatlichen Akteur ausdrücklich Verantwortung oder Schuld für das negative Problem zu? Die bloße Nennung eines zuständigen Akteurs zählt als nein. ${basis}`,
      criteria: { true: 'Explizite Verantwortungs- oder Schuldzuschreibung.', false: 'Keine explizite Zuschreibung.' },
    };
    questions[`i${index}_solution_gap`] = {
      type: 'noul',
      instructions: `Betont \`${path}\`, dass Lösungen fehlen, Maßnahmen nicht wirken oder keine Besserung absehbar ist? Ein Problem mit benannter Gegenmaßnahme zählt eher als nein. ${basis}`,
      criteria: { true: 'Fehlende oder unwirksame Lösungen werden betont.', false: 'Keine Lösungslücke wird betont oder konkrete Abhilfe ist erkennbar.' },
    };
    questions[`i${index}_polarization`] = {
      type: 'score',
      instructions: `Wie stark verwendet \`${path}\` konfliktverschärfende, polarisierende oder lagerbildende Rahmung? ${basis}`,
      criteria: POLARIZATION_LEVELS,
    };
    questions[`i${index}_overlap`] = {
      type: 'noul',
      instructions: `Betrifft das zentrale Thema von \`${path}\` mindestens einen Bereich, den die AfD in Deutschland regelmäßig politisch priorisiert: Migration und Asyl, Kriminalität und innere Sicherheit, Lebenshaltungskosten oder wirtschaftliche Unsicherheit, Energie- und Klimapolitik, nationale Souveränität oder staatliche Handlungsfähigkeit? Werte nur die thematische Überschneidung, weder Zustimmung noch Wahlwirkung. ${basis}`,
      criteria: { true: 'Klare thematische Überschneidung mit mindestens einem genannten Bereich.', false: 'Keine oder nur beiläufige Überschneidung.' },
    };
  });
  return questions;
}

function isUnsafeHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0' || host === '::1' || host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.') || host.startsWith('169.254.') || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
}

class JevRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function analyzeBatch(feedItems: FeedItem[], apiKey: string) {
  const jevResponse = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: { rss_items: feedItems }, model: 'jev-latest', questions: buildQuestions(feedItems) }),
    signal: AbortSignal.timeout(45000),
  });

  const jevPayload = (await jevResponse.json()) as { answers?: Record<string, Answer> };
  if (!jevResponse.ok || !jevPayload.answers) {
    const message = jevResponse.status === 401 ? 'Der TypeSafe API-Key wurde nicht akzeptiert.' : jevResponse.status === 429 ? 'Das TypeSafe-Limit ist erreicht. Bitte kurz warten.' : `JEV konnte die Meldungen nicht bewerten (${jevResponse.status}).`;
    throw new JevRequestError(message, jevResponse.status || 502);
  }

  return feedItems.map((item, index) => {
    const answer = (name: string) => jevPayload.answers?.[`i${index}_${name}`];
    const threat = safeNumber(answer('threat'), 'score');
    const controlLoss = safeNumber(answer('control'), 'score');
    const governmentFailure = safeNumber(answer('government'), 'noul');
    const personalProximity = safeNumber(answer('proximity'), 'score');
    const blame = safeNumber(answer('blame'), 'noul');
    const solutionGap = safeNumber(answer('solution_gap'), 'noul');
    const polarization = safeNumber(answer('polarization'), 'score');
    const overlap = safeNumber(answer('overlap'), 'noul');

    const uncertaintyIndex = Math.round(100 * (
      0.25 * (threat / 4) +
      0.2 * (controlLoss / 4) +
      0.15 * governmentFailure +
      0.1 * (personalProximity / 3) +
      0.1 * blame +
      0.1 * solutionGap +
      0.1 * (polarization / 3)
    ));
    const resonanceScore = Math.round(0.75 * uncertaintyIndex + 25 * overlap);
    const confidenceValues = ['topic', 'threat', 'control', 'proximity', 'polarization']
      .map((name) => answer(name)?.confidence)
      .filter((value): value is number => typeof value === 'number');

    return {
      ...item,
      topic: answer('topic')?.choice || 'unclear',
      topicConfidence: answer('topic')?.confidence ?? 0,
      uncertaintyIndex,
      resonanceScore,
      overlap,
      confidence: confidenceValues.length ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0,
      dimensions: { threat, controlLoss, governmentFailure, personalProximity, blame, solutionGap, polarization },
    };
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { apiKey?: string; feedUrl?: string; feedUrls?: string[]; limit?: number };
    const apiKey = body.apiKey?.trim();
    const rawFeedUrls = Array.isArray(body.feedUrls) ? body.feedUrls : body.feedUrl ? [body.feedUrl] : [];
    const feedUrls = [...new Set(rawFeedUrls.map((url) => url.trim()).filter(Boolean))];
    const limit = Math.min(40, Math.max(1, Number(body.limit) || 8));

    if (!apiKey || !feedUrls.length) return Response.json({ error: 'API-Key und mindestens eine Feed-URL sind erforderlich.' }, { status: 400 });
    if (feedUrls.length > 5) return Response.json({ error: 'Es können höchstens fünf Feeds verglichen werden.' }, { status: 400 });

    const parsedUrls: URL[] = [];
    for (const feedUrl of feedUrls) {
      let parsedUrl: URL;
      try { parsedUrl = new URL(feedUrl); } catch { return Response.json({ error: `Ungültige Feed-URL: ${feedUrl}` }, { status: 400 }); }
      if (!['http:', 'https:'].includes(parsedUrl.protocol) || isUnsafeHost(parsedUrl.hostname)) {
        return Response.json({ error: `Diese Feed-Adresse ist aus Sicherheitsgründen nicht zulässig: ${feedUrl}` }, { status: 400 });
      }
      parsedUrls.push(parsedUrl);
    }

    const feedGroups = await Promise.all(parsedUrls.map(async (parsedUrl, index) => {
      const feedResponse = await fetch(parsedUrl.toString(), {
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9', 'User-Agent': 'ResonanzRadar/1.0' },
        signal: AbortSignal.timeout(12000),
      });
      if (!feedResponse.ok) throw new JevRequestError(`Feed ${index + 1} konnte nicht geladen werden (${feedResponse.status}).`, 400);

      const xml = await feedResponse.text();
      if (xml.length > 2_000_000) throw new JevRequestError(`Feed ${index + 1} ist größer als 2 MB.`, 413);
      const items = parseFeed(xml, parsedUrl.toString(), limit, `feed-${index + 1}`).filter((item) => item.title || item.description);
      if (!items.length) throw new JevRequestError(`In Feed ${index + 1} wurden keine RSS- oder Atom-Meldungen gefunden.`, 422);
      return items;
    }));
    const feedItems = feedGroups.flat();

    const batches: FeedItem[][] = [];
    for (let start = 0; start < feedItems.length; start += 10) batches.push(feedItems.slice(start, start + 10));

    const items = [];
    for (let start = 0; start < batches.length; start += 2) {
      const groupResults = await Promise.all(batches.slice(start, start + 2).map((batch) => analyzeBatch(batch, apiKey)));
      items.push(...groupResults.flat());
    }

    return Response.json({ model: 'jev-latest', feeds: feedGroups.length, perFeedLimit: limit, batches: batches.length, items });
  } catch (error) {
    if (error instanceof JevRequestError) return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.name === 'TimeoutError') return Response.json({ error: 'Die Anfrage hat zu lange gedauert. Bitte erneut versuchen.' }, { status: 504 });
    return Response.json({ error: 'Die Anfrage konnte nicht verarbeitet werden.' }, { status: 500 });
  }
}

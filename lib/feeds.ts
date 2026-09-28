import { XMLParser } from 'fast-xml-parser';
import { SyntaxValidator } from 'fast-xml-validator';
import he from 'he';
import type { FeedInfo, FeedItem } from './analysis';

function text(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (value && typeof value === 'object') return text((value as Record<string, unknown>)['#text']);
  return '';
}
export function cleanText(value: unknown) {
  return he.decode(text(value)).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}
export function parseDate(value: unknown): string | undefined {
  const normalized = text(value).replace(/\bCEST\b/g, '+0200').replace(/\bCET\b/g, '+0100');
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}
export function publicUrl(value: string) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || (url.port && !['80', '443'].includes(url.port)) || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || ['.local', '.internal', '.localhost', '.test'].some((suffix) => host.endsWith(suffix))) throw new Error('Bitte eine öffentliche RSS- oder Atom-Adresse verwenden.');
  return url;
}
function safeLink(value: string, base: string) {
  if (!value) return undefined;
  try { const url = new URL(value, base); if (!['http:', 'https:'].includes(url.protocol)) return undefined; url.hash = ''; const trackingKeys = Array.from(url.searchParams.keys()).filter((key) => key.startsWith('utm_')); for (const key of trackingKeys) url.searchParams.delete(key); return url.toString(); } catch { return undefined; }
}
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : value == null ? [] : [value];
export function parseFeed(xml: string, url: string, id: string, limit: number, hours: number, now: number): { info: FeedInfo; items: FeedItem[] } {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Der Feed enthält nicht unterstützte XML-Deklarationen.');
  SyntaxValidator.validate(xml);
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, trimValues: true }).parse(xml);
  const channel = parsed.rss?.channel ?? parsed.feed;
  if (!channel) throw new Error('Keine RSS-2.0- oder Atom-Daten gefunden.');
  const entries = array(channel.item ?? channel.entry) as Record<string, unknown>[];
  const name = cleanText(channel.title) || new URL(url).hostname;
  const info: FeedInfo = { id, url, name, available: entries.length, duplicates: 0, undated: 0, outsideWindow: 0, eligible: 0, selected: 0, failed: 0 };
  const seenLinks = new Set<string>(); const seenTitles = new Set<string>(); const items: FeedItem[] = [];
  for (const [index, entry] of entries.entries()) {
    const title = cleanText(entry.title);
    if (!title) continue;
    const linkEntry = array(entry.link).find((l) => typeof l === 'string' || (l && typeof l === 'object' && (!(l as Record<string, unknown>)['@_rel'] || (l as Record<string, unknown>)['@_rel'] === 'alternate')));
    const link = safeLink(typeof linkEntry === 'object' && linkEntry ? text((linkEntry as Record<string, unknown>)['@_href']) : text(linkEntry), url);
    const titleKey = title.toLocaleLowerCase('de');
    if ((link && seenLinks.has(link)) || seenTitles.has(titleKey)) { info.duplicates++; continue; }
    if (link) seenLinks.add(link); seenTitles.add(titleKey);
    const publishedAt = parseDate(entry.pubDate ?? entry.published ?? entry.updated ?? entry['dc:date']);
    if (!publishedAt) info.undated++;
    if (hours > 0 && (!publishedAt || now - Date.parse(publishedAt) > hours * 3600000 || Date.parse(publishedAt) > now + 300000)) { info.outsideWindow++; continue; }
    const description = cleanText(entry.description ?? entry.summary ?? entry['content:encoded'] ?? entry.content);
    items.push({ id: `${id}-${index}`, feedId: id, title: title.slice(0, 600), description: description.slice(0, 1800), source: name, link, publishedAt, truncated: title.length > 600 || description.length > 1800 || /(?:\.\.\.|…)\s*$/.test(description) });
  }
  items.sort((a, b) => (Date.parse(b.publishedAt ?? '') || 0) - (Date.parse(a.publishedAt ?? '') || 0));
  info.eligible = items.length; info.selected = Math.min(limit, items.length);
  return { info, items: items.slice(0, limit) };
}
export async function fetchFeed(input: string, signal?: AbortSignal) {
  let url = publicUrl(input);
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(url, { redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'User-Agent': 'ResonanzRadar/2.0' } });
    if (response.status >= 300 && response.status < 400) { const location = response.headers.get('location'); await response.body?.cancel(); if (!location) throw new Error('Feed-Weiterleitung ohne Ziel.'); url = publicUrl(new URL(location, url).toString()); continue; }
    if (!response.ok) throw new Error(`Feed antwortet mit HTTP ${response.status}.`);
    const reader = response.body?.getReader(); if (!reader) throw new Error('Feed ist leer.');
    const decoder = new TextDecoder(); let size = 0; let xml = '';
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > 2_000_000) { await reader.cancel(); throw new Error('Feed überschreitet 2 MB.'); } xml += decoder.decode(chunk.value, { stream: true }); }
    return xml + decoder.decode();
  }
  throw new Error('Zu viele Feed-Weiterleitungen.');
}

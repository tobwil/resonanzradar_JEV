import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseFeed, parseDate, cleanText, publicUrl } from '../lib/feeds.ts';
import { questionsFor, validateAnswers, decodeAnalysis, matchedTopics, DIMENSION_KEYS } from '../lib/analysis.ts';

const now = Date.parse('2026-09-28T08:00:00Z');
const article = { id: '1', feedId: 'a', source: 'Unknown source', title: 'Regierung wird wegen Ausfällen kritisiert', description: 'Die Opposition wirft dem Minister Untätigkeit vor.', truncated: false };
function modelAnswers(item = article) {
  return Object.fromEntries(Object.entries(questionsFor(item)).map(([key, question]) => {
    const keys = Array.isArray(question.criteria) ? question.criteria.map((_, i) => String(i)) : Object.keys(question.criteria);
    const choice = question.type === 'choice' ? (keys.includes('none') ? 'none' : keys[0]) : '0';
    return [key, { type: question.type, ...(question.type === 'score' ? { score: 0 } : { choice }), confidence: 0.9, probabilities: Object.fromEntries(keys.map((k) => [k, k === choice ? 1 : 0])) }];
  }));
}
test('RSS parses CDATA, decodes text, sorts before limiting and removes duplicate titles', () => {
  const xml = '<rss><channel><title>Feed</title><item><title>Older</title><pubDate>Sun, 27 Sep 2026 11:00:00 CEST</pubDate></item><item><title><![CDATA[Neu & laut]]></title><description><![CDATA[&lt;p&gt;Ein &amp; zwei&lt;/p&gt;]]></description><pubDate>Mon, 28 Sep 2026 09:00:00 CEST</pubDate></item><item><title>Neu &amp; laut</title><pubDate>Mon, 28 Sep 2026 09:00:00 CEST</pubDate></item><item><title>Undated</title></item></channel></rss>';
  const { info, items } = parseFeed(xml, 'https://example.org/rss', 'a', 1, 24, now);
  assert.equal(items[0].title, 'Neu & laut'); assert.equal(items[0].description, 'Ein & zwei');
  assert.equal(info.duplicates, 1); assert.equal(info.undated, 1); assert.equal(info.eligible, 2); assert.equal(info.selected, 1);
});
test('Atom selects alternate article link instead of self link', () => {
  const xml = '<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom</title><entry><title>Story</title><link rel="self" href="https://example.org/api"/><link rel="alternate" href="/story"/><summary>Text</summary><updated>2026-09-28T07:00:00Z</updated></entry></feed>';
  assert.equal(parseFeed(xml, 'https://example.org/feed', 'a', 10, 24, now).items[0].link, 'https://example.org/story');
});
test('dates and encoded markup are normalized, malformed XML and private URLs rejected', () => {
  assert.equal(parseDate('Mon, 28 Sep 2026 09:00:00 CEST'), '2026-09-28T07:00:00.000Z');
  assert.equal(cleanText('&lt;p&gt;Gro&szlig;e Nachricht&lt;/p&gt;'), 'Große Nachricht');
  assert.throws(() => parseFeed('<rss><x></rss>', 'https://example.org', 'a', 10, 0, now));
  assert.throws(() => publicUrl('http://127.0.0.1')); assert.throws(() => publicUrl('http://[::1]'));
});
test('missing, out-of-range and invalid answers never become zero scores', () => {
  const q = questionsFor(article); const valid = modelAnswers(); validateAnswers(valid, q);
  const missing = structuredClone(valid); delete missing.sensationalism; assert.throws(() => validateAnswers(missing, q));
  const invalid = structuredClone(valid); invalid.threat.score = 8; assert.throws(() => validateAnswers(invalid, q));
  const choices = structuredClone(valid); choices.topic.choice = 'invented'; assert.throws(() => validateAnswers(choices, q));
  const distribution = structuredClone(valid); distribution.topic.probabilities = {}; assert.throws(() => validateAnswers(distribution, q));
});
test('a serious event can have low linguistic amplification; absent evidence triggers review', () => {
  const answers = modelAnswers(); answers.threat.score = 4; answers.political.score = 3;
  const item = decodeAnalysis(article, answers, 'test-model');
  assert.equal(item.scores.threat, 100); assert.equal(item.scores.sensationalism, 0);
  assert.equal(item.evidence.political, null); assert.ok(item.review.some((r) => r.includes('Textstelle')));
});
test('evidence returns only exact input spans', () => {
  const answers = modelAnswers(); answers.politicalEvidence.choice = 's0';
  assert.equal(decodeAnalysis(article, answers, 'test-model').evidence.political, article.description);
});
test('matched topics use identical topic weights and require two items per feed', () => {
  const make = (feedId, topic, value) => ({ feedId, topic, scores: Object.fromEntries(DIMENSION_KEYS.map((k) => [k, value])) });
  const rows = [...Array.from({ length: 8 }, () => make('a', 'security', 80)), make('a', 'economy', 20), make('a', 'economy', 20), make('b', 'security', 80), make('b', 'security', 80), ...Array.from({ length: 8 }, () => make('b', 'economy', 20))];
  const result = matchedTopics(rows, ['a', 'b']); assert.equal(result.feeds[0].scores.threat, 50); assert.equal(result.feeds[1].scores.threat, 50);
  assert.equal(matchedTopics(rows, ['a', 'b', 'missing']).topics.length, 0);
});
test('publisher metadata does not affect question construction', () => {
  assert.deepEqual(questionsFor({ ...article, source: 'BILD' }), questionsFor({ ...article, source: 'tagesschau' }));
});
test('optional captured real feeds parse and preserve their titles and dates', async (t) => {
  for (const name of ['bild', 'tagesschau']) {
    let xml; try { xml = await readFile(`/tmp/jev-${name}.xml`, 'utf8'); } catch { t.skip('Live snapshots not present'); return; }
    const { info, items } = parseFeed(xml, `https://www.${name}.de/feed`, name, 40, 0, now);
    assert.equal(items.length, 40); assert.equal(info.undated, 0); assert.ok(items.every((i) => i.title && i.description && i.publishedAt));
  }
});

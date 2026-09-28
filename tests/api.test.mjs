import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'jev-api-test-'));
const output = join(directory, 'api.mjs');
await build({ entryPoints: ['app/api/analyze/route.ts'], outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { POST } = await import(pathToFileURL(output).href);
const xml = '<rss><channel><title>SECRET PUBLISHER</title>' + Array.from({ length: 40 }, (_, i) => `<item><title>Artikel ${i}</title><description>Ein kurzer Nachrichtentext.</description><pubDate>${new Date(Date.now() - i * 60000).toUTCString()}</pubDate></item>`).join('') + '</channel></rss>';
function mockPayload(questions) {
  return { model: 'jev-test', answers: Object.fromEntries(Object.entries(questions).map(([k, q]) => {
    const keys = Array.isArray(q.criteria) ? q.criteria.map((_, i) => String(i)) : Object.keys(q.criteria);
    const choice = keys.includes('none') ? 'none' : keys[0];
    return [k, { type: q.type, ...(q.type === 'score' ? { score: 0 } : { choice }), confidence: 1, probabilities: Object.fromEntries(keys.map((o) => [o, o === choice ? 1 : 0])) }];
  })) };
}
test('five feeds × 40 items stream 200 distinct results; model receives no publisher metadata', async () => {
  const realFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).includes('api.typesafe.ai')) return new Response(xml);
    calls++; const payload = JSON.parse(options.body);
    assert.equal(JSON.stringify(payload.state).includes('SECRET PUBLISHER'), false);
    assert.ok(payload.state.articles.length <= 5);
    assert.ok(Object.values(payload.questions).every((q) => !q.instructions.includes('`article.')));
    return Response.json(mockPayload(payload.questions));
  };
  try {
    const response = await POST(new Request('https://app.example/api/analyze', { method: 'POST', body: JSON.stringify({ apiKey: 'test-only', feedUrls: Array.from({ length: 5 }, (_, i) => `https://feed${i}.example/rss`), limit: 40, hours: 72 }) }));
    const events = (await response.text()).trim().split('\n').map(JSON.parse); const final = events.at(-1).report;
    assert.equal(response.status, 200); assert.equal(final.items.length, 200); assert.equal(calls, 40);
    assert.equal(new Set(final.items.map((i) => i.id)).size, 200); assert.ok(final.feeds.every((f) => f.selected === 40 && f.failed === 0));
    assert.ok(events.some((e) => e.type === 'progress' && e.done === 200)); assert.equal(final.models[0], 'jev-test');
    assert.equal(events.some((e) => e.type === 'debug'), false);
  } finally { globalThis.fetch = realFetch; }
});
test('invalid model answers are excluded and counted, never silently scored zero', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => String(url).includes('api.typesafe.ai') ? Response.json({ model: 'jev-test', answers: {} }) : new Response(xml);
  try {
    const response = await POST(new Request('https://app.example/api/analyze', { method: 'POST', body: JSON.stringify({ apiKey: 'test-only', feedUrls: ['https://feed.example/rss'], limit: 5, hours: 72 }) }));
    const result = (await response.text()).trim().split('\n').map(JSON.parse).at(-1).report;
    assert.equal(result.items.length, 0); assert.equal(result.feeds[0].failed, 5); assert.equal(result.warnings.length, 5);
  } finally { globalThis.fetch = realFetch; }
});
test('more than five feeds and invalid limits are rejected before network activity', async () => {
  for (const values of [{ limit: 41, feedUrls: ['https://feed.example'] }, { limit: 5, feedUrls: Array.from({ length: 6 }, (_, i) => `https://feed${i}.example`) }]) {
    const response = await POST(new Request('https://app.example/api/analyze', { method: 'POST', body: JSON.stringify({ apiKey: 'test-only', hours: 72, ...values }) })); assert.equal(response.status, 400);
  }
});

async function capture(provider, apiKey = 'test-private-key') {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => String(url).includes('api.typesafe.ai') ? provider(options) : new Response(xml);
  try {
    const response = await POST(new Request('https://app.example/api/analyze', { method: 'POST', body: JSON.stringify({ apiKey, feedUrls: ['https://feed.example/rss'], limit: 5, hours: 72, debug: true }) }));
    const text = await response.text();
    return { text, events: text.trim().split('\n').map(JSON.parse) };
  } finally { globalThis.fetch = realFetch; }
}
test('debug preserves actual request, untouched provider fields and mapping, without extra calls', async () => {
  let calls = 0; let sent; let returned;
  const { events } = await capture((options) => {
    calls++; sent = JSON.parse(options.body);
    returned = JSON.stringify({ ...mockPayload(sent.questions), provider_extra: { usage: 123, trace: 'keep-me' } });
    return new Response(returned, { headers: { 'content-type': 'application/json', 'x-request-id': 'request-123', 'set-cookie': 'NEVER INCLUDE' } });
  });
  const debug = events.filter((e) => e.type === 'debug');
  assert.equal(calls, 1); assert.equal(debug.length, 2);
  assert.equal(debug[0].batch.response, undefined);
  const batch = debug[1].batch;
  assert.deepEqual(batch.request, sent); assert.equal(batch.response.bodyText, returned);
  assert.equal(batch.response.headers['x-request-id'], 'request-123');
  assert.equal(batch.response.headers['set-cookie'], undefined);
  assert.equal(batch.articles.length, 5); assert.equal(batch.validation.length, 0);
  assert.ok(batch.durationMs >= 0); assert.ok(batch.completedAt);
  assert.equal(events.at(-1).report.items.length, 5);
});
test('debug retains rejected answers and per-article validation errors', async () => {
  const { events } = await capture(() => Response.json({ model: 'jev-test', answers: {}, extra: 'raw' }));
  const batch = events.filter((e) => e.type === 'debug').at(-1).batch;
  assert.equal(JSON.parse(batch.response.bodyText).extra, 'raw');
  assert.equal(batch.validation.length, 5);
  assert.equal(events.at(-1).report.items.length, 0);
});
test('debug retains non-JSON errors and redacts reflected credentials everywhere', async () => {
  const key = 'secret-"quoted\\key/value';
  const { events, text } = await capture(() => new Response(`Denied ${key} ${JSON.stringify(key)} ${encodeURIComponent(key)}`, { status: 401, headers: { 'x-request-id': key } }), key);
  const batch = events.filter((e) => e.type === 'debug').at(-1).batch;
  assert.equal(batch.response.status, 401);
  assert.match(batch.response.bodyText, /\[REDACTED\]/);
  assert.equal(batch.response.bodyText.includes(key), false);
  assert.equal(text.includes('secret-'), false);
  assert.match(batch.error, /API-Key/);
  assert.equal(events.at(-1).report.feeds[0].failed, 5);
});
test('malformed success and network failures remain distinguishable in debug', async () => {
  for (const provider of [() => new Response('<html>not JSON</html>'), () => { throw new Error('Network failure test-private-key'); }]) {
    const { text, events } = await capture(provider);
    const batch = events.filter((e) => e.type === 'debug').at(-1).batch;
    assert.ok(batch.error); assert.equal(text.includes('test-private-key'), false);
    assert.equal(events.at(-1).report.items.length, 0);
    if (batch.response) assert.equal(batch.response.bodyText, '<html>not JSON</html>');
    else assert.match(batch.error, /Network failure/);
  }
});

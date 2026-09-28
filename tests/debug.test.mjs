import test from 'node:test';
import assert from 'node:assert/strict';
import { readModelBody, recordBatch, redactKey } from '../lib/debug.ts';

test('debug capture merges out-of-order batches and retains partial data after cancellation', () => {
  let run = { batches: [], status: 'running' };
  run = recordBatch(run, { id: 2, request: { model: 'jev-latest' } });
  run = recordBatch(run, { id: 1, request: { model: 'jev-latest' } });
  run = recordBatch(run, { id: 2, response: { bodyText: 'complete' } });
  run = { ...run, status: 'cancelled' };
  assert.deepEqual(run.batches.map((b) => b.id), [1, 2]);
  assert.equal(run.batches[0].response, undefined);
  assert.equal(run.batches[1].response.bodyText, 'complete');
  assert.equal(run.report, undefined);
});
test('redaction preserves valid JSON even for control characters in the key', () => {
  const key = 'private\n"key\\here';
  const data = { response: JSON.stringify({ reflected: key }), error: key, normal: { score: 3 } };
  const safe = redactKey(data, key);
  assert.equal(safe.error, '[REDACTED]');
  assert.equal(JSON.parse(safe.response).reflected, '[REDACTED]');
  assert.deepEqual(safe.normal, { score: 3 });
});
test('oversized model bodies are bounded and marked, not silently parsed', async () => {
  assert.deepEqual(await readModelBody(new Response('abcdef'), 4), { bodyText: 'abcd', truncated: true });
  assert.deepEqual(await readModelBody(new Response('abcd'), 4), { bodyText: 'abcd', truncated: false });
});

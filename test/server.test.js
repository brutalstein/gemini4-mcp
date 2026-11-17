import test from 'node:test';
import assert from 'node:assert/strict';
import { createGateway } from '../src/server.js';

const MOD = 'gemini-4-carbon-high';
const payload = { model: 'claude-sonnet-4-6', max_tokens: 100, messages: [{ role: 'user', content: 'hello' }] };
function mockProvider() {
  const calls = [];
  return {
    calls,
    async models() { return [{ id: MOD, name: 'Gemini 4 Carbon (High)' }]; },
    async generate(options) {
      calls.push(options);
      return { value: { kind: 'final', text: 'hello from Gemini', tool_calls: [] }, usage: { input_tokens: 12, output_tokens: 4 } };
    }
  };
}
async function gateway(t, provider = mockProvider()) {
  const g = createGateway({ provider, model: MOD, token: 'test-token' });
  const { baseURL } = await g.listen();
  t.after(() => new Promise(resolve => g.server.close(resolve)));
  return { url: baseURL, provider };
}
const auth = { authorization: 'Bearer test-token', 'content-type': 'application/json' };
const post = (url, path, body, headers = auth) => fetch(url + path, { method: 'POST', headers, body: JSON.stringify(body) });

test('health endpoint and local-only bind', async t => {
  const { url } = await gateway(t);
  assert.deepEqual((await (await fetch(url + '/healthz')).json()).ok, true);
  const g = createGateway({ model: MOD });
  await assert.rejects(g.listen(0, '0.0.0.0'), /loopback/);
});
test('refuses all model requests without correct local authorization', async t => {
  const { url, provider } = await gateway(t);
  const noAuth = await post(url, '/v1/messages', payload, { 'content-type': 'application/json' });
  assert.equal(noAuth.status, 401);
  assert.equal((await noAuth.json()).error.type, 'authentication_error');
  const wrong = await post(url, '/v1/messages', payload, { ...auth, authorization: 'Bearer wrong' });
  assert.equal(wrong.status, 401);
  assert.equal(provider.calls.length, 0);
});
test('full HTTP request generates Anthropic-compatible message with selected Gemini', async t => {
  const { url, provider } = await gateway(t);
  const res = await post(url, '/v1/messages', payload);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.type, 'message');
  assert.equal(body.model, MOD);
  assert.equal(body.stop_reason, 'end_turn');
  assert.equal(body.content[0].text, 'hello from Gemini');
  assert.equal(provider.calls[0].model, MOD);
});
test('stream mode emits Anthropic SSE events', async t => {
  const { url } = await gateway(t);
  const res = await post(url, '/v1/messages', { ...payload, stream: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const stream = await res.text();
  assert.match(stream, /event: message_start/);
  assert.match(stream, /event: content_block_delta/);
  assert.match(stream, /event: message_stop/);
});
test('model listing uses live agy names, not a hardcoded catalog', async t => {
  const { url } = await gateway(t);
  const res = await fetch(url + '/v1/models', { headers: auth });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).data[0].id, MOD);
});
test('token counter labels estimate and validates prompt', async t => {
  const { url } = await gateway(t);
  const result = await post(url, '/v1/messages/count_tokens', payload);
  assert.ok((await result.json()).input_tokens > 1);
  const bad = await post(url, '/v1/messages/count_tokens', { messages: [] });
  assert.equal(bad.status, 400);
});
test('image requests give clear unsupported error, not corrupted text', async t => {
  const { url, provider } = await gateway(t);
  const res = await post(url, '/v1/messages', { ...payload, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', data: 'x' } }] }] });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error.message, /Unsupported content block/);
  assert.equal(provider.calls.length, 0);
});
test('invalid JSON and unknown endpoints do not crash the gateway', async t => {
  const { url } = await gateway(t);
  const invalid = await fetch(url + '/v1/messages', { method: 'POST', headers: auth, body: '{oops' });
  assert.equal(invalid.status, 400);
  const missing = await fetch(url + '/v1/missing', { headers: auth });
  assert.equal(missing.status, 404);
});
test('allows only one concurrent run and returns 429 for second', async t => {
  let unblock;
  const promise = new Promise(resolve => { unblock = resolve; });
  let entry;
  const entered = new Promise(resolve => { entry = resolve; });
  const provider = { models: async () => [], generate: async () => { entry(); await promise; return { value: { kind: 'final', text: 'ok', tool_calls: [] }, usage: {} }; } };
  const { url } = await gateway(t, provider);
  const first = post(url, '/v1/messages', payload);
  await entered;
  const second = await post(url, '/v1/messages', payload);
  assert.equal(second.status, 429);
  unblock();
  assert.equal((await first).status, 200);
});
test('invalid upstream tool call cannot silently become a completed task', async t => {
  const provider = {
    models: async () => [],
    generate: async () => ({ value: { kind: 'tool_calls', text: '', tool_calls: [{ name: 'Bash', input_json: '{}' }] }, usage: {} })
  };
  const { url } = await gateway(t, provider);
  const res = await post(url, '/v1/messages', payload);
  assert.equal(res.status, 502);
});

test('request body limit returns an HTTP error without crashing', async t => {
  const { url } = await gateway(t);
  const oversized = 'a'.repeat(2 * 1024 * 1024 + 1024);
  const res = await fetch(url + '/v1/messages', {
    method: 'POST', headers: auth,
    body: JSON.stringify({ ...payload, messages: [{ role: 'user', content: oversized }] })
  });
  assert.equal(res.status, 413);
  assert.match((await res.json()).error.message, /too large/i);
});

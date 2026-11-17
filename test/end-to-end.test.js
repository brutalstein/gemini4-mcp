import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createGateway } from '../src/server.js';
import { AntigravityProvider } from '../src/agy.js';
const fixture = fileURLToPath(new URL('../fixtures/fake-agy.cjs', import.meta.url));
const model = 'gemini-4-carbon-high';

test('actual subprocess + official stdin protocol + real HTTP + tool round trip', async t => {
  const provider = new AntigravityProvider({ binary: process.execPath, argsPrefix: [fixture], timeoutMs: 10000 });
  const catalog = await provider.models();
  assert.equal(catalog[0].id, model);
  const gateway = createGateway({ provider, model, token: 'end-to-end-test' });
  const { baseURL } = await gateway.listen();
  t.after(() => new Promise(resolve => gateway.server.close(resolve)));
  const send = async body => {
    const res = await fetch(baseURL + '/v1/messages', {
      method: 'POST', headers: { authorization: 'Bearer end-to-end-test', 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 200, ...body })
    });
    assert.equal(res.status, 200, await res.clone().text());
    return res.json();
  };
  const response = await send({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(response.content[0].text, 'fixture response');
  const toolResponse = await send({
    messages: [{ role: 'user', content: 'read README.md' }],
    tools: [{ name: 'Read', description: 'Read file', input_schema: { type: 'object', properties: { file_path: { type: 'string' } } } }]
  });
  assert.equal(toolResponse.stop_reason, 'tool_use');
  assert.equal(toolResponse.content[0].name, 'Read');
  assert.deepEqual(toolResponse.content[0].input, { file_path: 'README.md' });
  const afterTool = await send({
    messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: toolResponse.content[0].id, name: 'Read', input: toolResponse.content[0].input }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolResponse.content[0].id, content: 'read result' }] }
    ]
  });
  assert.equal(afterTool.stop_reason, 'end_turn');
});

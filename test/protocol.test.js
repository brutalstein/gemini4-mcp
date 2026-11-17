import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessage, sseEvents, selectModel, validateBody, anthropicError } from '../src/protocol.js';
const model = 'gemini-4-argon-high';
test('selects explicit Gemini and maps built-in Claude aliases to default', () => {
  assert.equal(selectModel('gemini-4-carbon-low', model), 'gemini-4-carbon-low');
  assert.equal(selectModel('claude-sonnet-4-6', model), model);
  assert.equal(selectModel(null, model), model);
  assert.equal(selectModel('opus', model), model);
  assert.equal(selectModel('haiku', model), model);
  assert.throws(() => selectModel(null, null));
  assert.throws(() => selectModel('bad;arg', model), /Invalid model/);
});
test('maps normal response to Anthropic message with usage', () => {
  const msg = createMessage({ value: { kind: 'final', text: 'done', tool_calls: [] }, usage: { input_tokens: 10, output_tokens: 3 } }, model);
  assert.equal(msg.stop_reason, 'end_turn');
  assert.deepEqual(msg.content, [{ type: 'text', text: 'done' }]);
  assert.equal(msg.usage.input_tokens, 10);
  assert.match(msg.id, /^msg_/);
});
test('maps client tool calls and validates tool names', () => {
  const payload = { value: { kind: 'tool_calls', text: '', tool_calls: [{ name: 'Read', input_json: '{"path":"README.md"}' }] }, usage: {} };
  const msg = createMessage(payload, model, [{ name: 'Read' }]);
  assert.equal(msg.stop_reason, 'tool_use');
  assert.deepEqual(msg.content[0].input, { path: 'README.md' });
  assert.match(msg.content[0].id, /^toolu_/);
  assert.throws(() => createMessage(payload, model, []), /undeclared tool/);
  assert.throws(() => createMessage(payload, model, [{ name: 'Read' }], { type: 'tool', name: 'Bash' }), /wrong required tool/);
});
test('rejects malformed upstream tool payloads', () => {
  const value = { kind: 'tool_calls', text: '', tool_calls: [{ name: 'Read', input_json: 'not json' }] };
  assert.throws(() => createMessage({ value }, model, [{ name: 'Read' }]), /not JSON/);
  value.tool_calls[0].input_json = '[]';
  assert.throws(() => createMessage({ value }, model, [{ name: 'Read' }]), /must be an object/);
  assert.throws(() => createMessage({ value: { kind: 'final', text: '', tool_calls: [{ name: 'Read' }] } }, model), /contained tool calls/);
  assert.throws(() => createMessage({ value: { kind: 'tool_calls', text: '', tool_calls: [] } }, model), /none/);
});
test('SSE event sequence supports text and tool input deltas', () => {
  const msg = createMessage({ value: { kind: 'tool_calls', text: 'plan', tool_calls: [{ name: 'Read', input_json: '{"x":1}' }] }, usage: { output_tokens: 10 } }, model, [{ name: 'Read' }]);
  const events = Array.from(sseEvents(msg));
  assert.equal(events[0].event, 'message_start');
  assert.equal(events.at(-1).event, 'message_stop');
  assert.equal(events.find(x => x.data?.delta?.type === 'input_json_delta').data.delta.partial_json, '{"x":1}');
  assert.equal(events.find(x => x.event === 'message_delta').data.delta.stop_reason, 'tool_use');
});
test('request validation and error type shapes', () => {
  assert.throws(() => validateBody({ messages: [] }), /non-empty/);
  assert.throws(() => validateBody({ messages: [{}], tools: 12 }), /tools/);
  assert.throws(() => validateBody({ messages: [{}], max_tokens: -1 }), /max_tokens/);
  assert.equal(anthropicError({ status: 429, message: 'busy' }).body.error.type, 'rate_limit_error');
  assert.equal(anthropicError({ status: 401, message: 'missing' }).body.error.type, 'authentication_error');
});

test('required tool choice is never silently downgraded to text', () => {
  const value = { kind: 'final', text: 'done', tool_calls: [] };
  assert.throws(() => createMessage({ value }, model, [{ name: 'Read' }], { type: 'any' }), /not honored/);
});

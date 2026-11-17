import { randomBytes } from 'node:crypto';
import { validModel } from './config.js';
import { ProcessError } from './process.js';

const id = (prefix) => prefix + randomBytes(12).toString('hex');
const asInt = (v) => Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;

export function selectModel(bodyModel, configuredModel) {
  if (bodyModel != null && !validModel(bodyModel)) throw new ProcessError('Invalid model slug', 400);
  if (bodyModel && !/^(claude[-.]|opus$|sonnet$|haiku$|default$)/i.test(bodyModel)) return bodyModel;
  if (!validModel(configuredModel)) throw new ProcessError('No selected Gemini model', 400);
  return configuredModel;
}

export function validateBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ProcessError('Expected JSON object', 400);
  if (!Array.isArray(body.messages) || !body.messages.length) throw new ProcessError('messages must be a non-empty array', 400);
  if (body.max_tokens != null && (!Number.isInteger(body.max_tokens) || body.max_tokens < 1)) throw new ProcessError('Invalid max_tokens', 400);
  if (body.tools != null && !Array.isArray(body.tools)) throw new ProcessError('tools must be an array', 400);
  if (body.tool_choice?.type && !['auto', 'any', 'tool', 'none'].includes(body.tool_choice.type)) throw new ProcessError('Unsupported tool_choice', 422);
}

export function createMessage({ value, usage }, model, tools = [], toolChoice = { type: 'auto' }) {
  if (!value || typeof value !== 'object' || typeof value.text !== 'string' || !Array.isArray(value.tool_calls)) {
    throw new ProcessError('Upstream structured response is invalid', 502);
  }
  if (!['final', 'tool_calls'].includes(value.kind)) throw new ProcessError('Upstream response has invalid kind', 502);
  const content = [];
  if (value.text) content.push({ type: 'text', text: value.text });
  const enabled = new Set(toolChoice?.type === 'none' ? [] : tools.map(x => x.name));
  if (value.kind === 'tool_calls') {
    if (!value.tool_calls.length) throw new ProcessError('Upstream claimed tool calls but returned none', 502);
    for (const call of value.tool_calls) {
      if (!enabled.has(call?.name)) throw new ProcessError('Upstream requested undeclared tool', 502);
      if (toolChoice?.type === 'tool' && call.name !== toolChoice.name) throw new ProcessError('Upstream used the wrong required tool', 502);
      let input;
      try { input = JSON.parse(call.input_json); } catch { throw new ProcessError('Upstream tool input is not JSON', 502); }
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProcessError('Upstream tool input must be an object', 502);
      content.push({ type: 'tool_use', id: id('toolu_'), name: call.name, input });
    }
  } else if (value.tool_calls.length) throw new ProcessError('Upstream final response contained tool calls', 502);
  if ((toolChoice?.type === 'any' || toolChoice?.type === 'tool') && !content.some(x => x.type === 'tool_use')) {
    throw new ProcessError('Required tool choice was not honored by upstream', 502);
  }
  if (!content.length) content.push({ type: 'text', text: '' });
  return {
    id: id('msg_'), type: 'message', role: 'assistant', content, model,
    stop_reason: content.some(x => x.type === 'tool_use') ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      // Antigravity CLI usage describes agent overhead, not exact Claude Code token billing.
      input_tokens: asInt(usage?.input_tokens),
      output_tokens: asInt(usage?.output_tokens)
    }
  };
}

export function* sseEvents(message) {
  yield { event: 'message_start', data: { type: 'message_start', message: { ...message, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: message.usage.input_tokens, output_tokens: 0 } } } };
  for (let index = 0; index < message.content.length; index++) {
    const block = message.content[index];
    if (block.type === 'text') {
      yield { event: 'content_block_start', data: { type: 'content_block_start', index, content_block: { type: 'text', text: '' } } };
      for (let i = 0; i < block.text.length; i += 1024) {
        yield { event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: { type: 'text_delta', text: block.text.slice(i, i + 1024) } } };
      }
    } else {
      yield { event: 'content_block_start', data: { type: 'content_block_start', index, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } } };
      yield { event: 'content_block_delta', data: { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } } };
    }
    yield { event: 'content_block_stop', data: { type: 'content_block_stop', index } };
  }
  yield { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: message.stop_reason, stop_sequence: null }, usage: { output_tokens: message.usage.output_tokens } } };
  yield { event: 'message_stop', data: { type: 'message_stop' } };
}

export function anthropicError(e) {
  const status = [400, 401, 404, 413, 422, 429, 499, 502, 503, 504].includes(e?.status) ? e.status : 500;
  let type = 'api_error';
  if (status === 400 || status === 413 || status === 422) type = 'invalid_request_error';
  else if (status === 401) type = 'authentication_error';
  else if (status === 429) type = 'rate_limit_error';
  else if (status === 503 || status === 504) type = 'overloaded_error';
  return { status, body: { type: 'error', error: { type, message: String(e?.message || 'Unknown error').slice(0, 350) } } };
}

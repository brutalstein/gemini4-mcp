import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AntigravityProvider, parseModels, RESPONSE_SCHEMA } from '../src/agy.js';

test('parses model slugs without hard-coding versions', () => {
  const text = 'Models\ngemini-4-carbon-high             Gemini 4 Carbon (High)\ngemini-3.8-flash-medium          Gemini 3.8 Flash (Medium)\ngemini-4-carbon-high             duplicate\n';
  assert.deepEqual(parseModels(text), [
    { id: 'gemini-4-carbon-high', name: 'Gemini 4 Carbon (High)' },
    { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)' }
  ]);
});
test('provider discovers dynamic models via agy models', async () => {
  const provider = new AntigravityProvider({ runner: async (bin, args) => {
    assert.deepEqual(args, ['models']);
    return { stdout: 'gemini-4-argon-high   Gemini 4 Argon (High)\n' };
  } });
  assert.equal((await provider.models())[0].id, 'gemini-4-argon-high');
});
test('provider uses official schema-constrained headless JSON and cleans temp files', async () => {
  let schemaPath;
  const provider = new AntigravityProvider({ runner: async (bin, args, opts) => {
    assert.equal(bin, 'agy');
    assert.deepEqual(args.slice(0, 2), ['--input-format', 'stream-json']);
    assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
    assert.deepEqual(JSON.parse(opts.input.trim()), { event: 'user', message: { content: 'hello' } });
    assert.ok(args.includes('--output-format'));
    assert.ok(args.includes('--model'));
    schemaPath = args[args.indexOf('--json-schema') + 1];
    assert.deepEqual(JSON.parse(fs.readFileSync(schemaPath, 'utf8')), RESPONSE_SCHEMA);
    assert.equal(fs.statSync(schemaPath).mode & 0o777, process.platform === 'win32' ? fs.statSync(schemaPath).mode & 0o777 : 0o600);
    assert.ok(opts.signal);
    return { stdout: JSON.stringify({ event: 'init', init: { model: 'gemini-4-argon-high' } }) + '\n' + JSON.stringify({ event: 'result', result: { status: 'SUCCESS', structured_output: { kind: 'final', text: 'ok', tool_calls: [] }, usage: { output_tokens: 5 } } }) + '\n' };
  } });
  const result = await provider.generate({ prompt: 'hello', model: 'gemini-4-argon-high', signal: new AbortController().signal });
  assert.equal(result.value.text, 'ok');
  assert.equal(fs.existsSync(schemaPath), false);
});
test('provider reports invalid JSON and failure status', async () => {
  let provider = new AntigravityProvider({ runner: async () => ({ stdout: 'bad' }) });
  await assert.rejects(provider.generate({ prompt: 'x', model: 'gemini-4-argon-high' }), /invalid streaming JSON/);
  provider = new AntigravityProvider({ runner: async () => ({ stdout: JSON.stringify({ event: 'result', result: { status: 'ERROR', error: 'no quota' } }) }) });
  await assert.rejects(provider.generate({ prompt: 'x', model: 'gemini-4-argon-high' }), /no quota/);
});
test('provider never accepts arbitrary model strings as CLI arguments', async () => {
  const provider = new AntigravityProvider({ runner: async () => { throw Error('Should not run'); } });
  await assert.rejects(provider.generate({ prompt: 'x', model: 'foo;rm' }), /Invalid model/);
});

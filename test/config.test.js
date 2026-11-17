import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configPath, validModel, loadConfig, setModel, resolveModel } from '../src/config.js';

test('model slugs reject shell injection, traversal and blanks', () => {
  assert.equal(validModel('gemini-4-carbon-high'), true);
  for (const slug of ['', 'x;rm -rf /', '../etc', '--flag', 'some model', '$(touch x)', '\n']) {
    assert.equal(validModel(slug), false, slug);
  }
});
test('model config saves atomically and resolves from explicit/env/file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-cfg-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'deep', 'config.json');
  assert.equal(loadConfig(file).model, null);
  setModel('gemini-4-argon-high', file);
  assert.equal(loadConfig(file).model, 'gemini-4-argon-high');
  assert.equal(resolveModel(null, { G4_CONFIG_PATH: file }), 'gemini-4-argon-high');
  assert.equal(resolveModel(null, { G4_MODEL: 'gemini-4-carbon-low', G4_CONFIG_PATH: file }), 'gemini-4-carbon-low');
  assert.equal(resolveModel('gemini-4-hydrogen-high', { G4_CONFIG_PATH: file }), 'gemini-4-hydrogen-high');
  assert.equal(fs.readdirSync(path.dirname(file)).length, 1);
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
});
test('missing config model throws actionable error', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-missing-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => resolveModel(null, { G4_CONFIG_PATH: path.join(dir, 'x.json') }), /No model selected/);
});
test('config rejects corrupt and invalid data', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-bad-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, 'not json');
  assert.throws(() => loadConfig(file));
  fs.writeFileSync(file, JSON.stringify({ model: 'evil;code' }));
  assert.throws(() => loadConfig(file), /Invalid configured model/);
  assert.throws(() => setModel('bad\nname', file), /Invalid model name/);
});
test('config path allows user override', () => assert.equal(configPath({ G4_CONFIG_PATH: 'foo' }), 'foo'));

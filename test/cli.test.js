import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/process.js';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
test('CLI shows cross-platform commands and disclaimer', async () => {
  const { stdout } = await runProcess(process.execPath, [cli, '--help'], { timeoutMs: 5000 });
  assert.match(stdout, /g4 model set/);
  assert.match(stdout, /g4 claude/);
  assert.match(stdout, /experimental/);
});
test('subprocess runner rejects nonexistent executable with actionable error', async () => {
  await assert.rejects(runProcess('this-g4-command-does-not-exist-93484', ['hi'], { timeoutMs: 2000 }), /Could not launch/);
});
test('subprocess runner times out safely', async () => {
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 50 }), /timed out/);
});

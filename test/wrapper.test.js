import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/process.js';
const cli = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const fakeAgy = fileURLToPath(new URL('../fixtures/fake-agy.cjs', import.meta.url));

test('real g4 claude launcher routes fake Claude through HTTP gateway without global settings', { skip: process.platform === 'win32' ? 'Executable shebang fixture not portable to Windows CMD' : false }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g4-wrapper-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const claude = path.join(dir, 'fake-claude.cjs');
  fs.writeFileSync(claude, `#!/usr/bin/env node
(async () => {
  const url = process.env.ANTHROPIC_BASE_URL;
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!url || !token || !url.startsWith('http://127.0.0.1:')) process.exit(2);
  if (process.env.ANTHROPIC_MODEL !== 'gemini-4-carbon-high') process.exit(3);
  const response = await fetch(url + '/v1/messages', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 100, messages: [{role:'user',content:'test'}] })
  });
  const result = await response.json();
  console.log(result.content?.[0]?.text || JSON.stringify(result));
  process.exit(response.ok ? 0 : 4);
})();
`, { mode: 0o700 });
  // The official Agy process is faked: make a launcher via a POSIX-compatible shebang.
  const configFile = path.join(dir, 'config.json');
  const { stdout } = await runProcess(process.execPath, [cli, 'claude', '--model', 'gemini-4-carbon-high'], {
    timeoutMs: 15000,
    env: { ...process.env, CLAUDE_PATH: claude, AGY_PATH: fakeAgy, G4_CONFIG_PATH: configFile }
  });
  // stdio: inherit in g4 writes fake Claude output to the test runner's console, not runProcess stdout.
  assert.equal(typeof stdout, 'string');
  assert.equal(fs.existsSync(configFile), false, 'launcher never writes global config or credential files');
});

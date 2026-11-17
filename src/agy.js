import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runProcess, ProcessError } from './process.js';
import { validModel } from './config.js';

export const RESPONSE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['final', 'tool_calls'] },
    text: { type: 'string' },
    tool_calls: {
      type: 'array', items: {
        type: 'object', properties: {
          name: { type: 'string' },
          input_json: { type: 'string' }
        }, required: ['name', 'input_json'], additionalProperties: false
      }
    }
  }, required: ['kind', 'text', 'tool_calls'], additionalProperties: false
});

export function parseModels(output) {
  const seen = new Set();
  const result = [];
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^([a-z][a-z0-9._-]+)\s{2,}(.+?)\s*$/i);
    if (match && validModel(match[1]) && !seen.has(match[1])) {
      seen.add(match[1]);
      result.push({ id: match[1], name: match[2] });
    }
  }
  return result;
}

export class AntigravityProvider {
  constructor({ binary = process.env.AGY_PATH || 'agy', runner = runProcess,
    timeoutMs = 180000, cwd = process.env.G4_AGY_CWD || undefined, argsPrefix = [] } = {}) {
    this.binary = binary; this.runner = runner; this.timeoutMs = timeoutMs; this.cwd = cwd; this.argsPrefix = argsPrefix;
  }
  async models() {
    const { stdout } = await this.runner(this.binary, [...this.argsPrefix, 'models'], { timeoutMs: 12000, maxBytes: 256 * 1024 });
    const models = parseModels(stdout);
    if (!models.length) throw new ProcessError('Cannot parse `agy models` output. Check your Antigravity CLI version.', 503);
    return models;
  }
  async generate({ prompt, model, signal }) {
    if (!validModel(model)) throw new ProcessError('Invalid model slug', 400);
    let dir;
    try {
      dir = await fs.mkdtemp(path.join(os.tmpdir(), 'g4-'));
      const schemaFile = path.join(dir, 'schema.json');
      await fs.writeFile(schemaFile, JSON.stringify(RESPONSE_SCHEMA), { mode: 0o600 });
      // The officially documented streaming stdin protocol avoids OS argv-size limits.
      // One request == one Antigravity process: no cross-user/session context leakage.
      const args = ['--input-format', 'stream-json', '--output-format', 'stream-json',
        '--model', model, '--json-schema', schemaFile,
        '--print-timeout', `${Math.max(1, Math.ceil(this.timeoutMs / 1000))}s`];
      const stdin = JSON.stringify({ event: 'user', message: { content: prompt } }) + '\n';
      const { stdout } = await this.runner(this.binary, [...this.argsPrefix, ...args], {
        cwd: this.cwd || dir, input: stdin, timeoutMs: this.timeoutMs + 3000,
        maxBytes: 2 * 1024 * 1024, signal
      });
      let output;
      try {
        const rows = stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
        const last = rows.filter(row => row.event === 'result').at(-1);
        if (!last || !last.result) throw Error('Missing terminal result event');
        output = last.result;
      } catch { throw new ProcessError('Antigravity CLI produced invalid streaming JSON'); }
      if (output.status !== 'SUCCESS') throw new ProcessError(`Antigravity CLI failed: ${String(output.error || output.status || 'unknown').slice(0, 240)}`);
      let value = output.structured_output;
      if (!value || typeof value !== 'object') {
        try { value = JSON.parse(output.response); } catch { throw new ProcessError('Antigravity did not return structured output'); }
      }
      return { value, usage: output.usage || {} };
    } finally {
      if (dir) await fs.rm(dir, { recursive: true, force: true });
    }
  }
}

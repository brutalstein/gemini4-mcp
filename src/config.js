import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';

const SLUG = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
export function validModel(model) {
  return typeof model === 'string' && SLUG.test(model) && !model.includes('..');
}
export function configPath(env = process.env, home = os.homedir()) {
  return env.G4_CONFIG_PATH || path.join(home, '.gemini4-mcp', 'config.json');
}
export function loadConfig(file = configPath()) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid config');
    if (raw.model != null && !validModel(raw.model)) throw Error('Invalid configured model');
    return { model: raw.model || null };
  } catch (e) {
    if (e.code === 'ENOENT') return { model: null };
    throw e;
  }
}
export function setModel(model, file = configPath()) {
  if (!validModel(model)) throw Error('Invalid model name');
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.config-${randomBytes(8).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify({ model }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(tmp, file);
    if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  } finally {
    try { fs.unlinkSync(tmp); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
export function resolveModel(explicit, env = process.env, file = configPath(env)) {
  const model = explicit || env.G4_MODEL || loadConfig(file).model;
  if (!model) throw Error('No model selected. Run `g4 models` then `g4 model set <slug>`.');
  if (!validModel(model)) throw Error('Invalid selected model');
  return model;
}

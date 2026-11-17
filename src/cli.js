#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';
import { AntigravityProvider } from './agy.js';
import { createGateway } from './server.js';
import { configPath, loadConfig, resolveModel, setModel, validModel } from './config.js';
import { runProcess } from './process.js';

const HELP = `gemini4-mcp (g4) — experimental local Claude Code ↔ Antigravity CLI bridge

Usage:
  g4 models                    Discover available models via official 'agy models'
  g4 model show                Display current default model
  g4 model set <slug>          Verify model and save selected slug
  g4 doctor                    Check installation and list models (no billable inference)
  g4 claude [--model <slug>] [-- <claude args...>]
                               Run Claude Code against temporary loopback gateway
  g4 serve [--model <slug>] [--port <port>]
                               Start manual local gateway; prints ephemeral session token
  g4 help                      Show this help

Prerequisites: Node.js 20+, official Antigravity CLI ('agy') signed in with Google,
              and Claude Code ('claude'). No Gemini API key or credential extraction.

This is a compatibility experiment, NOT an official model replacement and NOT
fully validated without live Antigravity authentication. See README.md.
`;
function options(argv, { allowPassThrough = false } = {}) {
  let model = null, port = 0, passthrough = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--' && allowPassThrough) { passthrough = argv.slice(i + 1); break; }
    if (arg === '--model') model = argv[++i];
    else if (arg === '--port') {
      const value = argv[++i];
      if (!/^\d+$/.test(value || '')) throw Error('Port must be an integer 0-65535');
      port = Number(value);
      if (port > 65535) throw Error('Port must be 0-65535');
    } else throw Error(`Unknown option: ${arg}`);
  }
  if (model != null && !validModel(model)) throw Error('Invalid model slug');
  return { model, port, passthrough };
}
async function modelsCommand(provider) {
  const models = await provider.models();
  for (const m of models) process.stdout.write(`${m.id.padEnd(32)} ${m.name}\n`);
  return models;
}
async function doctor(provider) {
  console.log(`Node.js: ${process.version}`);
  console.log(`Config: ${configPath()}`);
  console.log(`Default model: ${loadConfig().model || '(not selected)'}`);
  try {
    const models = await provider.models();
    console.log(`Antigravity CLI: found ${models.length} models (this does not verify active login)`);
  } catch (e) { console.error(`Antigravity CLI: unavailable (${e.message})`); process.exitCode = 1; }
  try {
    const result = await runProcess(process.env.CLAUDE_PATH || 'claude', ['--version'], { timeoutMs: 5000 });
    console.log(`Claude Code: ${result.stdout.trim()}`);
  } catch (e) { console.error(`Claude Code: unavailable (${e.message})`); process.exitCode = 1; }
  console.log('Live Gemini inference not tested. Run an interactive `agy` login, then `g4 claude`.');
}
async function launchClaude(gateway, model, args) {
  const { baseURL, token } = await gateway.listen();
  const environment = {
    ...process.env,
    ANTHROPIC_BASE_URL: baseURL,
    ANTHROPIC_AUTH_TOKEN: token,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_MODEL: model,
    ANTHROPIC_CUSTOM_MODEL_OPTION: model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: model,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
    DISABLE_TELEMETRY: '1'
  };
  const executable = process.env.CLAUDE_PATH || 'claude';
  // Windows npm command shims require a command processor. Refuse shell meta in user args.
  if (process.platform === 'win32' && args.some(arg => /[&|<>^\r\n%!"()]/.test(arg))) {
    throw Error('Unsupported shell metacharacter in Windows Claude Code argument');
  }
  const cmdArgs = ['--model', model, ...args];
  const child = spawn(executable, cmdArgs, {
    env: environment, stdio: 'inherit', windowsHide: false,
    shell: process.platform === 'win32'
  });
  await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) process.exitCode = 1;
      else process.exitCode = code ?? 1;
      resolve();
    });
  });
  await new Promise(resolve => gateway.server.close(resolve));
}

async function main(argv) {
  const [command = 'help', ...rest] = argv;
  const provider = new AntigravityProvider();
  if (command === 'help' || command === '--help' || command === '-h') { console.log(HELP); return; }
  if (command === 'models') { if (rest.length) throw Error('Usage: g4 models'); await modelsCommand(provider); return; }
  if (command === 'doctor') { if (rest.length) throw Error('Usage: g4 doctor'); await doctor(provider); return; }
  if (command === 'model') {
    if (rest.length === 1 && rest[0] === 'show') { console.log(loadConfig().model || '(not selected)'); return; }
    if (rest.length === 2 && rest[0] === 'set') {
      const slug = rest[1];
      const available = await provider.models();
      if (!available.some(m => m.id === slug)) throw Error(`Unknown model: ${slug}. Run g4 models.`);
      setModel(slug); console.log(`Default model: ${slug}`); return;
    }
    throw Error('Usage: g4 model show | g4 model set <slug>');
  }
  if (command === 'claude') {
    const { model: explicit, passthrough } = options(rest, { allowPassThrough: true });
    const model = resolveModel(explicit);
    const gateway = createGateway({ provider, model });
    try { await launchClaude(gateway, model, passthrough); }
    finally { if (gateway.server.listening) gateway.server.close(); }
    return;
  }
  if (command === 'serve') {
    const { model: explicit, port } = options(rest);
    const model = resolveModel(explicit);
    const gateway = createGateway({ provider, model });
    const address = await gateway.listen(port);
    console.log(`Serving ${model} on ${address.baseURL}`);
    console.log(`ANTHROPIC_BASE_URL=${address.baseURL}`);
    console.log(`ANTHROPIC_AUTH_TOKEN=${address.token}`);
    console.log('Keep the token secret. Ctrl+C to stop. No cloud API key is used.');
    return;
  }
  throw Error(`Unknown command: ${command}`);
}

main(process.argv.slice(2)).catch(error => {
  console.error(`g4: ${error.message}`);
  process.exitCode = 1;
});

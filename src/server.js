import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { buildPrompt } from './prompt.js';
import { selectModel, validateBody, createMessage, sseEvents, anthropicError } from './protocol.js';
import { AntigravityProvider } from './agy.js';
import { ProcessError } from './process.js';

function authorized(req, token) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  const provided = bearer || req.headers['x-api-key'] || '';
  const a = Buffer.from(String(provided));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
function sendJson(res, code, value) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(value));
}
function readJson(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let text = '', bytes = 0, overLimit = false;
    req.setEncoding('utf8');
    req.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > limit) {
        if (!overLimit) reject(new ProcessError('Request body too large', 413));
        overLimit = true;
        return;
      }
      text += chunk;
    });
    req.on('end', () => {
      if (overLimit) return;
      try { resolve(JSON.parse(text)); } catch { reject(new ProcessError('Invalid JSON body', 400)); }
    });
    req.on('error', reject);
  });
}
function routePath(req) {
  try { return new URL(req.url, 'http://localhost').pathname; } catch { return ''; }
}

export function createGateway({ provider = new AntigravityProvider(), model, token = randomBytes(32).toString('hex'), maxConcurrent = 1 } = {}) {
  if (!model) throw Error('model required');
  let active = 0;
  const server = http.createServer(async (req, res) => {
    const route = routePath(req);
    if (route === '/healthz' && req.method === 'GET') return sendJson(res, 200, { ok: true, mode: 'experimental', active });
    if (!authorized(req, token)) return sendJson(res, 401, anthropicError(new ProcessError('Unauthorized', 401)).body);
    try {
      if (route === '/v1/models' && req.method === 'GET') {
        const models = await provider.models();
        return sendJson(res, 200, { data: models.map(m => ({ id: m.id, type: 'model', display_name: m.name })), has_more: false });
      }
      if (route === '/v1/messages/count_tokens' && req.method === 'POST') {
        const body = await readJson(req);
        validateBody(body);
        const prompt = buildPrompt(body);
        return sendJson(res, 200, { input_tokens: Math.max(1, Math.ceil(prompt.length / 4)) });
      }
      if (route === '/v1/messages' && req.method === 'POST') {
        const body = await readJson(req);
        validateBody(body);
        const prompt = buildPrompt(body);
        if (active >= maxConcurrent) throw new ProcessError('Local gateway is busy; retry shortly', 429);
        const selected = selectModel(body.model, model);
        active++;
        const controller = new AbortController();
        const onClose = () => { if (!res.writableEnded && res.destroyed) controller.abort(); };
        res.on('close', onClose);
        try {
          const upstream = await provider.generate({ prompt, model: selected, signal: controller.signal });
          if (res.destroyed) return;
          const message = createMessage(upstream, selected, body.tools || [], body.tool_choice);
          if (!body.stream) return sendJson(res, 200, message);
          res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-store', 'connection': 'keep-alive', 'x-accel-buffering': 'no' });
          for (const event of sseEvents(message)) {
            if (res.destroyed) break;
            res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
          }
          if (!res.destroyed) res.end();
        } finally { active--; res.off('close', onClose); }
        return;
      }
      sendJson(res, 404, anthropicError(new ProcessError('Unknown endpoint', 404)).body);
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      const { status, body } = anthropicError(error);
      sendJson(res, status, body);
    }
  });
  async function listen(port = 0, host = '127.0.0.1') {
    if (!['127.0.0.1', '::1'].includes(host)) throw Error('Only loopback binding is permitted');
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve({ baseURL: `http://${host === '::1' ? '[::1]' : host}:${server.address().port}`, token });
      });
    });
  }
  return { server, listen, token };
}

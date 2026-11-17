import { spawn } from 'node:child_process';

export class ProcessError extends Error {
  constructor(message, status = 502) { super(message); this.name = 'ProcessError'; this.status = status; }
}

export function runProcess(binary, args, options = {}) {
  const { cwd, input, timeoutMs = 180000, maxBytes = 2 * 1024 * 1024,
    signal, env = process.env } = options;
  return new Promise((resolve, reject) => {
    let stdout = '', stderr = '', settled = false, timer;
    const child = spawn(binary, args, {
      cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe']
    });
    function finish(error, result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(result);
    }
    function abort() { child.kill(); finish(new ProcessError('Request canceled', 499)); }
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    if (timeoutMs > 0) timer = setTimeout(() => {
      child.kill(); finish(new ProcessError('Antigravity CLI timed out', 504));
    }, timeoutMs);
    child.once('error', (e) => finish(new ProcessError(`Could not launch ${binary}: ${e.code || 'unknown error'}`, 503)));
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (Buffer.byteLength(stdout) > maxBytes) {
        child.kill(); finish(new ProcessError('Antigravity response exceeded size limit', 502));
      }
    });
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-8192);
    });
    child.once('close', (code, sig) => {
      // Don't leak upstream diagnostics containing local paths or user details to HTTP clients.
      if (code !== 0) return finish(new ProcessError(`Antigravity CLI exited with ${code ?? sig}. Check authentication, quota, model availability, and CLI diagnostics.`, 502));
      finish(null, { stdout, stderr, exitCode: code });
    });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

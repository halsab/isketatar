import { createSecureServer } from 'node:http2';
import { readFile, readdir, mkdtemp, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { createTrafficShaper } from './traffic-shaper.mjs';

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.png': 'image/png', '.txt': 'text/plain' };
export async function serveDist(root = 'dist', traffic) {
  const files = new Map();
  for (const item of await readdir(root, { recursive: true, withFileTypes: true })) if (item.isFile()) {
    const path = join(item.parentPath, item.name); const body = await readFile(path); const mime = types[extname(path)];
    if (!mime) throw new Error(`Unsupported artifact type: ${path}`);
    const relative = path.slice(join(root, '/').length);
    files.set(`/isketatar/${relative}`, { body, mime, compressed: /^(?:text\/|application\/(?:json|manifest\+json))/u.test(mime) ? gzipSync(body, { level: 9 }) : null });
  }
  const directory = await mkdtemp(join(tmpdir(), 'isketatar-lab-tls-'));
  const keyPath = join(directory, 'key.pem'); const certPath = join(directory, 'cert.pem');
  let key, cert;
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', keyPath, '-out', certPath], { stdio: 'ignore' });
    key = await readFile(keyPath); cert = await readFile(certPath);
  } finally { await rm(directory, { recursive: true, force: true }); }
  const spki = createHash('sha256').update(createPublicKey(cert).export({ type: 'spki', format: 'der' })).digest('base64');
  const sessions = new Set();
  const shaper = traffic ? createTrafficShaper(traffic) : null;
  const server = createSecureServer({ key, cert }, (request, response) => {
    const url = new URL(request.url, 'http://localhost');
    const file = files.get(url.pathname === '/isketatar/' ? '/isketatar/index.html' : url.pathname);
    if (!file || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404); response.end(); return; }
    const gzip = file.compressed && (request.headers['accept-encoding'] ?? '').split(',').some(value => /^\s*gzip\s*(?:;\s*q=(?:1(?:\.0*)?|0\.\d*[1-9]\d*))?\s*$/u.test(value));
    const body = gzip ? file.compressed : file.body;
    const headers = { 'Content-Type': file.mime, 'Content-Length': body.length, 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...(gzip ? { 'Content-Encoding': 'gzip' } : {}) };
    if (shaper && request.method === 'GET') shaper.send(response, headers, body, url.pathname);
    else { response.writeHead(200, headers); response.end(request.method === 'HEAD' ? undefined : body); }
  });
  server.on('session', session => { sessions.add(session); session.on('close', () => sessions.delete(session)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `https://127.0.0.1:${server.address().port}/isketatar/`, spki, networkRecords: shaper?.records,
    close: () => new Promise((resolve, reject) => { shaper?.close(); server.close(error => error ? reject(error) : resolve()); for (const session of sessions) session.destroy(); }) };
}

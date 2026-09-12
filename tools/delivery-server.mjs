import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mimeFor } from '../src/data/pwa/manifest.ts';

export async function deliveryServer(previousRoot, currentRoot, rollbackRoot) {
  let active = previousRoot;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      if (!url.pathname.startsWith('/isketatar/') || !['GET', 'HEAD'].includes(request.method)) throw new Error('not found');
      const path = url.pathname.slice('/isketatar/'.length) || 'index.html';
      if (!/^[A-Za-z0-9_./-]+$/u.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('not found');
      const bytes = await readFile(join(active, path));
      response.writeHead(200, { 'Content-Type': mimeFor(path)[0], 'Cache-Control': 'no-store' }).end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}/isketatar/`, publish: () => { active = currentRoot; }, rollback: () => { active = rollbackRoot; }, close: () => new Promise(resolve => server.close(resolve)) };
}

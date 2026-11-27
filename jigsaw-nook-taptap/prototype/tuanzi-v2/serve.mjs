// 零依赖静态服务：本地一键启动「团子去旅行 2.0」可玩交互原型
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT || 4178);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

export function createServer() {
  return http.createServer(async (req, res) => {
    const cleanPath = (req.url || '/').split('?')[0];
    const rel = cleanPath === '/' ? 'index.html' : cleanPath.replace(/^\/+/, '');
    const full = resolve(join(ROOT, normalize(rel)));
    if (!full.startsWith(ROOT)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    try {
      const data = await readFile(full);
      res.writeHead(200, { 'Content-Type': MIME[extname(full).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Tuanzi Travel 2.0 Prototype running at http://127.0.0.1:${PORT}/`);
  });
}

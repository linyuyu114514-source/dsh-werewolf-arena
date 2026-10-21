/* 后端入口：一个 HTTP 服务同时干两件事
   1. 把 web/ 当静态站点发出去（这样页面不再是 file://，才能 fetch 后端）
   2. 提供 /api/* 接口给前端调

   启动：node server/index.mjs   然后浏览器打开 http://127.0.0.1:8787 */
import './env.mjs';   /* 必须最先执行：加载 .env 里的 DEEPSEEK_API_KEY */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMatch, getMatch, dropMatch, dropAll } from './session/match.mjs';
import { dshUsable, dshDiagnosis, authRoute, DSH_HOME_DIR } from './dsh/paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WEB = path.join(ROOT, 'web');
const PORT = Number(process.env.WW_PORT || 8787);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
};

function send(res, code, body, type) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  res.writeHead(code, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

function json(res, code, obj) {
  send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 4 * 1024 * 1024) { reject(new Error('请求体过大')); req.destroy(); return; }
      parts.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(parts).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.resolve(WEB, '.' + rel);
  /* 目录穿越防护 */
  if (!full.startsWith(WEB)) return send(res, 403, 'forbidden');
  fs.stat(full, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'not found');
    const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store' });
    fs.createReadStream(full).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  try {
    if (url.startsWith('/api/')) {
      if (req.method === 'GET' && url === '/api/health') {
        const route = authRoute();
        return json(res, 200, {
          ok: true,
          dsh: dshUsable(),
          runtime: process.version,
          auth: route.route,
          provider: route.provider,
          install: DSH_HOME_DIR,
          diagnosis: dshDiagnosis(),
        });
      }

      if (req.method === 'POST' && url === '/api/match') {
        const body = await readBody(req);
        const seats = Array.isArray(body.seats) ? body.seats : [];
        if (!seats.length) return json(res, 400, { error: 'seats 不能为空' });
        if (!dshUsable()) return json(res, 503, { error: dshDiagnosis() || 'DeepSeek Harness 不可用' });

        const m = createMatch(seats);
        try {
          await m.start(seats);
        } catch (e) {
          await dropMatch(m.id);
          return json(res, 500, { error: '启动子代理失败：' + e.message });
        }
        return json(res, 200, { matchId: m.id });
      }

      const ask = /^\/api\/match\/([^/]+)\/ask$/.exec(url);
      if (req.method === 'POST' && ask) {
        const m = getMatch(ask[1]);
        if (!m) return json(res, 404, { error: '对局不存在' });
        const body = await readBody(req);
        if (!body.req) return json(res, 400, { error: '缺少 req' });
        let payload;
        try {
          payload = await m.ask(body.req);
        } catch (e) {
          /* 子代理没回应：这一局废了，顺手把它收掉，别留孤儿进程 */
          await dropMatch(m.id);
          return json(res, 504, { error: e.message });
        }
        return json(res, 200, { payload, warnings: m.warnings.slice(-5) });
      }

      const stop = /^\/api\/match\/([^/]+)\/stop$/.exec(url);
      if (req.method === 'POST' && stop) {
        const ok = await dropMatch(stop[1]);
        return json(res, 200, { ok });
      }

      return json(res, 404, { error: '未知接口' });
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'method not allowed');
    }
    return serveStatic(res, url);
  } catch (e) {
    return json(res, 500, { error: e.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const route = authRoute();
  console.log('狼人杀后端已启动：http://127.0.0.1:' + PORT);
  console.log('DeepSeek Harness：' + DSH_HOME_DIR);
  console.log('子代理身份：' + (route.route === 'none'
    ? '未就绪（' + dshDiagnosis() + '）'
    : route.route === 'api-key'
      ? 'API Key 通道'
      : 'DeepSeek Harness 已连接（复用桌面版登录态）'));
});

async function bye() {
  try { await dropAll(); } catch { /* ignore */ }
  process.exit(0);
}
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
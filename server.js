'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadEntries } = require('./lib/parse');
const { summarize } = require('./lib/aggregate');
const admin = require('./lib/admin');

const PORT = process.env.PORT || 4317;
// Localhost-only by default: the dashboard has no auth and serves usage data.
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_KEY = process.env.ANTHROPIC_ADMIN_KEY || '';
const PUBLIC = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

// Cache the Admin API response briefly — the docs recommend polling it at most
// once per minute, and data is only fresh to ~5 min anyway.
let adminCache = { at: 0, data: null };

function sendJSON(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === '/api/usage') {
    try {
      const entries = loadEntries();
      sendJSON(res, 200, summarize(entries));
    } catch (e) {
      sendJSON(res, 500, { error: e.message });
    }
    return;
  }

  if (url.pathname === '/api/admin') {
    if (!ADMIN_KEY) {
      sendJSON(res, 200, { configured: false });
      return;
    }
    const now = Date.now();
    if (adminCache.data && now - adminCache.at < 60_000) {
      sendJSON(res, 200, adminCache.data);
      return;
    }
    const data = await admin.fetchAll(ADMIN_KEY);
    adminCache = { at: now, data };
    sendJSON(res, 200, data);
    return;
  }

  if (url.pathname === '/api/config') {
    sendJSON(res, 200, { adminConfigured: !!ADMIN_KEY, port: PORT });
    return;
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Claude usage dashboard → http://localhost:${PORT}  (bound to ${HOST})\n`);
  console.log(`  Local subscription data: ~/.claude/projects  (always on)`);
  console.log(`  Admin API:               ${ADMIN_KEY ? 'configured' : 'not configured (set ANTHROPIC_ADMIN_KEY)'}\n`);
});

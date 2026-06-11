import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { loadEntries } from './lib/parse';
import { summarize } from './lib/aggregate';
import * as limits from './lib/limits';

const PORT = parseInt(process.env.PORT || '3000', 10);
// Localhost-only by default: the dashboard has no auth and serves usage data.
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, '..', 'public');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJSON(res: http.ServerResponse, code: number, obj: unknown): void {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
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
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  if (url.pathname === '/api/usage') {
    try {
      const entries = loadEntries();
      sendJSON(res, 200, summarize(entries));
    } catch (e) {
      sendJSON(res, 500, { error: (e as Error).message });
    }
    return;
  }

  if (url.pathname === '/api/limits') {
    // Live subscription limits, served from a background-poll cache (the Electron
    // app feeds the transport via limits.setFetcher).
    sendJSON(res, 200, limits.current());
    return;
  }

  if (url.pathname === '/api/config') {
    sendJSON(res, 200, { port: PORT });
    return;
  }

  serveStatic(res, url.pathname);
});

// Start the limits poller and HTTP server. The Electron main process injects the
// claude.ai transport (limits.setFetcher) and the org id, then calls this to boot
// the same server + UI the window loads.
export function startServer(): http.Server {
  // Background-poll the live subscription limits (5h session %, weekly %, extra
  // usage $). Reports { configured:false } until the embedded window is signed in.
  limits.startPoller(60_000);

  return server.listen(PORT, HOST, () => {
    console.log(`\n  Claude usage dashboard → http://localhost:${PORT}  (bound to ${HOST})\n`);
    console.log(`  Local transcript data:   ~/.claude/projects  (always on)`);
    console.log(`  Subscription limits:     embedded claude.ai window\n`);
  });
}

// Fallback when invoked directly (node dist/server.js): serve the transcript
// panel without live limits. The normal entry point is the Electron app.
if (require.main === module) {
  startServer();
}

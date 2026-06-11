import { app, BrowserWindow, session, shell } from 'electron';
import * as limits from '../lib/limits';
import { startServer } from '../server';

// Electron shell for the dashboard — the app's entry point.
//
// It mirrors how subscription-usage menubar apps work: an embedded real-Chromium
// window logs into claude.ai (the user clears Cloudflare by hand, once), and we
// read the undocumented usage endpoint *from inside that same session* — so the
// TLS/UA fingerprint and the cf_clearance cookie match, and there is no 403
// (which is what plain Node gets). The local HTTP server + public/ UI are reused
// as-is; only the limits transport is injected here via limits.setFetcher().
// See SUBSCRIPTION-USAGE-NOTES.md for the why.

const PORT = parseInt(process.env.PORT || '3000', 10);

// Present as stock Chrome rather than Electron — Cloudflare/Turnstile sniff the
// default "Electron" UA. A real-Chromium engine + a normal UA + a human solving
// the challenge once is what gets us clearance.
const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let claudeWin: BrowserWindow | null = null;
let dashboardWin: BrowserWindow | null = null;

// Run an in-page fetch inside the logged-in claude.ai window and return the raw
// status + body. credentials:'include' sends the session + Cloudflare cookies;
// because the request originates from this real browser context, it succeeds
// where a plain Node fetch gets a 403.
async function pageFetch(
  win: BrowserWindow,
  urlPath: string,
): Promise<{ status: number; text: string }> {
  const code = `(async () => {
    try {
      const r = await fetch(${JSON.stringify(urlPath)}, {
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      return { status: r.status, text: await r.text() };
    } catch (e) {
      return { status: 0, text: String(e) };
    }
  })()`;
  return win.webContents.executeJavaScript(code, true);
}

// The injected transport: GET an org-scoped claude.ai API endpoint from inside
// the embedded, logged-in window. `path` is the suffix after the org segment
// (e.g. 'usage', 'prepaid/credits').
const electronFetcher: limits.UsageFetcher = async (org, path) => {
  if (!claudeWin || claudeWin.isDestroyed()) {
    throw new Error('claude.ai window is not available');
  }
  return pageFetch(claudeWin, `/api/organizations/${org}/${path}`);
};

// Block until claude.ai is logged in (a 200 from /api/organizations carrying an
// org UUID). The window is visible so the user can sign in and pass Cloudflare.
async function waitForLogin(win: BrowserWindow): Promise<void> {
  const deadline = Date.now() + 10 * 60_000; // 10 min
  for (;;) {
    const r = await pageFetch(win, '/api/organizations');
    if (r.status === 200 && /[0-9a-f-]{36}/i.test(r.text)) return;
    if (Date.now() > deadline) {
      throw new Error('Timed out waiting for claude.ai login.');
    }
    await new Promise((res) => setTimeout(res, 2000));
  }
}

// Resolve the org whose limits we read. Prefer an explicit override, then the
// lastActiveOrg cookie (what the web client itself scopes calls to), then the
// first org returned by /api/organizations.
async function resolveOrg(win: BrowserWindow): Promise<string | undefined> {
  if (process.env.CLAUDE_ORG_ID) return process.env.CLAUDE_ORG_ID;

  const cookies = await session.defaultSession.cookies.get({ name: 'lastActiveOrg' });
  if (cookies[0]?.value && /[0-9a-f-]{36}/i.test(cookies[0].value)) {
    return cookies[0].value;
  }

  const r = await pageFetch(win, '/api/organizations');
  return (r.text.match(/[0-9a-f-]{36}/i) ?? [])[0];
}

function openDashboard(): void {
  dashboardWin = new BrowserWindow({
    width: 1200,
    height: 860,
    title: 'Claude Usage Dashboard',
    webPreferences: { contextIsolation: true },
  });
  void dashboardWin.loadURL(`http://127.0.0.1:${PORT}`);
  // External links open in the system browser, not inside the app.
  dashboardWin.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  // Closing the dashboard quits the app (the hidden claude.ai window would
  // otherwise keep it alive).
  dashboardWin.on('closed', () => app.quit());
}

async function boot(): Promise<void> {
  // Dev convenience: load a project-root .env if present (e.g. a CLAUDE_ORG_ID
  // override or a custom PORT). No-op for the packaged app.
  try {
    process.loadEnvFile();
  } catch {
    /* no .env — fine */
  }

  // Apply the stock-Chrome UA to every request in the default session.
  session.defaultSession.setUserAgent(CHROME_UA);

  // Inject the embedded-window transport and gate it until sign-in completes,
  // then boot the reused server + UI right away so the dashboard is visible
  // (showing a "waiting for sign-in" banner) while the user logs in.
  process.env.LIMITS_TRANSPORT = 'embedded claude.ai window (Electron)';
  limits.setFetcher(electronFetcher);
  limits.setLoginState('pending');
  startServer();
  openDashboard();

  // Sign-in happens in its own window; the dashboard reflects the progress.
  claudeWin = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'Sign in to Claude',
    webPreferences: { contextIsolation: true },
  });
  claudeWin.webContents.setUserAgent(CHROME_UA);
  await claudeWin.loadURL('https://claude.ai');

  await waitForLogin(claudeWin);

  const org = await resolveOrg(claudeWin);
  if (org) process.env.CLAUDE_ORG_ID = org;

  // Live now: flip the gate, hide the (still-alive) claude.ai window the poller
  // fetches through every 60s, and populate the card immediately.
  limits.setLoginState('ready');
  claudeWin.hide();
  await limits.refresh();
}

app.whenReady().then(boot).catch((e) => {
  console.error('Failed to start dashboard:', e);
  app.quit();
});

app.on('window-all-closed', () => app.quit());

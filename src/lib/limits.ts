// Live Claude *subscription* limits (5-hour session %, weekly %, extra usage $),
// read from claude.ai's undocumented usage endpoint:
//
//   GET https://claude.ai/api/organizations/{org}/usage
//
// claude.ai is Cloudflare-protected, so this can't be fetched from plain Node —
// the request's TLS/UA fingerprint is rejected with a 403. The Electron app
// supplies the transport instead: it runs the fetch *inside* its embedded,
// logged-in claude.ai BrowserWindow (same fingerprint, same Cloudflare
// clearance) via setFetcher(). Undocumented + unsupported — see
// SUBSCRIPTION-USAGE-NOTES.md.

export interface UsageBucket {
  pct: number;
  resetsAt: string | null;
}
export interface ExtraUsage {
  enabled: boolean;
  usedUsd: number;
  capUsd: number;
  currency: string;
}
export interface Limits {
  configured: boolean;
  fetchedAt?: number;
  session?: UsageBucket;
  weekly?: UsageBucket;
  extraUsage?: ExtraUsage;
  error?: string;
  hint?: string;
  // Set while the embedded claude.ai window is awaiting sign-in, so the UI can
  // show a "waiting for sign-in" banner instead of an error.
  auth?: 'pending';
}

// Transport seam: returns the raw HTTP status + body of the usage endpoint, run
// from inside the Cloudflare-cleared, logged-in claude.ai window. Injected by
// the Electron main process via setFetcher().
export type UsageFetcher = (org: string) => Promise<{ status: number; text: string }>;

let activeFetcher: UsageFetcher | null = null;
export function setFetcher(f: UsageFetcher): void {
  activeFetcher = f;
}

// Sign-in gate. While 'pending', refresh() reports auth:'pending' without
// attempting a fetch; 'ready' resumes normal polling.
let loginState: 'unknown' | 'pending' | 'ready' = 'unknown';
export function setLoginState(s: 'pending' | 'ready'): void {
  loginState = s;
}

let last: Limits = {
  configured: false,
  hint: 'Live limits load once you sign in to Claude.',
};

// The org whose usage we read. The Electron app discovers it from the
// lastActiveOrg cookie of your signed-in session and sets CLAUDE_ORG_ID before
// polling; you can also set it yourself to override (it's a plain UUID, not a
// secret).
function resolveOrg(): string | undefined {
  return process.env.CLAUDE_ORG_ID || undefined;
}

// Poll once, updating the module cache. Always resolves (never throws) so the
// poller can run on an interval safely.
export async function refresh(): Promise<Limits> {
  if (loginState === 'pending') {
    last = {
      configured: false,
      auth: 'pending',
      hint: 'Sign in to Claude in the popup window to load your live limits.',
    };
    return last;
  }
  if (!activeFetcher) {
    last = { configured: false, hint: 'Live subscription limits are provided by the desktop app.' };
    return last;
  }
  const org = resolveOrg();
  if (!org) {
    last = {
      configured: false,
      error: 'no organization id',
      hint: 'Could not determine your claude.ai organization. Set CLAUDE_ORG_ID (the org UUID) to override.',
    };
    return last;
  }
  try {
    const res = await activeFetcher(org);

    if (res.status !== 200) {
      last = {
        configured: false,
        error: `claude.ai returned HTTP ${res.status}`,
        hint:
          res.status === 401 || res.status === 403
            ? 'Your claude.ai session may have expired — reopen the sign-in window.'
            : 'Could not read live limits from claude.ai.',
      };
      return last;
    }

    const d = JSON.parse(res.text);
    const bucket = (b: any): UsageBucket | undefined =>
      b ? { pct: Number(b.utilization) || 0, resetsAt: b.resets_at ?? null } : undefined;
    const x = d.extra_usage;
    last = {
      configured: true,
      fetchedAt: Date.now(),
      session: bucket(d.five_hour),
      weekly: bucket(d.seven_day),
      extraUsage: x
        ? {
            enabled: !!x.is_enabled,
            // Observed units: used_credits is dollars (float), monthly_limit is
            // cents (int → /100). See SUBSCRIPTION-USAGE-NOTES.md.
            usedUsd: Number(x.used_credits) || 0,
            capUsd: (Number(x.monthly_limit) || 0) / 100,
            currency: x.currency || 'USD',
          }
        : undefined,
    };
    return last;
  } catch (e) {
    last = {
      configured: false,
      error: (e as Error).message,
      hint: 'Could not read live limits from claude.ai.',
    };
    return last;
  }
}

export function current(): Limits {
  return last;
}

export function startPoller(intervalMs = 60_000): void {
  void refresh();
  const t = setInterval(() => void refresh(), intervalMs);
  t.unref();
}

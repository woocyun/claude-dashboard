# Subscription Usage — How the live limits card works

The **Subscription limits** card shows the same numbers claude.ai shows for a
Pro/Max plan — **Current session %**, **Weekly %**, **Extra usage $/$cap**, and
their reset times. This note explains where those come from and why the app is
built the way it is.

> ⚠️ This uses an **undocumented, unsupported** claude.ai endpoint. It can change
> or break without notice, and automating claude.ai may be against its Terms of
> Service. The only *officially supported* usage API is the org **Admin API**,
> which is org-only and does **not** expose subscription session/weekly limits.

## The endpoint

```
GET https://claude.ai/api/organizations/{org}/usage
```

`{org}` is your organization UUID. The app auto-detects it from the
`lastActiveOrg` cookie of your signed-in session (override with `CLAUDE_ORG_ID`).

Verified response shape:

```json
{
  "five_hour":  { "utilization": 67.0, "resets_at": "2026-06-10T08:50:00+00:00" },
  "seven_day":  { "utilization": 18.0, "resets_at": "2026-06-16T06:00:00+00:00" },
  "seven_day_opus": null, "seven_day_sonnet": null,
  "extra_usage": {
    "is_enabled": true, "monthly_limit": 10000, "used_credits": 0.0,
    "currency": "USD"
  }
}
```

Field mapping (see `src/lib/limits.ts`):

| UI element            | Field                              | Notes                                   |
| --------------------- | ---------------------------------- | --------------------------------------- |
| **Current session %** | `five_hour.utilization`            | float 0–100; resets at `five_hour.resets_at` |
| **Weekly %**          | `seven_day.utilization`            | resets at `seven_day.resets_at`         |
| (model-specific)      | `seven_day_opus` / `seven_day_sonnet` | `null` on most plans; same shape when present |
| **Extra usage $ used**| `extra_usage.used_credits`         | dollars (float)                         |
| **Extra usage $ cap** | `extra_usage.monthly_limit` ÷ 100  | cents → `10000` = `$100.00`; gated by `is_enabled` |

## Why an embedded browser window

claude.ai sits behind **Cloudflare**. A request to the usage endpoint must come
from a real, challenge-cleared browser:

- A plain Node request returns **HTTP 403 "Just a moment…"** — Node's TLS/UA
  fingerprint isn't a browser's, so Cloudflare rejects it. Replaying a real
  browser's `cf_clearance` cookie from Node doesn't help: the clearance is bound
  to the original browser's fingerprint.
- An **automation-driven** browser (e.g. a Playwright-*launched* Chrome) is also
  flagged — `navigator.webdriver`, `--enable-automation` — and Cloudflare's
  Turnstile refuses to issue clearance, looping forever.

The app sidesteps both by using a **normal Electron (real Chromium) window** with
a stock-Chrome user-agent. You sign in and clear Cloudflare by hand once, exactly
like a normal browser session. The app then runs the usage `fetch()` **inside
that same window** (`webContents.executeJavaScript`), so the fingerprint and the
`cf_clearance` cookie match and the request succeeds. The `src/lib/limits.ts`
poller is transport-agnostic; `src/electron/main.ts` injects this window-backed
fetcher via `limits.setFetcher()`.

## Why not OAuth or the Admin API

- **Admin API** (`sk-ant-admin…`): officially supported, but org-only. It returns
  API usage and cost, not the Pro/Max subscription session/weekly limits.
- **"Login with Claude" OAuth** (the flow Claude Code uses): in principle this
  could yield a subscription token and avoid Cloudflare. In practice the only
  public OAuth client maps to the Console/API org, so for accounts that have both
  a subscription *and* a Console org the consent step fails. The embedded-window
  approach avoids the whole question by just being the logged-in web client.

## Operational notes

- **Sign-in persists** in the app's Electron session, so you normally sign in
  once. If the session expires, the card surfaces an HTTP 401/403 and you can
  reopen the sign-in window.
- The card is the only part of the app that touches claude.ai. The Claude Code
  transcript panel is independent — the app is fully usable even if you never
  sign in.

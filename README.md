# Claude Usage Dashboard

A local, near-realtime dashboard for your Claude usage. It reads two sources:

1. **Claude Code subscription usage** — parsed directly from the transcripts in
   `~/.claude/projects/**/*.jsonl`. Per-message token counts (input, output,
   cache write/read) are aggregated into cost estimates, broken down by model,
   project, and day, and grouped into the **5-hour reset windows** Claude uses,
   with a live burn-rate estimate. No API key, works offline.

2. **Anthropic API (Admin) usage & cost** — optional. If you set an
   `sk-ant-admin…` key, the dashboard pulls org-level usage and cost from the
   [Usage & Cost Admin API](https://platform.claude.com/docs/en/api/usage-cost-api).
   This is **organization-only** — individual Pro/Max accounts can't use it.

The page auto-refreshes every 5 seconds (local data) / 60 seconds (Admin API).

## Requirements

- **Node.js ≥ 18** (uses only the standard library — nothing to `npm install`).
- macOS or Linux. On Windows, run it inside WSL2 so the `~/.claude` path
  resolves correctly.
- An existing Claude Code install that has produced transcripts under
  `~/.claude/projects/`. If that folder is empty, the local panel will simply
  show no data.

## Configuration

**You don't need to configure anything to get started.** The local Claude Code
usage panel works offline with zero setup. The settings below are all optional.

| Variable              | Required? | Purpose                                                         |
| --------------------- | --------- | --------------------------------------------------------------- |
| `PORT`                | No        | Port to listen on. Default `4317`.                              |
| `HOST`                | No        | Interface to bind. Default `127.0.0.1` (localhost only). See [Privacy & security](#privacy--security) before changing. |
| `ANTHROPIC_ADMIN_KEY` | No        | Org Admin API key (`sk-ant-admin…`) to enable the Admin panel.  |

To keep your settings in a file, copy the provided template and fill it in:

```bash
cp .env.example .env
# then edit .env and add your values
```

> ⚠️ **Never commit your real `.env`.** It's already listed in `.gitignore`, and
> `ANTHROPIC_ADMIN_KEY` should be treated like a password. Only `.env.example`
> (which contains no secrets) belongs in the repo.

### Getting an Admin API key (optional)

The Admin panel is **organization-only**. If you're on an individual Pro/Max
plan you can skip this entirely — the panel just stays disabled.

1. Sign in to the [Anthropic Console](https://console.anthropic.com/) as a
   member of an **organization**.
2. Go to **Settings → API keys** and create an **Admin** key (it starts with
   `sk-ant-admin…`).
3. Put it in your `.env` as `ANTHROPIC_ADMIN_KEY=…`, or pass it inline (below).

## Run

No dependencies to install — it uses only the Node standard library.

```bash
cd claude-dashboard
node server.js
# → http://localhost:4317
```

To pass configuration inline (note: plain `node server.js` does **not**
auto-load `.env` — that convenience comes with the upcoming Docker Compose
setup; for now, export the vars or pass them on the command line):

```bash
ANTHROPIC_ADMIN_KEY=sk-ant-admin-... PORT=8080 node server.js
```

Or load your `.env` into the shell first:

```bash
set -a && source .env && set +a && node server.js
```

## About "limits"

There is **no official API** for Pro/Max subscription rate limits (the 5-hour
rolling window or weekly caps), so the dashboard can't show your exact remaining
quota. Instead it replicates the approach used by
[`ccusage`](https://github.com/ryoppippi/ccusage): it groups your activity into
5-hour windows that mirror Anthropic's reset cadence and shows how fast you're
burning through the current one, plus a naive projection to the reset time.

## How it works

```
server.js              zero-dependency HTTP server + static file serving
  /api/usage           parses + aggregates local transcripts on each request
  /api/admin           proxies the Admin API (cached 60s); {configured:false} if no key
lib/parse.js           reads ~/.claude transcripts, dedupes, per-file mtime cache
lib/pricing.js         list prices per model + cost-per-record (incl. cache rates)
lib/aggregate.js       totals, by-model/project/day, 5-hour blocks, burn rate, hourly series
lib/admin.js           Admin Usage & Cost API client
public/                dashboard UI (vanilla JS + Chart.js from CDN)
```

Costs are computed from public list prices and are **estimates**, not a bill.
Cache writes are priced at 1.25× (5-min) / 2× (1-hour) the input rate and cache
reads at 0.1×, matching Anthropic's published cache pricing.

## Privacy & security

Everything runs locally. Your transcripts are read from `~/.claude/projects/`
on your own machine and never leave it — the dashboard has no telemetry and
makes no outbound requests except, if you opt in, the Anthropic Admin API call
to fetch your own org's usage. None of your usage data is committed to the repo.

- **Localhost-only by default.** The server binds to `127.0.0.1`, so it is only
  reachable from your own machine. There is **no authentication**: if you
  override `HOST` to `0.0.0.0`, anyone on your network can read your usage data
  and (if configured) your org's API cost summary. The Admin key itself is never
  sent to the browser — `/api/admin` proxies the request server-side.
- **Audit `.claude/settings.local.json` before committing anything like it.**
  If you use Claude Code in this repo, it writes per-machine permission grants
  to `.claude/settings.local.json`. That file is deliberately `.gitignore`d
  here: it accumulates machine-specific paths and any command allowlists you've
  approved over time. Review it occasionally — broad grants (for example,
  allowlisting macOS `security` keychain commands) let any future session run
  those commands without asking — and never force-add it to a public repo.

## License

[MIT](LICENSE) © 2026 woocyun

## Acknowledgments

- The 5-hour rolling-window burn-rate approach is inspired by
  [`ccusage`](https://github.com/ryoppippi/ccusage) (MIT).
- The trend chart uses [Chart.js](https://www.chartjs.org/) (MIT), loaded from a
  CDN at runtime.

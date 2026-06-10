import { Entry } from './parse';

const HOUR = 3600 * 1000;
export const BLOCK_MS = 5 * HOUR; // Claude subscription windows reset every 5 hours.

export interface Totals {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  tokens: number;
  totalTokens: number;
  cost: number;
  count: number;
}

export interface GroupRow extends Totals {
  key: string;
}

export interface Block {
  start: number;
  end: number;
  totals: Totals;
  entries: Entry[];
}

export interface WindowSummary {
  start: number;
  resetAt: number;
  active: boolean;
  elapsedMin: number;
  remainingMin: number;
  totals: Totals;
  burn: {
    tokensPerMin: number;
    costPerMin: number;
    projectedTokens: number;
    projectedCost: number;
  };
}

export interface Summary {
  generatedAt: number;
  total: Totals;
  firstTs: number | null;
  lastTs: number | null;
  byModel: GroupRow[];
  byProject: GroupRow[];
  byDay: GroupRow[];
  window: WindowSummary | null;
  blocks: Array<{ start: number; end: number; totals: Totals }>;
  hourly: Array<{ hour: number; tokens: number; cost: number }>;
  unknownModels: string[];
}

function blankTotals(): Totals {
  return {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    tokens: 0,
    totalTokens: 0,
    cost: 0,
    count: 0,
  };
}

function addEntry(t: Totals, e: Entry): void {
  const u = e.usage;
  t.input += u.input;
  t.output += u.output;
  t.cacheWrite += u.cacheWrite5m + u.cacheWrite1h;
  t.cacheRead += u.cacheRead;
  t.tokens += u.input + u.output;
  t.totalTokens += u.input + u.output + u.cacheWrite5m + u.cacheWrite1h + u.cacheRead;
  t.cost += e.cost;
  t.count += 1;
}

function groupBy(entries: Entry[], keyFn: (e: Entry) => string): GroupRow[] {
  const map = new Map<string, Totals>();
  for (const e of entries) {
    const k = keyFn(e);
    if (!map.has(k)) map.set(k, blankTotals());
    addEntry(map.get(k)!, e);
  }
  return [...map.entries()]
    .map(([key, totals]) => ({ key, ...totals }))
    .sort((a, b) => b.cost - a.cost);
}

// Group entries into 5-hour billing-style windows, mirroring ccusage's logic:
// a block starts at the floor-to-hour of its first entry; an entry belongs to
// the current block if it falls within 5h of the block start AND within 5h of
// the previous entry. Otherwise a new block begins.
export function buildBlocks(entries: Entry[]): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let lastTs: number | null = null;
  for (const e of entries) {
    const ts = e.ts as number;
    if (
      cur === null ||
      ts - cur.start >= BLOCK_MS ||
      ts - (lastTs as number) >= BLOCK_MS
    ) {
      cur = {
        start: Math.floor(ts / HOUR) * HOUR,
        end: 0,
        totals: blankTotals(),
        entries: [],
      };
      blocks.push(cur);
    }
    cur.end = ts;
    addEntry(cur.totals, e);
    cur.entries.push(e);
    lastTs = ts;
  }
  return blocks;
}

// Describe the currently-active 5h window (the last block, if still open),
// including burn rate and a naive projection to the window's reset time.
export function currentWindow(blocks: Block[], now: number = Date.now()): WindowSummary | null {
  if (!blocks.length) return null;
  const b = blocks[blocks.length - 1];
  const resetAt = b.start + BLOCK_MS;
  const active = now < resetAt;
  const elapsedMs = Math.max(1, (active ? now : b.end) - b.start);
  const elapsedMin = elapsedMs / 60000;
  const tokensPerMin = b.totals.totalTokens / elapsedMin;
  const costPerMin = b.totals.cost / elapsedMin;
  const remainingMs = Math.max(0, resetAt - now);
  const remainingMin = remainingMs / 60000;
  return {
    start: b.start,
    resetAt,
    active,
    elapsedMin,
    remainingMin,
    totals: b.totals,
    burn: {
      tokensPerMin,
      costPerMin,
      projectedTokens: b.totals.totalTokens + tokensPerMin * remainingMin,
      projectedCost: b.totals.cost + costPerMin * remainingMin,
    },
  };
}

// A coarse hourly timeseries of total tokens + cost, for the trend chart.
function hourlySeries(
  entries: Entry[],
  hours: number = 48,
  now: number = Date.now(),
): Array<{ hour: number; tokens: number; cost: number }> {
  const startHour = Math.floor((now - hours * HOUR) / HOUR) * HOUR;
  const buckets = new Map<number, Totals>();
  for (let h = startHour; h <= now; h += HOUR) buckets.set(h, blankTotals());
  for (const e of entries) {
    const h = Math.floor((e.ts as number) / HOUR) * HOUR;
    if (h < startHour) continue;
    if (!buckets.has(h)) buckets.set(h, blankTotals());
    addEntry(buckets.get(h)!, e);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, t]) => ({ hour, tokens: t.totalTokens, cost: t.cost }));
}

export function summarize(entries: Entry[], now: number = Date.now()): Summary {
  const total = blankTotals();
  for (const e of entries) addEntry(total, e);
  const blocks = buildBlocks(entries);
  return {
    generatedAt: now,
    total,
    firstTs: entries.length ? (entries[0].ts as number) : null,
    lastTs: entries.length ? (entries[entries.length - 1].ts as number) : null,
    byModel: groupBy(entries, (e) => e.model),
    byProject: groupBy(entries, (e) => e.project),
    byDay: groupBy(entries, (e) => new Date(e.ts as number).toISOString().slice(0, 10)),
    window: currentWindow(blocks, now),
    blocks: blocks.map((b) => ({ start: b.start, end: b.end, totals: b.totals })),
    hourly: hourlySeries(entries, 48, now),
    unknownModels: [...new Set(entries.filter((e) => !e.known).map((e) => e.model))],
  };
}

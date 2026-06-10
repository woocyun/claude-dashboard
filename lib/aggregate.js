'use strict';

const HOUR = 3600 * 1000;
const BLOCK_MS = 5 * HOUR; // Claude subscription windows reset every 5 hours.

function blankTotals() {
  return {
    input: 0,
    output: 0,
    cacheWrite: 0,
    cacheRead: 0,
    tokens: 0, // input + output (the "billable conversation" size)
    totalTokens: 0, // everything including cache
    cost: 0,
    count: 0,
  };
}

function addEntry(t, e) {
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

function groupBy(entries, keyFn) {
  const map = new Map();
  for (const e of entries) {
    const k = keyFn(e);
    if (!map.has(k)) map.set(k, blankTotals());
    addEntry(map.get(k), e);
  }
  return [...map.entries()]
    .map(([key, totals]) => ({ key, ...totals }))
    .sort((a, b) => b.cost - a.cost);
}

// Group entries into 5-hour billing-style windows, mirroring ccusage's logic:
// a block starts at the floor-to-hour of its first entry; an entry belongs to
// the current block if it falls within 5h of the block start AND within 5h of
// the previous entry. Otherwise a new block begins.
function buildBlocks(entries) {
  const blocks = [];
  let cur = null;
  let lastTs = null;
  for (const e of entries) {
    if (
      cur === null ||
      e.ts - cur.start >= BLOCK_MS ||
      e.ts - lastTs >= BLOCK_MS
    ) {
      cur = {
        start: Math.floor(e.ts / HOUR) * HOUR,
        end: 0,
        totals: blankTotals(),
        entries: [],
      };
      blocks.push(cur);
    }
    cur.end = e.ts;
    addEntry(cur.totals, e);
    cur.entries.push(e);
    lastTs = e.ts;
  }
  return blocks;
}

// Describe the currently-active 5h window (the last block, if still open),
// including burn rate and a naive projection to the window's reset time.
function currentWindow(blocks, now = Date.now()) {
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
      // Projected window totals if the current burn rate holds to reset.
      projectedTokens: b.totals.totalTokens + tokensPerMin * remainingMin,
      projectedCost: b.totals.cost + costPerMin * remainingMin,
    },
  };
}

// A coarse hourly timeseries of total tokens + cost, for the trend chart.
function hourlySeries(entries, hours = 48, now = Date.now()) {
  const startHour = Math.floor((now - hours * HOUR) / HOUR) * HOUR;
  const buckets = new Map();
  for (let h = startHour; h <= now; h += HOUR) buckets.set(h, blankTotals());
  for (const e of entries) {
    const h = Math.floor(e.ts / HOUR) * HOUR;
    if (h < startHour) continue;
    if (!buckets.has(h)) buckets.set(h, blankTotals());
    addEntry(buckets.get(h), e);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, t]) => ({ hour, tokens: t.totalTokens, cost: t.cost }));
}

function summarize(entries, now = Date.now()) {
  const total = blankTotals();
  for (const e of entries) addEntry(total, e);
  const blocks = buildBlocks(entries);
  return {
    generatedAt: now,
    total,
    firstTs: entries.length ? entries[0].ts : null,
    lastTs: entries.length ? entries[entries.length - 1].ts : null,
    byModel: groupBy(entries, (e) => e.model),
    byProject: groupBy(entries, (e) => e.project),
    byDay: groupBy(entries, (e) => new Date(e.ts).toISOString().slice(0, 10)),
    window: currentWindow(blocks, now),
    blocks: blocks.map((b) => ({ start: b.start, end: b.end, totals: b.totals })),
    hourly: hourlySeries(entries, 48, now),
    unknownModels: [...new Set(entries.filter((e) => !e.known).map((e) => e.model))],
  };
}

module.exports = { summarize, buildBlocks, currentWindow, BLOCK_MS };

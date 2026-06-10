export interface Price {
  input: number;
  output: number;
}

export interface Usage {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

// Per-1M-token list prices (USD). Source: claude-api skill model table.
// input/output are the base rates. Cache write/read are derived from input:
//   5-minute cache write = 1.25x input, 1-hour cache write = 2x input,
//   cache read = 0.1x input.
export const PRICES: Record<string, Price> = {
  'claude-fable-5':    { input: 10, output: 50 },
  'claude-opus-4-8':   { input: 5,  output: 25 },
  'claude-opus-4-7':   { input: 5,  output: 25 },
  'claude-opus-4-6':   { input: 5,  output: 25 },
  'claude-opus-4-5':   { input: 5,  output: 25 },
  'claude-opus-4-1':   { input: 15, output: 75 },
  'claude-opus-4-0':   { input: 15, output: 75 },
  'claude-sonnet-4-6': { input: 3,  output: 15 },
  'claude-sonnet-4-5': { input: 3,  output: 15 },
  'claude-sonnet-4-0': { input: 3,  output: 15 },
  'claude-haiku-4-5':  { input: 1,  output: 5 },
  'claude-3-5-haiku':  { input: 0.8, output: 4 },
  'claude-3-5-sonnet': { input: 3,  output: 15 },
};

// Falls back on prefix match so dated snapshots (claude-opus-4-8-20260101)
// and minor variants still resolve.
export function priceFor(model: string | null | undefined): Price | null {
  if (!model) return null;
  if (PRICES[model]) return PRICES[model];
  for (const key of Object.keys(PRICES)) {
    if (model.startsWith(key)) return PRICES[key];
  }
  return null;
}

// Cost in USD for one usage record. Synthetic/throttle models (e.g. <synthetic>)
// and unknown models price at 0 and are reported separately by the parser.
export function costOf(model: string, u: Usage): number {
  const p = priceFor(model);
  if (!p) return 0;
  const inRate = p.input / 1e6;
  const outRate = p.output / 1e6;
  return (
    (u.input || 0) * inRate +
    (u.output || 0) * outRate +
    (u.cacheWrite5m || 0) * inRate * 1.25 +
    (u.cacheWrite1h || 0) * inRate * 2.0 +
    (u.cacheRead || 0) * inRate * 0.1
  );
}

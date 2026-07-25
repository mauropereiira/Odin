import type { TokenTotals } from "./types.js";

/**
 * Estimated equivalent API pricing, USD per million tokens. Costs shown in Helm
 * are notional — the user may be on a subscription/Max plan where no per-token
 * charge applies — so we label them "estimated equivalent API cost" everywhere.
 *
 * Rates follow Anthropic's published API tiers. Cache writes bill at 1.25× the
 * input rate, cache reads at 0.1×. Model ids are matched by substring so future
 * point releases resolve without a table update.
 */
interface Rate {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

function tier(input: number, output: number): Rate {
  return { input, output, cacheWrite: input * 1.25, cacheRead: input * 0.1 };
}

const OPUS = tier(15, 75);
const SONNET = tier(3, 15);
const HAIKU = tier(0.8, 4);

/** Ordered matchers — first substring hit wins. */
const MATCHERS: { test: RegExp; rate: Rate }[] = [
  { test: /opus/i, rate: OPUS },
  { test: /sonnet/i, rate: SONNET },
  { test: /haiku/i, rate: HAIKU },
  // Fable is a capable mid-tier model; price it at the Sonnet tier as a best estimate.
  { test: /fable/i, rate: SONNET },
];

export function rateFor(model: string | null | undefined): Rate | null {
  if (!model) return null;
  for (const m of MATCHERS) if (m.test.test(model)) return m.rate;
  return null;
}

/** True when we have no price for this model (cost counted as $0, flagged in UI). */
export function isUnknownModel(model: string | null | undefined): boolean {
  return !!model && rateFor(model) === null;
}

/** Estimated USD for a bundle of tokens billed against one model's rates. */
export function costFor(model: string | null | undefined, t: TokenTotals): number {
  const r = rateFor(model);
  if (!r) return 0;
  return (
    (t.input * r.input +
      t.output * r.output +
      t.cacheCreate * r.cacheWrite +
      t.cacheRead * r.cacheRead) /
    1_000_000
  );
}

export const emptyTokens = (): TokenTotals => ({
  input: 0,
  output: 0,
  cacheCreate: 0,
  cacheRead: 0,
});

export function addTokens(a: TokenTotals, b: TokenTotals): TokenTotals {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheCreate: a.cacheCreate + b.cacheCreate,
    cacheRead: a.cacheRead + b.cacheRead,
  };
}

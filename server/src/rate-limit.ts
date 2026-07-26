const DEFAULT_REQUEST_LIMIT = 600;

export function requestLimitMax(): number {
  const configured = Number(process.env.ODIN_RATE_LIMIT_MAX);
  return Number.isInteger(configured) && configured >= 10 && configured <= 10_000
    ? configured
    : DEFAULT_REQUEST_LIMIT;
}

export function isLoopbackHost(value: string | undefined): boolean {
  if (!value) return false;
  const authority = value.trim().toLowerCase();
  const match = authority.startsWith("[")
    ? authority.match(/^\[(::1)\](?::(\d{1,5}))?$/)
    : authority.match(/^(localhost|127\.0\.0\.1)(?::(\d{1,5}))?$/);
  if (!match) return false;
  return match[2] === undefined || Number(match[2]) <= 65_535;
}

export function isLoopbackOrigin(value: string | undefined): boolean {
  if (!value) return true;
  try {
    return isLoopbackHost(new URL(value).host);
  } catch {
    return false;
  }
}

export function isRequestNamespace(value: string, namespace: string): boolean {
  try {
    const pathname = new URL(value, "http://localhost").pathname;
    return pathname === namespace || pathname.startsWith(`${namespace}/`);
  } catch {
    return false;
  }
}

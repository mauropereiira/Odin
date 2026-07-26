const SAFE_SLUG = /^[\p{Alphabetic}\p{N}-]{1,128}$/u;
const SAFE_LOCAL_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isSafeSlug(value: string): boolean {
  return SAFE_SLUG.test(value);
}

export function isSafeLocalId(value: string): boolean {
  return SAFE_LOCAL_ID.test(value);
}

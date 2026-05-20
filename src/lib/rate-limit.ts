import "server-only";

type Bucket = { count: number; lockedUntil: number };

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

const buckets = new Map<string, Bucket>();

export function isLocked(key: string): boolean {
  const b = buckets.get(key);
  return !!b && b.lockedUntil > Date.now();
}

export function registerFailure(key: string): { locked: boolean; remaining: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.lockedUntil + WINDOW_MS < now) {
    buckets.set(key, { count: 1, lockedUntil: 0 });
    return { locked: false, remaining: MAX_FAILURES - 1 };
  }
  b.count += 1;
  if (b.count >= MAX_FAILURES) {
    b.lockedUntil = now + LOCK_MS;
    return { locked: true, remaining: 0 };
  }
  return { locked: false, remaining: MAX_FAILURES - b.count };
}

export function registerSuccess(key: string) {
  buckets.delete(key);
}

import "server-only";
import { compare } from "bcryptjs";

const COOKIE_NAME = "manufacturing_session";

export function getCookieName() {
  return COOKIE_NAME;
}

export function getSessionMaxAgeSeconds() {
  const days = Number(process.env.SESSION_MAX_AGE_DAYS ?? 7);
  return Math.max(1, days) * 24 * 60 * 60;
}

export async function verifyPassword(input: string): Promise<boolean> {
  const hash = process.env.APP_PASSWORD_HASH;
  if (!hash) {
    throw new Error(
      "APP_PASSWORD_HASH is not set. Run `npm run auth:hash -- <password>` and put the result in .env.",
    );
  }
  return compare(input, hash);
}

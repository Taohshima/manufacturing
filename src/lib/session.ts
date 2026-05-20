import { SignJWT, jwtVerify } from "jose";

const SESSION_AUDIENCE = "manufacturing";

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error("SESSION_SECRET must be set to a value of 16+ characters.");
  }
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(maxAgeSeconds: number): Promise<string> {
  return new SignJWT({ ok: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(SESSION_AUDIENCE)
    .setExpirationTime(`${maxAgeSeconds}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, getSecret(), { audience: SESSION_AUDIENCE });
    return true;
  } catch {
    return false;
  }
}

// Edge-safe session tokens (used by middleware AND server). No node-only imports.
import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const SESSION_COOKIE = "erp_session";

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  // A hard failure in prod is better than silently using a weak key.
  return new TextEncoder().encode(s || "dev-only-insecure-secret-change-me");
}

export async function signSession(payload: { uid: number; role: string }): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifySession(token: string): Promise<(JWTPayload & { uid: number; role: string }) | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as JWTPayload & { uid: number; role: string };
  } catch {
    return null;
  }
}

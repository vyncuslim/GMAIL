import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "vmail_session";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not configured");
  return value;
}

export function makeSession() {
  const payload = "vyncuslim-mail";
  const sig = createHmac("sha256", secret()).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

export function isSessionValueValid(actual?: string | null) {
  if (!actual) return false;
  const expected = makeSession();
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function isAuthenticated() {
  const jar = await cookies();
  return isSessionValueValid(jar.get(SESSION_COOKIE)?.value);
}

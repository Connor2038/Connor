import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { apiKey, ApiError } from './api';
async function cookieName() {
  // Cookies do not isolate ports; independent localhost demos must do so explicitly.
  const host = (await headers()).get('host') ?? 'localhost';
  return 'vivix-demo-' + createHash('sha256').update(host).digest('hex').slice(0, 12);
}
function signature(value: string) {
  return createHmac('sha256', apiKey()).update(value).digest('hex');
}
export async function ownedSession(): Promise<string | null> {
  const raw = (await cookies()).get(await cookieName())?.value;
  if (!raw) return null;
  const [encoded, tag] = raw.split('.');
  const expected = signature(encoded);
  if (
    !tag ||
    tag.length !== expected.length ||
    !timingSafeEqual(Buffer.from(tag), Buffer.from(expected))
  )
    return null;
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as {
    id: string;
    expires: number;
  };
  return payload.expires > Date.now() ? payload.id : null;
}
export async function saveSession(id: string) {
  const value = Buffer.from(JSON.stringify({ id, expires: Date.now() + 3600_000 })).toString(
    'base64url',
  );
  (await cookies()).set(await cookieName(), `${value}.${signature(value)}`, {
    httpOnly: true,
    sameSite: 'strict',
    path: '/',
    maxAge: 3600,
    secure: process.env.NODE_ENV === 'production',
  });
}
export async function clearSession() {
  (await cookies()).delete(await cookieName());
}
export async function requireSession() {
  const id = await ownedSession();
  if (!id) throw new ApiError('NO_SESSION', 'No active session belongs to this browser.', 404);
  return id;
}

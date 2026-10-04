import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';
import { headers } from 'next/headers';

export function checkAppAccess(authorization: string | null): Response | null {
  const password = process.env.APP_PASSWORD;
  if (!password || password.length < 16) {
    return Response.json({ error: 'Dostęp nie jest skonfigurowany. Ustaw APP_PASSWORD (minimum 16 znaków).' }, { status: 503 });
  }
  const digest = (value: string) => createHash('sha256').update(value).digest();
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(authorization ?? '');
  const actual = match ? Buffer.from(match[1], 'base64').toString('utf8') : '';
  if (!timingSafeEqual(digest(actual), digest(`admin:${password}`))) {
    return Response.json({ error: 'Wymagane logowanie.' }, {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Private Chat", charset="UTF-8"', 'Cache-Control': 'no-store' },
    });
  }
  return null;
}

export async function requireAppAccess() {
  const denied = checkAppAccess((await headers()).get('authorization'));
  if (denied) throw new Error('Unauthorized');
}

export function checkMutationOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && origin !== expected)) {
    return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 });
  }
  return null;
}

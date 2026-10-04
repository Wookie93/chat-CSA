import 'server-only';

export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function readJsonBody(request: Request, maxBytes: number): Promise<unknown> {
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) throw new RequestError('Request too large', 413);
  if (!request.body) throw new RequestError('JSON body required', 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new RequestError('Request too large', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RequestError('Invalid JSON', 400); }
}

// A shared account has a shared budget. Never trust client-supplied IP headers.
// Memory storage is for one persistent Node process. Redis is required when scaling out.
const buckets = new Map<string, { count: number; expires: number }>();
export async function checkRateLimit(service: 'chat' | 'translate'): Promise<Response | null> {
  const rules = service === 'chat' ? [[60, 10], [86400, 200]] : [[60, 30], [86400, 1000]];
  const now = Date.now();
  for (const [seconds, limit] of rules) {
    const window = Math.floor(now / (seconds * 1000));
    const key = `private-chat:${service}:${seconds}:${window}`;
    let count: number;
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    if (redisUrl && redisToken) {
      try {
        const response = await fetch(redisUrl, {
          method: 'POST',
          headers: { Authorization: `Bearer ${redisToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(['EVAL', 'local n=redis.call("INCR",KEYS[1]); if n==1 then redis.call("EXPIRE",KEYS[1],ARGV[1]) end; return n', '1', key, String(seconds)]),
          cache: 'no-store', signal: AbortSignal.timeout(5000),
        });
        if (!response.ok) throw new Error('Rate limit store unavailable');
        const data = await response.json();
        if (!Number.isFinite(data.result)) throw new Error('Invalid rate limit response');
        count = data.result;
      } catch {
        return Response.json({ error: 'Rate limit service unavailable. Try again later.' }, { status: 503 });
      }
    } else {
      // Fail closed in production unless a single-process deployment is explicitly selected.
      if (process.env.NODE_ENV === 'production' && process.env.RATE_LIMIT_STORE !== 'memory') {
        return Response.json({ error: 'Rate limiting is not configured.' }, { status: 503 });
      }
      for (const [oldKey, bucket] of buckets) if (bucket.expires <= now) buckets.delete(oldKey);
      const bucket = buckets.get(key) ?? { count: 0, expires: (window + 1) * seconds * 1000 };
      count = ++bucket.count;
      buckets.set(key, bucket);
    }
    if (count > limit) {
      const retry = Math.max(1, Math.ceil(((window + 1) * seconds * 1000 - now) / 1000));
      return Response.json({ error: 'Limit zapytań został osiągnięty. Spróbuj później.' }, { status: 429, headers: { 'Retry-After': String(retry) } });
    }
  }
  return null;
}

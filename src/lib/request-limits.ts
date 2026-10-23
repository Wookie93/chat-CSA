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

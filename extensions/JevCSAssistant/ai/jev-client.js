// Decisions API: https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request
export const MODEL = 'typesafe/jev-1.13';
export const ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const retryable = new Set([429, 500, 502, 503, 524, 529]);
const probability = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
export function validateAnswers(raw, questions) {
  const answers = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = raw?.answers?.[id];
    if (!a || a.type !== q.type) throw new Error(`Jev: brak/poprawność typu odpowiedzi ${id}.`);
    if (q.type === 'choice') {
      const keys = Object.keys(q.criteria);
      if (!keys.includes(a.choice) || !probability(a.confidence) ||
          keys.some(k => !probability(a.probabilities?.[k])) ||
          Object.keys(a.probabilities).some(k => !keys.includes(k)) ||
          Math.abs(Object.values(a.probabilities).reduce((n, v) => n + v, 0) - 1) > 0.02) {
        throw new Error(`Jev: nieprawidłowa odpowiedź ${id}.`);
      }
    } else if (q.type === 'noul' && !probability(a.noul)) throw new Error(`Jev: nieprawidłowe prawdopodobieństwo ${id}.`);
    answers[id] = a;
  }
  return answers;
}
export async function decide({ apiKey, state, questions, model = MODEL, signal, fetchImpl = fetch, timeoutMs = 20000 }) {
  if (!apiKey) throw new Error('Uzupełnij klucz OpenRouter w ustawieniach.');
  if (!Object.keys(questions).length || Object.keys(questions).length > 200) throw new Error('Jev: przekroczono limit pytań aplikacji.');
  const body = JSON.stringify({ model, state, questions });
  if (body.length > 65000) throw new Error('Za długi kontekst Jev. Skróć wątek lub katalog; dane nie zostały obcięte.');
  const started = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetchImpl(ENDPOINT, { method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'JevCSAssistant' }, body });
      if (!response.ok) {
        await response.body?.cancel?.();
        if (attempt === 0 && retryable.has(response.status)) {
          await new Promise(resolve => setTimeout(resolve, 500));
          continue;
        }
        throw new Error(`Jev: HTTP ${response.status}.`);
      }
      const raw = await response.json();
      const answers = validateAnswers(raw, questions);
      const cost = typeof raw.usage?.cost === 'number' && raw.usage.cost >= 0 ? raw.usage.cost : null;
      return { answers, metrics: { ms: Date.now() - started, calls: attempt + 1, costUsd: cost,
        costSource: cost === null ? 'unknown' : 'api', inputTokens: raw.usage?.input_tokens ?? null, model: raw.model || model } };
    }
  } catch (e) {
    if (controller.signal.aborted) throw new Error(signal?.aborted ? 'Anulowano analizę.' : 'Jev: przekroczono czas odpowiedzi.');
    throw e;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

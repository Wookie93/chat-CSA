// Text generation is an explicit, manual-only action. Factual blocks remain byte-for-byte intact.
export function restoreBlocks(text, original) {
  const token = '[[VERIFIED_REPLY]]';
  if (typeof text !== 'string' || text.split(token).length !== 2 || text.length > 12000) throw new Error('LLM nie zachował bloku danych. Pozostawiono wzorzec.');
  const outside = text.replace(token, '');
  if (/\d|\{\{|\[\[/.test(outside)) throw new Error('LLM dodał dane poza blokiem. Pozostawiono wzorzec.');
  return text.replace(token, original);
}
export const REDACTION_PROMPT = `Write a short greeting and closing for a customer service email in the specified language. Keep the literal marker [[VERIFIED_REPLY]] exactly once, unchanged, between greeting and closing. Do not add facts, prices, dates, availability, promises, bookings, or answers. Return only the plain text email shell.`;

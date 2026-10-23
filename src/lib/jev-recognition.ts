import { recognitionCatalog } from '../../extensions/JevCSAssistant/core/product-names.js';

type Item = { id: string; name: string; aliases?: string[]; unit: string; quantities: number[]; baseQuantity?: number };
const key = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('pl')
  .replace(/[“”„‟«»"]/g, '').replace(/[‐‑‒–—−]/g, '-').replace(/\s+/g, ' ');

export function chatRecognitionCatalog<T extends { items: Item[] }>(catalog: T): T {
  const enriched = recognitionCatalog(catalog);
  const rules: Record<string, string[]> = {
    'M1 Garand': ['M1'],
    'Thompson WW2': ['Thompson'],
    'Kalashnikov Classic (AK-47)': ['AK', 'Kałasznikow', 'AK-47 Kalashnikov'],
    'Shotgun (Winchester SXP)': ['Winchester SXP', 'Winchester SXP Shotgun'],
    'Colt 1911 (standard)': ['Colt M1911', 'Colt 1911', 'Colt M1911 standard'],
    'Colt 1911 (tactical)': ['Colt M1911 tactical'],
  };
  return { ...enriched, items: enriched.items.map((item: Item) => ({ ...item,
    aliases: [...new Set([...(item.aliases || []),
      ...(catalog.items.filter(other => key(other.name) === key(item.name)).length === 1 ? rules[item.name] || [] : [])])],
  })) };
}

// Accept whitespace-separated names only when the entire list has one unique
// catalog interpretation. Numbers and unknown words cannot be discarded.
export function recognizeChatNameList<T extends Item>(text: string, catalog: { items: T[] }): T[] | null {
  const tokens = key(text).split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length || tokens.length > 100) return null;
  const names = catalog.items.flatMap(item => [item.name, ...(item.aliases || [])]
    .map(name => ({ item, tokens: key(name).split(' ') })));
  const memo = new Map<number, T[][]>();
  function parse(start: number): T[][] {
    if (start === tokens.length) return [[]];
    if (memo.has(start)) return memo.get(start)!;
    const results: T[][] = [];
    for (const candidate of names) {
      if (!candidate.tokens.every((token, index) => token === tokens[start + index])) continue;
      for (const tail of parse(start + candidate.tokens.length)) {
        const path = [candidate.item, ...tail];
        if (path.length > 30 || results.some(result => result.map(item => item.id).join('|') === path.map(item => item.id).join('|'))) continue;
        results.push(path);
        if (results.length === 2) { memo.set(start, results); return results; }
      }
    }
    memo.set(start, results);
    return results;
  }
  const paths = parse(0);
  return paths.length === 1 ? [...new Map(paths[0].map(item => [item.id, item])).values()] : null;
}

type ListEntry<T> = { item: T; quantity: number | null; quotedPrice: string | null; shotUnit: string | null };

// Parse names and optional shot/price annotations together. Never strip numbers
// globally: model numbers, explicit quantities and unknown text must stay distinct.
export function recognizeChatOrderList<T extends Item>(text: string, catalog: { items: T[] }) {
  const tokenize = (value: string) => key(value)
    .replace(/(\d),(\d{1,2})(?=\s*(?:pln|zł|zl)\b)/g, '$1.$2')
    .match(/[()]|[^()\s,;]+/g) ?? [];
  const tokens = tokenize(text);
  if (!tokens.length || tokens.length > 400) return null;
  const names = catalog.items.flatMap(item => [item.name, ...(item.aliases || [])]
    .map(name => ({ item, tokens: tokenize(name) })));
  const unit = /^(?:shots?|strzałów|strzały|strzał)$/;
  const money = /^\d+(?:\.\d{1,2})?$/;
  function annotation(start: number) {
    let end = start;
    let quantity: number | null = null;
    let shotUnit: string | null = null;
    let quotedPrice: string | null = null;
    let at = tokens[end] === '-' ? end + 1 : end;
    const bracket = tokens[at] === '(';
    const numberAt = at + (bracket ? 1 : 0);
    if (/^[1-9]\d*$/.test(tokens[numberAt] ?? '') && unit.test(tokens[numberAt + 1] ?? '') &&
      (!bracket || tokens[numberAt + 2] === ')')) {
      quantity = Number(tokens[numberAt]);
      if (!Number.isSafeInteger(quantity)) return null;
      shotUnit = tokens[numberAt + 1];
      end = numberAt + (bracket ? 3 : 2);
    }
    at = tokens[end] === '-' ? end + 1 : end;
    const joinedPrice = /^(\d+(?:\.\d{1,2})?)(pln|zł|zl)$/.exec(tokens[at] ?? '');
    if (joinedPrice) { quotedPrice = tokens[at]; end = at + 1; }
    else if (money.test(tokens[at] ?? '') && /^(pln|zł|zl)$/.test(tokens[at + 1] ?? '')) {
      quotedPrice = `${tokens[at]} ${tokens[at + 1]}`; end = at + 2;
    }
    return { end, quantity, quotedPrice, shotUnit };
  }
  const memo = new Map<number, ListEntry<T>[][]>();
  function parse(start: number): ListEntry<T>[][] {
    if (start === tokens.length) return [[]];
    if (memo.has(start)) return memo.get(start)!;
    const results: ListEntry<T>[][] = [];
    for (const candidate of names) {
      if (!candidate.tokens.length || !candidate.tokens.every((token, i) => token === tokens[start + i])) continue;
      const suffix = annotation(start + candidate.tokens.length);
      if (!suffix || (suffix.quantity !== null && candidate.item.unit !== 'shot')) continue;
      for (const tail of parse(suffix.end)) {
        const path = [{ item: candidate.item, quantity: suffix.quantity, quotedPrice: suffix.quotedPrice, shotUnit: suffix.shotUnit }, ...tail];
        const signature = (entries: ListEntry<T>[]) => JSON.stringify(entries.map(e => [e.item.id, e.quantity, e.quotedPrice]));
        if (path.length > 30 || results.some(result => signature(result) === signature(path))) continue;
        results.push(path);
        if (results.length === 2) { memo.set(start, results); return results; }
      }
    }
    memo.set(start, results);
    return results;
  }
  const paths = parse(0);
  if (paths.length !== 1) return null;
  const entries: ListEntry<T>[] = [];
  for (const entry of paths[0]) {
    const previous = entries.find(other => other.item.id === entry.item.id);
    if (previous) {
      if (previous.quantity !== null || entry.quantity !== null || previous.quotedPrice !== entry.quotedPrice) return null;
    } else entries.push(entry);
  }
  const units = entries.map(entry => entry.shotUnit).filter(Boolean);
  return { entries, language: units.length && units.every(value => /^shots?$/.test(value!)) ? 'en' : 'pl' };
}

export function recognizeChatShotList<T extends Item>(text: string, catalog: { items: T[] }) {
  const result = recognizeChatOrderList(text, catalog);
  if (!result || result.entries.some(entry => entry.quantity === null)) return null;
  return { ...result, entries: result.entries.map(entry => ({ ...entry, quantity: entry.quantity! })) };
}

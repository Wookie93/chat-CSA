const key = value => value.trim().toLocaleLowerCase('pl').replace(/\s+/g, ' ');

// Approved spellings only. Never infer an arbitrary model number or a price.
const approved = [
  ['Glock 17', ['Glock', 'Clock', 'Clock 17']],
  ['Glock 19', ['Clock 19']],
  ['Glock 19X', ['Clock 19X']],
  ['P08 Luger', ['Luger', 'Luuger', 'Lugerr']],
  ['Kalashnikov Classic (AK-47)', ['AK-47', 'AL-47']],
];

export function recognitionCatalog(catalog) {
  return { ...catalog, items: catalog.items.map(item => {
    const rule = approved.find(([name]) => key(name) === key(item.name));
    const uniqueTarget = catalog.items.filter(other => key(other.name) === key(item.name)).length === 1;
    return { ...item, aliases: [...new Set([...(item.aliases || []), ...(rule && uniqueTarget ? rule[1] : [])])] };
  }) };
}

// Only a whole, fresh list is accepted. Prose, quantities, unknown names and
// ambiguous aliases go through Jev together with the complete conversation.
export function recognizeNameList(text, catalog) {
  const parts = text.split(/[\n,;]+/).map(part => part.trim()).filter(Boolean);
  if (!parts.length || parts.length > 30) return null;
  const items = [];
  for (const part of parts) {
    const candidates = catalog.items.filter(item => [item.name, ...(item.aliases || [])].some(name => key(name) === key(part)));
    if (candidates.length !== 1) return null;
    if (!items.some(item => item.id === candidates[0].id)) items.push(candidates[0]);
  }
  return items;
}

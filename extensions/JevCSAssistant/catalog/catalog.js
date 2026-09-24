export const EMPTY_CATALOG = { version: '1', currency: 'PLN', approved: false, items: [] };
export function validateCatalog(catalog) {
  if (!catalog || typeof catalog.version !== 'string' || !catalog.version || catalog.currency !== 'PLN' ||
      typeof catalog.approved !== 'boolean' || !Array.isArray(catalog.items) || catalog.items.length > 100) throw new Error('Katalog: wymagane version, currency PLN, approved i items (maks. 100).');
  if (catalog.durationRule != null && catalog.durationRule !== 'maxParticipantSum') throw new Error('Nieznana reguła czasu wizyty.');
  if (catalog.serviceFeeGrosz != null && (!Number.isSafeInteger(catalog.serviceFeeGrosz) || catalog.serviceFeeGrosz < 0)) throw new Error('Nieprawidłowa opłata serwisowa.');
  const ids = new Set();
  for (const item of catalog.items) {
    if (!/^[a-z][a-z0-9_-]{0,39}$/.test(item.id) || ids.has(item.id)) throw new Error('Katalog: nieprawidłowe lub powtórzone ID.');
    ids.add(item.id);
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 150 || !['shot', 'package', 'extra'].includes(item.unit) ||
      !Number.isSafeInteger(item.priceGrosz) || item.priceGrosz < 0 || item.priceGrosz > 10000000 ||
      !Array.isArray(item.quantities) || !item.quantities.length || item.quantities.length > 100 ||
      item.quantities.some(n => !Number.isSafeInteger(n) || n < 1 || n > 1000) ||
      new Set(item.quantities).size !== item.quantities.length) throw new Error(`Katalog: sprawdź nazwę, jednostkę, cenę i quantities dla ${item.id}.`);
    if (item.baseQuantity != null && (!Number.isInteger(item.baseQuantity) || item.baseQuantity < 1 || item.quantities.some(q => q % item.baseQuantity))) throw new Error('Ilości muszą być wielokrotnością baseQuantity.');
    if (item.aliases !== undefined && (!Array.isArray(item.aliases) || item.aliases.length > 20 || item.aliases.some(x => typeof x !== 'string' || x.length > 100))) throw new Error('Katalog: nieprawidłowe aliasy.');
    if (item.durationMin != null && (!Number.isInteger(item.durationMin) || item.durationMin < 1 || item.durationMin > 480)) throw new Error('Katalog: durationMin musi wynosić 1–480.');
    if (item.exclusiveWith !== undefined && (!Array.isArray(item.exclusiveWith) || item.exclusiveWith.some(x => typeof x !== 'string'))) throw new Error('Katalog: exclusiveWith musi być listą ID.');
  }
  for (const item of catalog.items) if (item.exclusiveWith?.some(id => !ids.has(id) || id === item.id)) throw new Error('Katalog: nieznane ID w exclusiveWith.');
  return catalog;
}

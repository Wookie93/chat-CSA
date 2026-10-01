import { validateCatalog } from '../catalog/catalog.js';
export function priceOrder(order, catalog) {
  validateCatalog(catalog);
  const issues = [];
  const lines = [];
  const people = order.billingPeople ?? order.people;
  const invalidShots = [];
  const personTotals = [];
  if (Number.isInteger(order.people) && Number.isInteger(order.billingPeople) && order.people !== order.billingPeople) issues.push('niezgodna liczba uczestników i wycenionych zestawów');
  if (!Number.isInteger(people) || people < 1 || people > 30) issues.push('liczba osób');
  if (!catalog.approved || !catalog.items.length) issues.push('zatwierdzony cennik');
  if (!Array.isArray(order.participants) || order.participants.length !== people) issues.push('lista uczestników');
  const ids = new Set();
  for (const p of order.participants || []) {
    if (!Number.isInteger(p.id) || p.id < 1 || p.id > people || ids.has(p.id)) issues.push('identyfikatory uczestników');
    ids.add(p.id);
    if (!p.complete) issues.push(`pełny wybór osoby ${p.id}`);
    if (!Array.isArray(p.items) || !p.items.length) issues.push(`wybór osoby ${p.id}`);
    const used = new Set();
    let personTotal = 0;
    let hasPackage = false;
    for (const entry of p.items || []) {
      const item = catalog.items.find(x => x.id === entry.itemId);
      if (item?.unit === 'shot' && Number.isSafeInteger(entry.quantity) && entry.quantity > 0 && entry.quantity % (item.baseQuantity || 1)) invalidShots.push({ personId: p.id, name: item.name, quantity: entry.quantity });
      if (!item || used.has(entry.itemId) || !Number.isSafeInteger(entry.quantity) || !item.quantities.includes(entry.quantity)) {
        issues.push(`pozycja/ilość osoby ${p.id}`); continue;
      }
      used.add(entry.itemId);
      if (item.exclusiveWith?.some(id => p.items.some(e => e.itemId === id))) issues.push(`nakładające się produkty osoby ${p.id}`);
      const totalGrosz = item.priceGrosz * (entry.quantity / (item.baseQuantity || 1));
      personTotal += totalGrosz; hasPackage ||= item.unit === 'package';
      lines.push({ personId: p.id, itemId: item.id, name: item.name, quantity: entry.quantity,
        unit: item.unit, baseQuantity: item.baseQuantity || 1, basePriceGrosz: item.priceGrosz, totalGrosz });
    }
    const fee = !hasPackage && p.items?.length ? (catalog.serviceFeeGrosz || 0) : 0;
    if (fee) lines.push({ personId: p.id, itemId: '__service', name: 'Opłata serwisowa', quantity: 1, unit: 'fee', totalGrosz: fee });
    personTotals.push({ personId: p.id, totalGrosz: personTotal + fee });
  }
  const complete = issues.length === 0 && lines.length > 0;
  return { status: invalidShots.length ? 'invalid' : complete ? 'complete' : 'incomplete', catalogVersion: catalog.version, currency: 'PLN', lines, personTotals: complete ? personTotals : [], invalidShots,
    totalGrosz: complete ? lines.reduce((sum, l) => sum + l.totalGrosz, 0) : null, issues: [...new Set(issues)] };
}
export function visitDuration(order, catalog) {
  // Explicit catalog rule: participant's durations add; participants shoot in parallel.
  // Enabled by the operator, never inferred from firearm names.
  if (catalog.durationRule !== 'maxParticipantSum') return null;
  if (priceOrder(order, catalog).status !== 'complete') return null;
  const values = order.participants.map(p => p.items.reduce((sum, e) => {
    const d = catalog.items.find(i => i.id === e.itemId)?.durationMin;
    return d == null ? NaN : sum + d * e.quantity / (catalog.items.find(i => i.id === e.itemId).baseQuantity || 1);
  }, 0));
  const minutes = Math.max(...values);
  return Number.isInteger(minutes) && minutes > 0 && minutes <= 480 ? minutes : null;
}

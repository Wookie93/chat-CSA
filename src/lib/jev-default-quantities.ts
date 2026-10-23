type CatalogItem = {
  id: string;
  name: string;
  unit: string;
  baseQuantity?: number;
  quantities: number[];
};
type DecisionField = { value: string | null; status: string; source?: string };
type Analysis = {
  matches: { itemId: string | null; status: string }[];
  fields: Record<string, DecisionField>;
  order: { participants: { id: number; complete: boolean; items: { itemId: string; quantity: number }[] }[] };
};

export function defaultShotQuantity(item: CatalogItem) {
  return item.unit === 'shot' && Number.isSafeInteger(item.baseQuantity) &&
    item.quantities.includes(item.baseQuantity!) ? item.baseQuantity! : null;
}

export function applyDefaultShotQuantities(analysis: Analysis, catalog: { items: CatalogItem[] }) {
  const applied: { personId: number; name: string; quantity: number }[] = [];
  for (const person of analysis.order.participants) {
    for (const match of analysis.matches) {
      if (match.status !== 'matched' || person.items.some(item => item.itemId === match.itemId)) continue;
      const field = analysis.fields[`p${person.id}_${match.itemId}`];
      // An uncertain amount, explicit omission or invalid explicit amount is not a missing amount.
      if (field?.status !== 'missing') continue;
      const item = catalog.items.find(item => item.id === match.itemId);
      const quantity = item ? defaultShotQuantity(item) : null;
      if (!item || quantity === null) continue;
      person.items.push({ itemId: item.id, quantity });
      field.value = String(quantity);
      field.status = 'known';
      field.source = 'catalog-default';
      applied.push({ personId: person.id, name: item.name, quantity });
    }
    person.complete = analysis.fields[`p${person.id}_complete`]?.value === 'yes' &&
      analysis.matches.every(match => match.status === 'matched' &&
        analysis.fields[`p${person.id}_${match.itemId}`]?.status === 'known');
  }
  return applied;
}

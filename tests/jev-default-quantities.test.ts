import { expect, it } from 'vitest';
import { applyDefaultShotQuantities, defaultShotQuantity } from '@/lib/jev-default-quantities';
import { priceOrder } from '../extensions/JevCSAssistant/tools/pricing.js';
const gun = { id: 'glock', name: 'Glock 17', unit: 'shot', baseQuantity: 10, quantities: [10, 20], priceGrosz: 6000 };
const catalog = { version: 'test', currency: 'PLN', approved: true, items: [gun] };
function analysis(status = 'missing', value: string | null = null) {
  return { matches: [{ itemId: gun.id, status: 'matched' }],
    fields: { p1_complete: { status: 'known', value: 'yes' as string | null }, p1_glock: { status, value } },
    order: { billingPeople: 1, participants: [{ id: 1, complete: false, items: [] as { itemId: string; quantity: number }[] }] } };
}
it('uses the catalog base amount, completes the order and prices it deterministically', () => {
  const result = analysis();
  expect(applyDefaultShotQuantities(result, catalog)).toEqual([{ personId: 1, name: gun.name, quantity: 10 }]);
  expect(result.order.participants[0].complete).toBe(true);
  expect(priceOrder(result.order, catalog).totalGrosz).toBe(6000);
});
it('preserves an explicit quantity and never replaces invalid explicit quantities', () => {
  for (const quantity of [20, 17]) {
    const result = analysis('known', String(quantity));
    result.order.participants[0].items.push({ itemId: gun.id, quantity });
    expect(applyDefaultShotQuantities(result, catalog)).toEqual([]);
    expect(result.order.participants[0].items[0].quantity).toBe(quantity);
    expect(priceOrder(result.order, catalog).status).toBe(quantity === 20 ? 'complete' : 'invalid');
  }
});
it('keeps uncertainty and explicit omissions separate from missing quantities', () => {
  for (const [status, value] of [['ambiguous', null], ['other', null], ['known', 'none']] as const) {
    const result = analysis(status, value);
    expect(applyDefaultShotQuantities(result, catalog)).toEqual([]);
    expect(result.order.participants[0].items).toEqual([]);
  }
});
it('never guesses a base quantity or defaults packages', () => {
  expect(defaultShotQuantity({ ...gun, baseQuantity: undefined })).toBeNull();
  expect(defaultShotQuantity({ ...gun, baseQuantity: 7 })).toBeNull();
  expect(defaultShotQuantity({ ...gun, unit: 'package', baseQuantity: 1, quantities: [1] })).toBeNull();
});
it('does not turn uncertain product assignments into complete orders', () => {
  const result = analysis();
  result.fields.p1_complete.value = null;
  applyDefaultShotQuantities(result, catalog);
  expect(result.order.participants[0].complete).toBe(false);
});

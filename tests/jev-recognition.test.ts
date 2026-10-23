import { expect, it } from 'vitest';
import { chatRecognitionCatalog, recognizeChatNameList, recognizeChatShotList, recognizeChatOrderList } from '@/lib/jev-recognition';
import { zUstawieniami } from '../extensions/JevCSAssistant/config.js';
const original = zUstawieniami({}).jev.catalog;
const catalog = chatRecognitionCatalog(original);
it('recognizes M1 as Garand and the full space-separated customer list', () => {
  expect(recognizeChatNameList('M1', catalog)?.map(item => item.name)).toEqual(['M1 Garand']);
  expect(recognizeChatNameList('Lugerr Glock M1 AK Kałasznikow', catalog)?.map(item => item.name))
    .toEqual(['P08 Luger', 'Glock 17', 'M1 Garand', 'Kalashnikov Classic (AK-47)']);
  expect(original.items.find((item: { name: string; aliases?: string[] }) => item.name === 'M1 Garand')?.aliases).not.toContain('M1');
});
it('does not discard quantities, negations, unknown models or alternatives', () => {
  for (const text of ['M1 20 strzałów', 'nie M1', 'M1 albo Glock', 'Glock 18', 'M1 nieznany']) {
    expect(recognizeChatNameList(text, catalog), text).toBeNull();
  }
  expect(recognizeChatNameList('M1 Carbine', catalog)?.map(item => item.name)).toEqual(['M1 Carbine']);
  expect(recognizeChatNameList('Glock 19 M1', catalog)?.map(item => item.name)).toEqual(['Glock 19', 'M1 Garand']);
});
it('rejects colliding aliases and missing catalog entries', () => {
  expect(recognizeChatNameList('M1', chatRecognitionCatalog({ items: [] }))).toBeNull();
  expect(recognizeChatNameList('M1', { items: [...catalog.items, { ...catalog.items[0], id: 'other', name: 'Other', aliases: ['M1'] }] })).toBeNull();
});

it('reads the full explicit English shot list including an adjacent parenthesis', () => {
  const result = recognizeChatShotList('Glock 19X (10 shots) UZI (10 shots) Mauser Kar98k (5 shots) M14 Tactical (5 shots) FN P90(5 shots)', catalog);
  expect(result?.language).toBe('en');
  expect(result?.entries.map(({ item, quantity }) => [item.name, quantity])).toEqual([
    ['Glock 19X', 10], ['UZI', 10], ['Mauser Kar98K', 5], ['M14 Tactical', 5], ['FN P90', 5],
  ]);
});
it('keeps unknown text, alternatives, duplicate products and incomplete quantities for Jev', () => {
  for (const text of ['nie Glock (10 shots)', 'Glock albo UZI (10 shots)', 'Glock (10 shots) dla dwóch osób',
    'Glock (10 shots) UZI', 'Glock (10 shots) Glock (5 shots)', 'Nieznany (10 shots)', 'Glock (0 shots)']) {
    expect(recognizeChatShotList(text, catalog), text).toBeNull();
  }
  expect(recognizeChatShotList('Glock (20 strzałów), UZI (10 strzałów)', catalog)?.entries.map(e => e.quantity)).toEqual([20, 10]);
});

it('recognizes the full customer list with reordered shotgun name and quoted Kalashnikov', () => {
  const text = 'M1 GARAND WINCHESTER SXP SHOTGUN COLT M1911 AK-47 “KALASHNIKOV” MOSIN-NAGANT';
  expect(recognizeChatNameList(text, catalog)?.map(item => item.name)).toEqual([
    'M1 Garand', 'Shotgun (Winchester SXP)', 'Colt 1911 (standard)',
    'Kalashnikov Classic (AK-47)', 'Mosin-Nagant',
  ]);
  expect(recognizeChatNameList('Colt M1911 tactical', catalog)?.map(item => item.name)).toEqual(['Colt 1911 (tactical)']);
  expect(recognizeChatNameList('Mosin–Nagant', catalog)?.map(item => item.name)).toEqual(['Mosin-Nagant']);
  expect(recognizeChatNameList('Winchester SXP unknown', catalog)).toBeNull();
  expect(recognizeChatNameList('AK-74 “KALASHNIKOV”', catalog)).toBeNull();
});
it('keeps new aliases ambiguous when another catalog product claims them', () => {
  const other = { ...catalog.items[0], id: 'different-colt', name: 'Different Colt', aliases: ['Colt M1911'] };
  expect(recognizeChatNameList('Colt M1911', { items: [...catalog.items, other] })).toBeNull();
});

it.each([
  ['M1 GARAND - 100PLN', null],
  ['M1 GARAND - 8 shots - 100PLN', 8],
  ['M1 GARAND', null],
  ['M1 GARAND 8 shots', 8],
  ['M1 GARAND - 8 shots', 8],
  ['M1 GARAND (8 shots) - 100,50 PLN', 8],
])('reads optional shots and quoted prices: %s', (text, quantity) => {
  const result = recognizeChatOrderList(text, catalog);
  expect(result?.entries).toHaveLength(1);
  expect(result?.entries[0].item.name).toBe('M1 Garand');
  expect(result?.entries[0].quantity).toBe(quantity);
});
it('parses annotations within a full mixed list without treating model numbers as quantities', () => {
  const result = recognizeChatOrderList('M1 GARAND - 8 shots - 100PLN WINCHESTER SXP SHOTGUN COLT M1911 - 7 strzałów AK-47 “KALASHNIKOV” - 90 zł MOSIN-NAGANT', catalog);
  expect(result?.entries.map(e => [e.item.name, e.quantity])).toEqual([
    ['M1 Garand', 8], ['Shotgun (Winchester SXP)', null], ['Colt 1911 (standard)', 7],
    ['Kalashnikov Classic (AK-47)', null], ['Mosin-Nagant', null],
  ]);
});
it.each(['M1 GARAND - 100', 'M1 GARAND - 0 shots - 100PLN', 'M1 GARAND - 8 shots - taniej',
  'M1 GARAND - 100PLN rabat 20%', 'M1 GARAND - 100PLN nieznana broń', 'M1 GARAND 8 shots 16 shots',
  'M1 GARAND - 8 shots dla 2 osób'])('does not discard unknown or ambiguous annotations: %s', text => {
  expect(recognizeChatOrderList(text, catalog)).toBeNull();
});

it('recognizes the complete Colt Thompson PPSz M16A1 Bren customer list', () => {
  const result = recognizeChatOrderList('Colt M1911 Thompson PPSZ-41 M16A1 BREN MK3', catalog);
  expect(result?.entries.map(entry => entry.item.name)).toEqual([
    'Colt 1911 (standard)', 'Thompson WW2', 'PPSz-41', 'M16A1', 'Bren MK3',
  ]);
});

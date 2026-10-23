import test from 'node:test';
import assert from 'node:assert/strict';
import { recognitionCatalog, recognizeNameList } from '../core/product-names.js';
import { zUstawieniami } from '../config.js';
const source = zUstawieniami({}).jev.catalog;
const catalog = recognitionCatalog(source);
test('approved typos resolve against catalog without inventing quantities or changing prices', () => {
  const items = recognizeNameList('Luuger\nClock\nAL-47', catalog);
  assert.deepEqual(items.map(item => item.name), ['P08 Luger', 'Glock 17', 'Kalashnikov Classic (AK-47)']);
  for (const item of items) assert.equal(item.priceGrosz, source.items.find(original => original.id === item.id).priceGrosz);
});
test('explicit variants are preserved; aliases and duplicates are case insensitive', () => {
  assert.deepEqual(recognizeNameList('Clock 17; Clock 19; Clock 19X; GLOCK', catalog).map(item => item.name), ['Glock 17', 'Glock 19', 'Glock 19X']);
});
test('quantities, negations, alternative choices and unknown models require contextual analysis', () => {
  for (const input of ['Clock 18', 'Nie chcę Clock', 'Clock lub Luger', 'Clock 20 strzałów', 'Clock\nnieznany', '']) {
    assert.equal(recognizeNameList(input, catalog), null, input);
  }
});
test('missing catalog targets and colliding aliases cannot silently select a replacement', () => {
  assert.equal(recognizeNameList('Luuger', recognitionCatalog({ items: [] })), null);
  const duplicate = { ...catalog, items: [...catalog.items, { id: 'conflict', name: 'Other', aliases: ['Clock'] }] };
  assert.equal(recognizeNameList('Clock', duplicate), null);
  assert.deepEqual(source, zUstawieniami({}).jev.catalog);
});

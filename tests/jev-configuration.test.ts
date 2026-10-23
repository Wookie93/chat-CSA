import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ client: vi.fn(), analyze: vi.fn(), calculate: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getServerClient: mocks.client }));
vi.mock('../extensions/JevCSAssistant/core/orchestrator.js', () => ({ analyzeThread: mocks.analyze, calculateCase: mocks.calculate }));
import { calculateWithJev } from '@/lib/jev-calculator';
beforeEach(() => { mocks.client.mockReset(); mocks.analyze.mockReset(); mocks.calculate.mockReset(); });
it('rejects an empty publication before calling the paid model with a readable 503 error', async () => {
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: { document: {} }, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  await expect(calculateWithJev([{ role: 'user', content: 'Glock 17' }], 'key', new AbortController().signal)).rejects.toMatchObject({ status: 503, message: expect.stringContaining('konfiguracja Jev jest nieprawidłowa') });
  expect(mocks.analyze).not.toHaveBeenCalled();
});
it('prices a fresh names-only list using catalog defaults without paid triage', async () => {
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  const actual = await vi.importActual<typeof import('../extensions/JevCSAssistant/core/orchestrator.js')>('../extensions/JevCSAssistant/core/orchestrator.js');
  mocks.calculate.mockImplementation(actual.calculateCase);
  const result = await calculateWithJev([{ role: 'user', content: 'Luuger\nClock\nAL-47' }], 'key', new AbortController().signal);
  expect(result).toContain('P08 Luger — 7');
  expect(result).toContain('Glock 17 — 10');
  expect(result).toContain('Kalashnikov Classic (AK-47) — 10');
  expect(result).toMatch(/Razem: 300\s*zł/);
  expect(result).not.toMatch(/\d[,.]00\s*zł/);
  expect(result).not.toContain('Podaj liczbę strzałów');
  expect(mocks.analyze).not.toHaveBeenCalled();
});
it('prices the full M1 example with catalog defaults and no language triage', async () => {
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  const actual = await vi.importActual<typeof import('../extensions/JevCSAssistant/core/orchestrator.js')>('../extensions/JevCSAssistant/core/orchestrator.js');
  mocks.calculate.mockImplementation(actual.calculateCase);
  const result = await calculateWithJev([{ role: 'user', content: 'Lugerr Glock M1 AK Kałasznikow' }], 'key', new AbortController().signal);
  expect(result).toContain('M1 Garand');
  expect(result).toContain('Razem:');
  expect(result).not.toContain('wymaga sprawdzenia');
  expect(mocks.analyze).not.toHaveBeenCalled();
});

it.each([
  [{ role: 'user' as const, content: 'Clock\nNieznany produkt' }],
  [{ role: 'user' as const, content: 'Clock' }, { role: 'assistant' as const, content: 'Ile strzałów?' }, { role: 'user' as const, content: 'Luger' }],
])('passes unknown products and existing conversation history to Jev', async (...args) => {
  const messages = args;
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  mocks.analyze.mockRejectedValue(new Error('model reached'));
  await expect(calculateWithJev(messages, 'key', new AbortController().signal)).rejects.toThrow('model reached');
  expect(mocks.analyze.mock.calls[0][0].thread.wiadomosci.map((message: { tekst: string }) => message.tekst)).toEqual(messages.map(message => message.content));
});

it('reports an unapproved catalog instead of asking again for quantities', async () => {
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  mocks.analyze.mockResolvedValue({ matches: [{ status: 'matched', name: 'Glock 17' }], fields: {}, order: { participants: [] }, intents: { quote: true, availability: false } });
  mocks.calculate.mockResolvedValue({ quote: { issues: ['zatwierdzony cennik'] }, issues: [], missing: ['order'] });
  const result = await calculateWithJev([{ role: 'user', content: 'Glock 10 strzałów' }], 'key', new AbortController().signal);
  expect(result).toContain('Cennik Jev nie jest zatwierdzony');
  expect(result).not.toContain('Uzupełnij ilości');
});

it('prices explicit English shots without uncertain language triage or catalog defaults', async () => {
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  const actual = await vi.importActual<typeof import('../extensions/JevCSAssistant/core/orchestrator.js')>('../extensions/JevCSAssistant/core/orchestrator.js');
  mocks.calculate.mockImplementation(actual.calculateCase);
  const result = await calculateWithJev([{ role: 'user', content: 'Glock 19X (10 shots) UZI (10 shots) Mauser Kar98k (5 shots) M14 Tactical (5 shots) FN P90(5 shots)' }], 'key', new AbortController().signal);
  for (const [name, quantity] of [['Glock 19X', 10], ['UZI', 10], ['Mauser Kar98K', 5], ['M14 Tactical', 5], ['FN P90', 5]]) {
    expect(result).toContain(`${name}: ${quantity} shots`);
  }
  expect(result).toContain('Total:');
  expect(result).not.toContain('wymaga');
  expect(result).not.toContain('domyślne');
  expect(mocks.analyze).not.toHaveBeenCalled();
});

it('prices the Garand SXP Colt Kalashnikov Mosin list with catalog shot defaults', async () => {
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  const actual = await vi.importActual<typeof import('../extensions/JevCSAssistant/core/orchestrator.js')>('../extensions/JevCSAssistant/core/orchestrator.js');
  mocks.calculate.mockImplementation(actual.calculateCase);
  const result = await calculateWithJev([{ role: 'user', content: 'M1 GARAND WINCHESTER SXP SHOTGUN COLT M1911 AK-47 “KALASHNIKOV” MOSIN-NAGANT' }], 'key', new AbortController().signal);
  for (const name of ['M1 Garand', 'Shotgun (Winchester SXP)', 'Colt 1911 (standard)', 'Kalashnikov Classic (AK-47)', 'Mosin-Nagant']) expect(result).toContain(name);
  expect(result).toContain('Przyjęto domyślne liczby strzałów z cennika:');
  expect(result).toContain('Razem:');
  expect(result).not.toContain('wymaga sprawdzenia');
  expect(mocks.analyze).not.toHaveBeenCalled();
});

it.each([
  'M1 GARAND - 100PLN', 'M1 GARAND - 8 shots - 100PLN', 'M1 GARAND',
  'M1 GARAND 8 shots', 'M1 GARAND - 8 shots', 'M1 GARAND - 8 shots - 1PLN',
])('prices %s from catalog with explicit or default quantities', async text => {
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  const actual = await vi.importActual<typeof import('../extensions/JevCSAssistant/core/orchestrator.js')>('../extensions/JevCSAssistant/core/orchestrator.js');
  mocks.calculate.mockImplementation(actual.calculateCase);
  const result = await calculateWithJev([{ role: 'user', content: text }], 'key', new AbortController().signal);
  const analysis = mocks.calculate.mock.calls[0][0];
  expect(analysis.order.participants[0].items).toEqual([{ itemId: 'gun-49', quantity: 8 }]);
  const priced = await mocks.calculate.mock.results[0].value;
  expect(priced.quote.lines.find((line: { itemId: string }) => line.itemId === 'gun-49')?.totalGrosz).toBe(10000);
  expect(result).not.toContain('wymaga sprawdzenia');
  if (text.includes('PLN')) expect(result).toContain('Ceny podane w wiadomości pominięto');
  expect(mocks.analyze).not.toHaveBeenCalled();
});
it('prices the full customer list even when only the first product has a quoted price', async () => {
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  const actual = await vi.importActual<typeof import('../extensions/JevCSAssistant/core/orchestrator.js')>('../extensions/JevCSAssistant/core/orchestrator.js');
  mocks.calculate.mockImplementation(actual.calculateCase);
  const result = await calculateWithJev([{ role: 'user', content: 'M1 GARAND - 100PLN WINCHESTER SXP SHOTGUN COLT M1911 AK-47 “KALASHNIKOV” MOSIN-NAGANT' }], 'key', new AbortController().signal);
  expect(mocks.calculate.mock.calls[0][0].order.participants[0].items).toHaveLength(5);
  expect(result).toContain('Razem:');
  expect(result).not.toContain('wymaga sprawdzenia');
  expect(mocks.analyze).not.toHaveBeenCalled();
});

it('quotes the complete Colt Thompson PPSz M16A1 Bren list without model triage', async () => {
  const query = { select: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  const actual = await vi.importActual<typeof import('../extensions/JevCSAssistant/core/orchestrator.js')>('../extensions/JevCSAssistant/core/orchestrator.js');
  mocks.calculate.mockImplementation(actual.calculateCase);
  const result = await calculateWithJev([{ role: 'user', content: 'Colt M1911 Thompson PPSZ-41 M16A1 BREN MK3' }], 'key', new AbortController().signal);
  for (const name of ['Colt 1911 (standard)', 'Thompson WW2', 'PPSz-41', 'M16A1', 'Bren MK3']) expect(result).toContain(name);
  expect(result).toContain('Razem:');
  expect(result).not.toContain('wymaga sprawdzenia');
  expect(mocks.analyze).not.toHaveBeenCalled();
});

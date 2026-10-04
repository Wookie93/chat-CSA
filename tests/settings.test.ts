import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ update: vi.fn(), upsert: vi.fn(), eq: vi.fn(), select: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: () => mocks }) }));
import { updateAppSettings } from '@/lib/supabase';
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-only');
  mocks.update.mockReset().mockReturnValue(mocks);
  mocks.upsert.mockReset().mockResolvedValue({ error: null });
  mocks.eq.mockReset().mockReturnValue(mocks);
  mocks.select.mockReset().mockReturnValue(mocks);
  mocks.maybeSingle.mockReset().mockResolvedValue({ data: { id: 'singleton' }, error: null });
});
it('preserves the existing key without reading or writing it when the field is empty', async () => {
  await updateAppSettings({ openrouter_api_key: '', openrouter_model: 'test/model', system_prompt: 'hello' });
  expect(mocks.update.mock.calls[0][0]).not.toHaveProperty('openrouter_api_key');
  expect(mocks.select).toHaveBeenCalledWith('id');
  expect(mocks.upsert).not.toHaveBeenCalled();
});
it('requires a key when no settings row exists', async () => {
  mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
  await expect(updateAppSettings({ openrouter_api_key: '', openrouter_model: 'test/model', system_prompt: 'hello' })).rejects.toThrow('initial configuration');
});
it('upserts a new key only when explicitly provided', async () => {
  await updateAppSettings({ openrouter_api_key: 'new-key', openrouter_model: 'test/model', system_prompt: 'hello' });
  expect(mocks.upsert.mock.calls[0][0].openrouter_api_key).toBe('new-key');
  expect(mocks.update).not.toHaveBeenCalled();
});

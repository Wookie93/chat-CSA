import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn(), headerList: new Headers(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getAppSettings: mocks.getSettings, updateAppSettings: mocks.updateSettings }));
vi.mock('next/headers', () => ({ headers: async () => mocks.headerList }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/components/admin-settings-form', () => ({ AdminSettingsForm: () => null }));

import { POST as chat } from '@/app/api/chat/route';
import { POST as translate } from '@/app/api/translate/route';
import { GET as synonyms } from '@/app/api/synonyms/route';
import { updateSettings } from '@/lib/actions';
import AdminSettingsPage from '@/app/admin/settings/page';
import { checkMutationOrigin } from '@/lib/access';

const authorization = 'Basic ' + Buffer.from('admin:test-password-at-least-16').toString('base64');
const formData = () => {
  const form = new FormData();
  form.set('openrouter_api_key', '');
  form.set('openrouter_model', 'test/model');
  form.set('system_prompt', 'helpful');
  return form;
};
beforeEach(() => {
  vi.stubEnv('APP_PASSWORD', 'test-password-at-least-16');
  mocks.headerList = new Headers();
  mocks.getSettings.mockReset();
  mocks.updateSettings.mockReset();
});

it('denies direct calls to every API without querying external services', async () => {
  const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
  expect((await chat(new Request('https://app.test/api/chat', { method: 'POST' }))).status).toBe(401);
  expect((await translate(new Request('https://app.test/api/translate', { method: 'POST' }))).status).toBe(401);
  expect((await synonyms(new Request('https://app.test/api/synonyms?word=good'))).status).toBe(401);
  expect(mocks.getSettings).not.toHaveBeenCalled();
  expect(fetchMock).not.toHaveBeenCalled();
});

it('denies settings reads and mutations without authorization', async () => {
  await expect(AdminSettingsPage()).rejects.toThrow('Unauthorized');
  await expect(updateSettings(formData())).rejects.toThrow('Unauthorized');
  expect(mocks.getSettings).not.toHaveBeenCalled();
  expect(mocks.updateSettings).not.toHaveBeenCalled();
});

it('never passes the stored API key to the settings client component', async () => {
  mocks.headerList.set('authorization', authorization);
  mocks.getSettings.mockResolvedValue({ openrouter_api_key: 'secret-value-not-for-client', openrouter_model: 'test/model', system_prompt: 'helpful' });
  const page = await AdminSettingsPage();
  expect(JSON.stringify(page)).not.toContain('secret-value-not-for-client');
  expect(JSON.stringify(page)).toContain('"hasApiKey":true');
});

it('allows saving a model/prompt without sending the stored key back', async () => {
  mocks.headerList.set('authorization', authorization);
  expect(await updateSettings(formData())).toEqual({ success: true });
  expect(mocks.updateSettings).toHaveBeenCalledWith({ openrouter_api_key: '', openrouter_model: 'test/model', system_prompt: 'helpful' });
});

it('rejects cross-origin mutations even when the browser supplies credentials', () => {
  expect(checkMutationOrigin(new Request('https://app.test/api/chat', { headers: { origin: 'https://evil.test' } }))?.status).toBe(403);
  expect(checkMutationOrigin(new Request('https://app.test/api/chat', { headers: { origin: 'https://app.test' } }))).toBeNull();
});

it('validates chat input before querying settings or the provider', async () => {
  const response = await chat(new Request('https://app.test/api/chat', { method: 'POST', headers: { authorization }, body: '{' }));
  expect(response.status).toBe(400);
  expect(mocks.getSettings).not.toHaveBeenCalled();
});

it('queries actual synonyms and keeps an empty result empty', async () => {
  const fetchMock = vi.fn().mockResolvedValue(Response.json([])); vi.stubGlobal('fetch', fetchMock);
  const response = await synonyms(new Request('https://app.test/api/synonyms?word=hello', { headers: { authorization } }));
  expect(fetchMock.mock.calls[0][0]).toContain('rel_syn=hello');
  expect(await response.json()).toEqual({ word: 'hello', synonyms: [] });
});

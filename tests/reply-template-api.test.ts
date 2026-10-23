import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_REPLY_TEMPLATES } from '@/lib/reply-templates';
const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ getServerClient: mocks.client }));
import { GET, PUT } from '@/app/api/reply-templates/route';
const authorization = 'Basic ' + Buffer.from('admin:test-password-at-least-16').toString('base64');
const payload = { templates: DEFAULT_REPLY_TEMPLATES, revision: 1 };
const request = (body: unknown, extra: Record<string, string> = {}) => new Request('https://app.test/api/reply-templates', {
  method: 'PUT', headers: { authorization, 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
});
beforeEach(() => { vi.stubEnv('APP_PASSWORD', 'test-password-at-least-16'); mocks.client.mockReset(); });

it('rejects unauthenticated reads and writes and cross-origin writes', async () => {
  expect((await GET(new Request('https://app.test/api/reply-templates'))).status).toBe(401);
  expect((await PUT(request(payload, { authorization: '' }))).status).toBe(401);
  expect((await PUT(request(payload, { origin: 'https://evil.test' }))).status).toBe(403);
  expect(mocks.client).not.toHaveBeenCalled();
});

it('rejects invalid data and oversized bodies before accessing the database', async () => {
  expect((await PUT(request({ ...payload, templates: [{ id: 'a', title: '', content: 'x' }] }))).status).toBe(400);
  expect((await PUT(request({ ...payload, revision: 0 }))).status).toBe(400);
  expect((await PUT(request(payload, { 'content-length': '10000001' }))).status).toBe(413);
  expect(mocks.client).not.toHaveBeenCalled();
});

it('uses an atomic revision filter and reports conflicting writes', async () => {
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) };
  mocks.client.mockReturnValue({ from: () => query });
  expect((await PUT(request(payload))).status).toBe(409);
  expect(query.eq).toHaveBeenCalledWith('revision', 1);
  expect(query.eq).toHaveBeenCalledWith('category', 'emails');
  expect(query.update).toHaveBeenCalledWith({ templates: DEFAULT_REPLY_TEMPLATES, revision: 2 });
  query.maybeSingle.mockResolvedValue({ data: { ...payload, revision: 2 }, error: null });
  const response = await PUT(request(payload));
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect((await response.json()).revision).toBe(2);
});

it('does not expose database errors to the browser', async () => {
  mocks.client.mockImplementation(() => { throw new Error('private database connection information'); });
  const response = await GET(new Request('https://app.test/api/reply-templates', { headers: { authorization } }));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private database');
});


it('rejects unknown categories before accessing the database', async () => {
  const response = await GET(new Request('https://app.test/api/reply-templates?category=unknown', { headers: { authorization } }));
  expect(response.status).toBe(400);
  expect((await PUT(request({ ...payload, category: 'unknown' }))).status).toBe(400);
  expect(mocks.client).not.toHaveBeenCalled();
});

it('reads and updates only the requested library, with independent revisions', async () => {
  const libraries = {
    emails: { ...payload, category: 'emails' },
    google_reviews: { category: 'google_reviews', templates: [], revision: 1 },
  };
  let filters: Record<string, unknown> = {};
  let update: object | undefined;
  const finish = async () => {
    const library = libraries[filters.category as keyof typeof libraries];
    if (!library || (filters.revision !== undefined && filters.revision !== library.revision)) return { data: null, error: null };
    if (update) Object.assign(library, update);
    return { data: library, error: null };
  };
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn((key, value) => { filters[key] = value; return query; }),
    update: vi.fn((value) => { update = value; return query; }),
    single: finish, maybeSingle: finish,
  };
  mocks.client.mockReturnValue({ from: () => { filters = {}; update = undefined; return query; } });
  const response = await GET(new Request('https://app.test/api/reply-templates?category=google_reviews', { headers: { authorization } }));
  expect(await response.json()).toEqual(libraries.google_reviews);
  const templates = [{ id: 'thanks', title: 'Podziękowanie', content: 'Dziękujemy za opinię!' }];
  const saved = await PUT(request({ category: 'google_reviews', templates, revision: 1 }));
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ category: 'google_reviews', templates, revision: 2 });
  expect(libraries.emails).toEqual({ ...payload, category: 'emails' });
  // A write to emails still accepts its own revision 1.
  expect((await PUT(request(payload))).status).toBe(200);
  expect((await PUT(request({ category: 'google_reviews', templates, revision: 1 }))).status).toBe(409);
});

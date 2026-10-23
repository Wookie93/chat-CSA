import { checkAppAccess, checkMutationOrigin } from '@/lib/access';
import { getServerClient } from '@/lib/supabase';
import { replyLibrarySchema, replyTemplateCategorySchema } from '@/lib/reply-templates';
import { readJsonBody, RequestError } from '@/lib/request-limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET(request: Request) {
  const denied = checkAppAccess(request.headers.get('authorization'));
  if (denied) return denied;
  const category = replyTemplateCategorySchema.safeParse(new URL(request.url).searchParams.get('category') ?? 'emails');
  if (!category.success) return Response.json({ error: 'Nieprawidłowa kategoria wzorców.' }, { status: 400, headers });
  try {
    const { data, error } = await getServerClient().from('reply_template_library')
      .select('category,templates,revision').eq('id', true).eq('category', category.data).single();
    if (error) throw error;
    return Response.json(replyLibrarySchema.parse(data), { headers });
  } catch {
    return Response.json({ error: 'Nie udało się pobrać biblioteki z Supabase. Spróbuj ponownie.' }, { status: 503, headers });
  }
}

export async function PUT(request: Request) {
  const denied = checkAppAccess(request.headers.get('authorization')) ?? checkMutationOrigin(request);
  if (denied) return denied;
  try {
    const parsed = replyLibrarySchema.safeParse(await readJsonBody(request, 10000000));
    if (!parsed.success) return Response.json({ error: 'Nieprawidłowe wzorce (maksymalnie 100).' }, { status: 400, headers });
    const { category, templates, revision } = parsed.data;
    // Compare-and-swap prevents one device from silently replacing another device's edits.
    const { data, error } = await getServerClient().from('reply_template_library')
      .update({ templates, revision: revision + 1 }).eq('id', true).eq('revision', revision)
      .eq('category', category).select('category,templates,revision').maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: 'Biblioteka została zmieniona na innym urządzeniu. Odśwież ją i ponów zmianę.' }, { status: 409, headers });
    return Response.json(replyLibrarySchema.parse(data), { headers });
  } catch (error) {
    return Response.json({ error: error instanceof RequestError ? error.message : 'Nie udało się zapisać wzorców w Supabase. Twoje zmiany pozostają w formularzu.' }, {
      status: error instanceof RequestError ? error.status : 503, headers,
    });
  }
}

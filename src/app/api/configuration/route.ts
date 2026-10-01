import { timingSafeEqual } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { validateConfiguration } from '../../../../extensions/JevCSAssistant/central/schema.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  const expected=process.env.CONFIG_READ_TOKEN;
  if (!expected || expected.length < 32) return new Response('Configuration service unavailable', {status:503});
  const received=req.headers.get('authorization') || '';
  const a=Buffer.from(received), b=Buffer.from(`Bearer ${expected}`);
  if (a.length!==b.length || !timingSafeEqual(a,b)) return new Response('Unauthorized', {status:401});
  try {
    const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error}=await db.from('shared_configuration').select('document').order('revision',{ascending:false}).limit(1).maybeSingle();
    if(error) throw error;
    if(!data) return new Response('No published configuration', {status:404});
    const document=validateConfiguration(data.document);
    return Response.json(document,{headers:{'Cache-Control':'no-store'}});
  } catch { return new Response('Configuration service unavailable',{status:503}); }
}

import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { validateConfiguration } from '../extensions/JevCSAssistant/central/schema.mjs';
const file=process.argv[2];
if (!file) throw new Error('Usage: node --env-file=.env.local scripts/publish-configuration.mjs configuration.json [--check]');
const document=validateConfiguration(JSON.parse(await readFile(file,'utf8')));
if (process.argv.includes('--check')) {
  console.log(`Poprawna konfiguracja, wersja ${document.revision}. Nic nie opublikowano.`);
} else {
  const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.from('shared_configuration').select('revision').order('revision',{ascending:false}).limit(1).maybeSingle();
  if(error) throw new Error('Nie udało się odczytać wersji. Sprawdź migrację i dostęp do Supabase.');
  if(document.revision !== (data?.revision || 0)+1) throw new Error(`Wymagana kolejna wersja: ${(data?.revision || 0)+1}.`);
  const {error:writeError}=await db.from('shared_configuration').insert({revision:document.revision,document:{...document,publishedAt:new Date().toISOString()}});
  if(writeError) throw new Error('Publikacja nie powiodła się. Sprawdź, czy inna osoba nie opublikowała tej wersji.');
  console.log(`Opublikowano wersję ${document.revision}.`);
}

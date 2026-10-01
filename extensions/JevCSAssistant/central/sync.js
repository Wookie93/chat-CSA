import { configurationUrl, validateConfiguration, MAX_BYTES, canonical } from './schema.mjs';
export async function fetchConfiguration(connection, previous, fetchImpl=fetch) {
  const url=configurationUrl(connection.url);
  if (typeof connection.token!=='string' || connection.token.length<32 || /[\r\n]/.test(connection.token)) throw new Error('Token odczytu musi mieć co najmniej 32 znaki.');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try {
    const response=await fetchImpl(url,{headers:{Authorization:`Bearer ${connection.token}`},signal:controller.signal,redirect:'error',credentials:'omit',cache:'no-store'});
    if (!response.ok) throw new Error(`Nie udało się pobrać konfiguracji (HTTP ${response.status}).`);
    if (!response.body) throw new Error('Pusta odpowiedź konfiguracji.');
    const reader=response.body.getReader();const chunks=[];let size=0;
    while(true) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new Error('Konfiguracja przekracza 512 kB.');}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    const document=validateConfiguration(JSON.parse(new TextDecoder().decode(bytes)));
    if (previous?.source===url) {
      if (document.revision<previous.document.revision) throw new Error('Serwer zwrócił starszą wersję konfiguracji.');
      if (document.revision===previous.document.revision && canonical(document)!==canonical(previous.document)) throw new Error('Treść opublikowanej wersji uległa zmianie.');
    }
    return {source:url,document,checkedAt:new Date().toISOString()};
  } finally {clearTimeout(timer);}
}

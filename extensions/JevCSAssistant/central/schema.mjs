import { validateCatalog } from '../catalog/catalog.js';
export const MAX_BYTES = 512000;
function object(v, keys) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) throw new Error('Nieznane pola konfiguracji.');
}
export function validateConfiguration(v) {
  object(v, ['schemaVersion','revision','publishedAt','catalog','templates','availabilityPolicy','replyTemplates']);
  if (v.schemaVersion !== 1 || !Number.isSafeInteger(v.revision) || v.revision < 1 || typeof v.publishedAt !== 'string' || !Number.isFinite(Date.parse(v.publishedAt))) throw new Error('Nieprawidłowa wersja konfiguracji.');
  if (new TextEncoder().encode(JSON.stringify(v)).length > MAX_BYTES) throw new Error('Konfiguracja przekracza 512 kB.');
  object(v.catalog, ['version','currency','approved','items','durationRule','serviceFeeGrosz']);
  if (!Array.isArray(v.catalog.items)) throw new Error('Brak katalogu.');
  for (const item of v.catalog.items) object(item, ['id','name','unit','priceGrosz','quantities','baseQuantity','aliases','durationMin','exclusiveWith']);
  validateCatalog(v.catalog);
  object(v.templates, ['pl','en']);
  for (const lang of ['pl','en']) {
    const t = v.templates[lang];
    if (typeof t !== 'string' || !t.trim() || t.length > 20000 || ['wycena','dostepnosc','pytania'].some(k => !t.includes('{{'+k+'}}')) || [...t.matchAll(/\{\{([^{}]+)\}\}/g)].some(m => !['wycena','dostepnosc','pytania'].includes(m[1]))) throw new Error('Nieprawidłowy wzorzec '+lang+'.');
  }
  object(v.availabilityPolicy, ['staffing','proposals','allowFinishAfterClosing']);
  const p=v.availabilityPolicy;
  if (!['unconfirmed','free','total'].includes(p.staffing) || !['unconfirmed','nonOverlapping','everyHour'].includes(p.proposals) || typeof p.allowFinishAfterClosing !== 'boolean') throw new Error('Nieprawidłowe reguły dostępności.');
  if (!Array.isArray(v.replyTemplates) || v.replyTemplates.length > 200) throw new Error('Nieprawidłowa biblioteka wzorców.');
  const ids=new Set();
  for (const t of v.replyTemplates) {
    object(t, ['id','nazwa','tagi','tresc','format','zmieniono']);
    if (typeof t.id !== 'string' || !t.id || t.id.length>100 || ids.has(t.id) || typeof t.nazwa !== 'string' || !t.nazwa.trim() || t.nazwa.length>200 || typeof t.tresc !== 'string' || !t.tresc.trim() || t.tresc.length>20000 || !['html','text'].includes(t.format) || !Number.isSafeInteger(t.zmieniono) || t.zmieniono<0 || !Array.isArray(t.tagi) || t.tagi.length>30 || t.tagi.some(x=>typeof x!=='string'||x.length>100)) throw new Error('Nieprawidłowy wpis biblioteki wzorców.');
    ids.add(t.id);
  }
  return v;
}
export function activeConfiguration(saved) {
  const c=saved.centralConnection, cache=saved.centralCache;
  if (!c?.enabled || !cache || cache.source !== c.url) return null;
  return validateConfiguration(cache.document);
}
export function configurationUrl(value) {
  const u=new URL(value);
  if (u.username || u.password || u.search || u.hash || u.pathname !== '/api/configuration' || (u.protocol!=='https:' && !(u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname)))) throw new Error('Podaj HTTPS /api/configuration (HTTP tylko dla localhost).');
  return u.href;
}

export function canonical(value) {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value && typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export function configurationStamp(settings) {
  const c=activeConfiguration(settings);
  return c ? settings.centralConnection.url+'#'+c.revision : 'local';
}

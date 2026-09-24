import { normalizujWzorce } from './logic.js';
import { activeConfiguration, configurationUrl, validateConfiguration } from './central/schema.mjs';
import { fetchConfiguration } from './central/sync.js';
import { validateCatalog } from './catalog/catalog.js';
import { DEFAULT_TEMPLATES } from './templates/render.js';
// options.js — klucz API, prywatny link iCal (sekret), modele i prompty per funkcja,
// ustawienia trybu semi-auto oraz narzędzie diagnostyczne fetcha/parsera iCal.

import { DOMYSLNE_USTAWIENIA, zUstawieniami, KLUCZE_USTAWIEN } from './config.js';

const $ = (id) => document.getElementById(id);

function status(tekst, zle = false) {
  const el = $('statusZapisu');
  el.textContent = tekst;
  el.style.color = zle ? 'var(--blad)' : 'var(--ok)';
  clearTimeout(status._t);
  status._t = setTimeout(() => { el.textContent = ''; }, 4000);
}

async function wczytaj() {
  const u = zUstawieniami(await chrome.storage.local.get(KLUCZE_USTAWIEN));
  const central=activeConfiguration(u);
  $('centralUrl').value=u.centralConnection.url || 'https://chat-csa.vercel.app/api/configuration';
  $('centralStatus').textContent=central ? `Wersja ${central.revision}, opublikowano ${central.publishedAt}. Ostatnio pobrano: ${u.centralCache.checkedAt}.` : 'Korzystasz z lokalnej konfiguracji.';
  for (const id of ['jevCatalog','jevTemplatePl','jevTemplateEn','jevStaffing','jevProposals','jevLateFinish','jevImport']) $(id).disabled=!!central;
  $('jevModel').value = u.jev.model;
  $('jevThreshold').value = u.jev.threshold;
  $('jevShadow').checked = u.jev.shadow;
  $('jevStaffing').value=u.jev.availabilityPolicy?.staffing || 'unconfirmed';
  $('jevProposals').value=u.jev.availabilityPolicy?.proposals || 'unconfirmed';
  $('jevLateFinish').checked=!!u.jev.availabilityPolicy?.allowFinishAfterClosing;
  $('jevCatalog').value = JSON.stringify(u.jev.catalog, null, 2);
  $('jevTemplatePl').value = u.jev.templates.pl;
  $('jevTemplateEn').value = u.jev.templates.en;
  $('apiKey').value = u.apiKey;
  $('icalUrl').value = u.icalUrl;
  for (const f of ['pakiet', 'tlumacz', 'semiauto']) {
    $(`model-${f}`).value = u.modele[f];
    $(`prompt-${f}`).value = u.prompty[f];
  }
  $('pomijajPolskie').checked = !!u.tlumacz.pomijajPolskie;
  $('semiWlaczony').checked = !!u.semiauto.wlaczony;
  $('semiInterwal').value = u.semiauto.interwalMin;
  $('semiMax').value = u.semiauto.maxWatkowNaCykl;
  $('semiEtykieta').value = u.semiauto.etykieta;
  $('semiZapytanie').value = u.semiauto.zapytanieGmail;
  $('icalCache').value = u.icalCacheSek;
  $('naZywoWlaczona').checked = !!u.naZywo.wlaczona;
  $('naZywoCache').value = u.naZywo.cacheSek;
}

async function zapisz() {
  const raw = await chrome.storage.local.get(KLUCZE_USTAWIEN);
  const u = zUstawieniami(raw);
  const local = zUstawieniami({...raw, centralConnection:{enabled:false}});
  const managed = !!activeConfiguration(raw);
  const icalUrl = $('icalUrl').value.trim();
  if (icalUrl && !/^(https?|webcal):\/\//i.test(icalUrl)) {
    return status('Link iCal musi zaczynać się od https:// lub webcal://', true);
  }
  const interwal = Math.min(10, Math.max(5, Number($('semiInterwal').value) || 7));

  let catalog;
  try { catalog = validateCatalog(JSON.parse($('jevCatalog').value)); }
  catch (e) { return status(e.message, true); }
  const threshold = Number($('jevThreshold').value);
  if (!Number.isFinite(threshold) || threshold < 0.5 || threshold > 1) return status('Próg pewności: 0,5–1.', true);
  const templates = { pl: $('jevTemplatePl').value, en: $('jevTemplateEn').value };
  for (const text of Object.values(templates)) {
    if (!text.trim() || text.length > 20000 || ['wycena','dostepnosc','pytania'].some(k => !text.includes(`{{${k}}}`)) ||
      [...text.matchAll(/\{\{([^{}]+)\}\}/g)].some(m => !['wycena','dostepnosc','pytania'].includes(m[1]))) return status('Wzorzec musi zawierać wyłącznie znane zmienne i wszystkie trzy bloki.', true);
  }
  await chrome.storage.local.set({
    jev: { ...u.jev, model: $('jevModel').value.trim() || DOMYSLNE_USTAWIENIA.jev.model, threshold,
      shadow: $('jevShadow').checked, catalog:managed?local.jev.catalog:catalog, templates:managed?local.jev.templates:templates, availabilityPolicy:managed?local.jev.availabilityPolicy:{ staffing: $('jevStaffing').value, proposals: $('jevProposals').value, allowFinishAfterClosing: $('jevLateFinish').checked } },
    apiKey: $('apiKey').value.trim(),
    icalUrl,
    modele: {
      ...u.modele,
      pakiet: $('model-pakiet').value.trim() || DOMYSLNE_USTAWIENIA.modele.pakiet,
      tlumacz: $('model-tlumacz').value.trim() || DOMYSLNE_USTAWIENIA.modele.tlumacz,
      semiauto: $('model-semiauto').value.trim() || DOMYSLNE_USTAWIENIA.modele.semiauto,
    },
    prompty: {
      ...u.prompty,
      pakiet: $('prompt-pakiet').value,
      tlumacz: $('prompt-tlumacz').value,
      semiauto: $('prompt-semiauto').value,
    },
    tlumacz: { ...u.tlumacz, pomijajPolskie: $('pomijajPolskie').checked },
    semiauto: {
      ...u.semiauto,
      wlaczony: $('semiWlaczony').checked,
      interwalMin: interwal,
      maxWatkowNaCykl: Math.min(10, Math.max(1, Number($('semiMax').value) || 3)),
      etykieta: $('semiEtykieta').value.trim(),
      zapytanieGmail: $('semiZapytanie').value.trim() || DOMYSLNE_USTAWIENIA.semiauto.zapytanieGmail,
    },
    icalCacheSek: Math.min(86400, Math.max(0, Number($('icalCache').value) || 0)),
    naZywo: {
      ...u.naZywo,
      wlaczona: $('naZywoWlaczona').checked,
      cacheSek: Math.min(3600, Math.max(0, Number($('naZywoCache').value) || 0)),
    },
  });
  $('semiInterwal').value = interwal;
  status('Zapisano.');
}

/* Maskowanie sekretów */
for (const btn of document.querySelectorAll('[data-pokaz]')) {
  btn.addEventListener('click', () => {
    const pole = $(btn.dataset.pokaz);
    const pokazane = pole.type === 'text';
    pole.type = pokazane ? 'password' : 'text';
    btn.textContent = pokazane ? 'Pokaż' : 'Ukryj';
  });
}

/* Przywracanie domyślnych promptów */
for (const btn of document.querySelectorAll('[data-reset]')) {
  btn.addEventListener('click', () => {
    const f = btn.dataset.reset;
    $(`prompt-${f}`).value = DOMYSLNE_USTAWIENIA.prompty[f];
    status('Przywrócono domyślny prompt — pamiętaj o zapisaniu.');
  });
}

/* Diagnostyka iCal (narzędzie dev — zastępuje dawną diagnostykę DOM-u Kalendarza) */
$('testIcal').addEventListener('click', async (e) => {
  const btn = e.target;
  const wynik = $('wynikIcal');
  const url = $('icalUrl').value.trim();
  if (!url) { status('Najpierw wklej link iCal.', true); return; }

  btn.disabled = true;
  btn.textContent = 'Testuję…';
  try {
    await chrome.storage.local.set({ icalUrl: url });
    const odp = await chrome.runtime.sendMessage({ typ: 'ICAL_DIAGNOSTYKA' });
    wynik.classList.remove('ukryty');
    if (!odp?.ok) {
      wynik.classList.add('blad');
      wynik.textContent = odp?.blad || 'Nie udało się pobrać kalendarza.';
    } else {
      const r = odp.raport;
      wynik.classList.remove('blad');
      wynik.textContent = [
        `Pobrano ${(r.bajtow / 1024 / 1024).toFixed(1)} MB, ${r.eventow} wydarzeń w pliku; ${r.wOknie} w oknie (${r.odDzisiaj} od dzisiaj).`,
        `W oknie — cykliczne (nierozwijane): ${r.cykliczne}. Całodniowe: ${r.calodniowe}. Bez jawnej strefy: ${r.bezStrefy}.`,
        r.obsady
          ? `Wydarzeń z obsadą instruktorów (tytuł numeryczny): ${r.obsady}.`
          : 'UWAGA: w oknie nie ma ANI JEDNEGO wydarzenia z obsadą (tytuł numeryczny, np. "4"). Bez nich dostępność zawsze wyjdzie "brak miejsc" — sprawdź, czy kalendarz na pewno je zawiera.',
        `Cache: ${r.wOknieCache} wydarzeń z okna −${r.oknoDni[0]}/+${r.oknoDni[1]} dni, ${Math.round(r.bajtowCache / 1024)} kB` +
          `${r.cacheZapisany ? '' : ' — za duże, cache wyłączony (każde sprawdzenie pobierze kalendarz na nowo)'}.`,
        '',
        'Najbliższe wydarzenia:',
        ...r.probka.map((p) => `  ${new Date(p.start).toLocaleString('pl-PL')} – ${new Date(p.end).toLocaleTimeString('pl-PL')}  ${p.tytul}${p.cykliczne ? '  [RRULE]' : ''}`),
      ].join('\n');
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Testuj link iCal (diagnostyka)';
  }
});

$('zapisz').addEventListener('click', () => zapisz().catch(e => status(e.message, true)));
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); zapisz(); }
});

wczytaj();

$('jevExport').addEventListener('click', async () => {
  try {
    const u = zUstawieniami(await chrome.storage.local.get(KLUCZE_USTAWIEN));
    // Explicit allowlist: historical prompts may contain personal data or secrets.
    const data = { schemaVersion: 1, jev: u.jev, modele: u.modele, semiauto: { ...u.semiauto, wlaczony: false } };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'JevCSAssistant-settings.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { status(e.message, true); }
});
$('jevImport').addEventListener('change', async e => {
  try {
    const file = e.target.files[0]; if (!file) return;
    if (file.size > 200000) throw new Error('Za duży plik ustawień.');
    const data = JSON.parse(await file.text());
    if (data.schemaVersion !== 1 || !data.jev) throw new Error('Nieobsługiwana wersja eksportu.');
    validateCatalog(data.jev.catalog);
    $('jevCatalog').value = JSON.stringify(data.jev.catalog, null, 2);
    $('jevModel').value = data.jev.model || DOMYSLNE_USTAWIENIA.jev.model;
    $('jevThreshold').value = data.jev.threshold ?? 0.85;
    $('jevShadow').checked = true;
    $('jevStaffing').value=data.jev.availabilityPolicy?.staffing || 'unconfirmed';
    $('jevProposals').value=data.jev.availabilityPolicy?.proposals || 'unconfirmed';
    $('jevLateFinish').checked=!!data.jev.availabilityPolicy?.allowFinishAfterClosing;
    $('semiWlaczony').checked = false;
    $('jevTemplatePl').value = data.jev.templates?.pl || DEFAULT_TEMPLATES.pl;
    $('jevTemplateEn').value = data.jev.templates?.en || DEFAULT_TEMPLATES.en;
    status('Wczytano konfigurację Jev do formularza. Sprawdź i zapisz. Automaty wyłączone.');
  } catch (err) { status(err.message, true); }
});

$('jevTest').addEventListener('click',async e=>{
  e.target.disabled=true;$('jevTestResult').textContent='Sprawdzam połączenie na krótkim przykładzie testowym…';
  try{const r=await chrome.runtime.sendMessage({typ:'JEV_TEST'});if(!r?.ok)throw new Error(r?.blad||'Brak odpowiedzi.');
    $('jevTestResult').textContent=`Połączenie działa. Model: ${r.metrics.model}; czas: ${r.metrics.ms} ms; koszt: ${r.metrics.costUsd===null?'nieznany':r.metrics.costUsd+' USD'}.`;
  }catch(err){$('jevTestResult').textContent=err.message;}finally{e.target.disabled=false;}
});

$('centralDownload').addEventListener('click', async () => {
  const button=$('centralDownload');button.disabled=true;
  try {
    const url=configurationUrl($('centralUrl').value.trim());
    const origin=new URL(url).origin+'/*';
    const allowed=chrome.runtime.getManifest().optional_host_permissions || [];
    if(!allowed.includes(origin)) throw new Error('Ta domena nie jest skonfigurowana w rozszerzeniu. Dodaj dokładny adres aplikacji do optional_host_permissions.');
    if(!await chrome.permissions.request({origins:[origin]})) throw new Error('Nie udzielono dostępu do aplikacji.');
    const {centralCache}=await chrome.storage.local.get('centralCache');
    const cache=await fetchConfiguration({url,token:$('centralToken').value.trim()},centralCache);
    await chrome.storage.local.set({centralConnection:{enabled:true,url},centralCache:cache});
    $('centralToken').value='';
    await wczytaj();status('Zastosowano konfigurację centralną.');
  } catch(e) { $('centralStatus').textContent=e.message+' Dotychczasowa konfiguracja pozostaje aktywna.'; }
  finally {button.disabled=false;}
});
$('centralDisconnect').addEventListener('click', async()=>{
  const {centralConnection:c}=await chrome.storage.local.get('centralConnection');
  await chrome.storage.local.set({centralConnection:{...c,enabled:false}});
  await wczytaj();status('Przywrócono lokalne ustawienia i wzorce.');
});
$('centralExport').addEventListener('click',async()=>{
  try {
    const raw=await chrome.storage.local.get([...KLUCZE_USTAWIEN,'wzorce']);
    const u=zUstawieniami(raw), central=activeConfiguration(raw);
    const replyTemplates=central?.replyTemplates || normalizujWzorce(raw.wzorce || []);
    const document=validateConfiguration({schemaVersion:1,revision:(central?.revision || 0)+1,publishedAt:new Date().toISOString(),catalog:u.jev.catalog,templates:u.jev.templates,availabilityPolicy:u.jev.availabilityPolicy,replyTemplates});
    const url=URL.createObjectURL(new Blob([JSON.stringify(document,null,2)],{type:'application/json'}));
    const a=window.document.createElement('a');
    a.href=url;a.download='configuration.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    status('Wyeksportowano zapisane ustawienia. Sprawdź treść przed publikacją.');
  }catch(e){status(e.message,true);}
});

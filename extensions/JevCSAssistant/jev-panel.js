import { CSA_CATALOG } from './catalog/csa-catalog.js';
import { zUstawieniami, KLUCZE_USTAWIEN } from './config.js';
// New flow uses the existing panel's visual language; all user/model text uses textContent.
const $ = id => document.getElementById(id);
let catalogItems = CSA_CATALOG.items;
let current = null;
let dirty = false;
let working = false;
let sourceTab = null;
const show = text => { $('jevStatus').textContent = text; };
async function busy(fn) {
  if (working) return;
  working = true;
  const inputs = [...document.querySelectorAll('#panel-jev input, #panel-jev textarea, #panel-jev select, #jevParticipants button')];
  for (const el of inputs) el.disabled = true;
  for (const id of ['jevRead','jevAnalyze','jevRecalculate','jevDraft','jevRedact']) $(id).disabled = true;
  try { await fn(); } catch (e) { show(e.message); }
  finally {
    working = false;
    for (const el of inputs) el.disabled = false;
    for (const id of ['jevRead','jevAnalyze','jevRecalculate']) $(id).disabled = false;
    $('jevDraft').disabled = !current?.draft || !sourceTab || dirty;
    $('jevRedact').disabled = !current?.draft || dirty;
  }
}
function display(c) {
  current = c; dirty = false;
  $('jevOrder').value = JSON.stringify(c.order, null, 2);
  displayOrder(c.order);
  $('jevReply').value = c.draft?.text || '';
  const issues = [...c.issues, ...c.missing.map(x => `Brak: ${{people:'liczba osób',date:'pełna data',time:'godzina',duration:'czas wizyty',order:'kompletne zamówienie'}[x] || x}`)];
  const costKnown = c.metrics.filter(m => m.calls).every(m => m.costUsd !== null);
  const cost = costKnown ? c.metrics.reduce((s,m) => s + (m.costUsd || 0), 0).toFixed(6) + ' USD' : 'nieznany';
  show(`${c.needsReview ? 'Wymaga sprawdzenia. ' : 'Analiza gotowa. '}${issues.join('; ')}\nKoszt Jev: ${cost}`);
  $('jevDetails').textContent = JSON.stringify({ intents: c.intents, fields: c.fields, quote: c.quote, availability: c.availability, metrics: c.metrics }, null, 2);
}
let thread = null;
$('jevRead').addEventListener('click', () => busy(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/mail\.google\.com\//.test(tab.url || '')) throw new Error('Wybierz kartę Gmaila z otwartym wątkiem.');
  const r = await chrome.tabs.sendMessage(tab.id, { typ: 'ODCZYTAJ_WATEK' });
  if (!r?.ok) throw new Error(r?.blad || 'Nie udało się odczytać wątku.');
  thread = r.dane; sourceTab = tab.id; current = null;
  $('jevReply').value = ''; $('jevOrder').value = ''; $('jevParticipants').replaceChildren(); $('jevDetails').textContent = '';
  $('jevInput').value = thread.wiadomosci.map(m => m.tekst).join('\n\n');
  show('Wątek wczytany. Kliknij Analizuj.');
}));
$('jevInput').addEventListener('input', () => { thread = null; sourceTab = null; current = null; $('jevDraft').disabled = true; });
$('jevAnalyze').addEventListener('click', () => busy(async () => {
  catalogItems = zUstawieniami(await chrome.storage.local.get(KLUCZE_USTAWIEN)).jev.catalog.items;
  show('Jev analizuje wiadomość i uruchamia narzędzia…');
  current = null;
  const r = await chrome.runtime.sendMessage({ typ: 'JEV_ANALYZE', thread: thread || { wiadomosci: [{ tekst: $('jevInput').value }] } });
  if (!r?.ok) throw new Error(r?.blad || 'Błąd analizy.');
  display(r.result);
}));
$('jevOrder').addEventListener('input', () => { dirty = true; $('jevRedact').disabled = true; $('jevDraft').disabled = true; $('jevReply').value = ''; });
$('jevRecalculate').addEventListener('click', () => busy(async () => {
  if (!current) throw new Error('Najpierw przeanalizuj wiadomość.');
  const changed = structuredClone(current);
  changed.order = JSON.parse($('jevOrder').value);
  if(changed.order.durationMin !== current.order.durationMin) changed.order.durationSource='operator';
  // Manual edits can supply a missing date/duration/order but do not silently clear triage warnings.
  if (changed.order.time !== current.order.time) changed.fields.time = { value: changed.order.time, status: 'known', source: 'operator' };
  show('Przeliczam dane i sprawdzam termin…');
  const r = await chrome.runtime.sendMessage({ typ: 'JEV_RECALCULATE', case: changed });
  if (!r?.ok) throw new Error(r?.blad || 'Błąd przeliczenia.');
  display(r.result);
}));
$('jevDraft').addEventListener('click', () => busy(async () => {
  if (!current?.draft || !sourceTab || dirty) throw new Error('Wczytaj i przeanalizuj aktualny wątek Gmaila.');
  const r = await chrome.runtime.sendMessage({ typ: 'JEV_SAVE_DRAFT', tabId: sourceTab, threadId: current.threadId, messageId: current.lastMessageId, text: $('jevReply').value, snapshot: current.snapshot, configurationStamp: current.configurationStamp });
  if (!r?.ok) throw new Error(r?.blad || 'Nie potwierdzono wstawienia draftu. Sprawdź Gmail przed ponowieniem.');
  show('Wstawiono draft. Sprawdź treść i zapis w Gmailu.');
  sourceTab = null;
}));

$('jevRedact').addEventListener('click', () => busy(async () => {
  if (!current?.draft || dirty) throw new Error('Najpierw przygotuj poprawną odpowiedź.');
  const r = await chrome.runtime.sendMessage({ typ: 'JEV_REDACT', text: $('jevReply').value, language: current.language });
  if (!r?.ok) throw new Error(r?.blad || 'Błąd LLM. Pozostawiono wzorzec.');
  $('jevReply').value = r.text;
  show('LLM dodał tekst powitania i zakończenia. Sprawdź odpowiedź przed wstawieniem.');
}));

function markDirty(order) {
  dirty = true;
  $('jevDraft').disabled = true; $('jevRedact').disabled = true;
  $('jevReply').value = '';
  $('jevOrder').value = JSON.stringify(order, null, 2);
}
function displayOrder(order) {
  $('jevDate').value = order.date || '';
  $('jevTime').value = order.time || '';
  $('jevPeople').value = order.people || '';
  $('jevDuration').value = order.durationMin || '';
  const host = $('jevParticipants'); host.replaceChildren();
  for (const person of order.participants) {
    const section = document.createElement('fieldset');
    const legend = document.createElement('legend'); legend.textContent = `Osoba ${person.id}`; section.append(legend);
    for (const [index,item] of person.items.entries()) {
      const row = document.createElement('div'); row.className='rzad';
      const label = document.createElement('label'); label.textContent = catalogItems.find(i=>i.id===item.itemId)?.name || item.itemId;
      const input = document.createElement('input'); input.type='number'; input.min='1'; input.value=item.quantity;
      input.addEventListener('input', () => { const o=JSON.parse($('jevOrder').value); o.participants.find(p=>p.id===person.id).items[index].quantity=Number(input.value); markDirty(o); });
      label.append(input);row.append(label);
      const remove=document.createElement('button');remove.textContent='Usuń';remove.className='wtorny';
      remove.addEventListener('click',()=>{const o=JSON.parse($('jevOrder').value);o.participants.find(p=>p.id===person.id).items.splice(index,1);markDirty(o);displayOrder(o);});
      row.append(remove);section.append(row);
    }
    const completeLabel=document.createElement('label');
    const complete=document.createElement('input');complete.type='checkbox';complete.checked=person.complete;
    complete.addEventListener('change',()=>{const o=JSON.parse($('jevOrder').value);o.participants.find(p=>p.id===person.id).complete=complete.checked;markDirty(o);});
    completeLabel.append(complete,document.createTextNode(' Pełny wybór uczestnika został sprawdzony'));section.append(completeLabel);
    const add=document.createElement('button');add.className='wtorny';add.textContent='Dodaj pozycję z katalogu';
    add.addEventListener('click',async()=>{
      try {
        const u=zUstawieniami(await chrome.storage.local.get(KLUCZE_USTAWIEN));
        const select=document.createElement('select');
        const placeholder=document.createElement('option');placeholder.textContent='Wybierz produkt…';placeholder.value='';select.append(placeholder);
        for(const item of u.jev.catalog.items){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;select.append(option);}
        select.addEventListener('change',()=>{if(!select.value)return;const o=JSON.parse($('jevOrder').value);o.participants.find(p=>p.id===person.id).items.push({itemId:select.value,quantity:u.jev.catalog.items.find(i=>i.id===select.value).baseQuantity || 1});markDirty(o);displayOrder(o);});
        add.replaceWith(select);
      }catch(e){show(e.message);}
    });section.append(add);host.append(section);
  }
}
for(const [id,key] of [['jevDate','date'],['jevTime','time'],['jevPeople','people'],['jevDuration','durationMin']]) {
  $(id).addEventListener('change',()=>{
    if(!current)return;
    const o=JSON.parse($('jevOrder').value);o[key]=['people','durationMin'].includes(key)?Number($(id).value)||null:$(id).value||null;
    if(key==='durationMin') o.durationSource='operator';
    if(key==='people') o.billingPeople=o.people;
    if(key==='people' && Number.isInteger(o.people) && o.people>0 && o.people<=30) o.participants=Array.from({length:o.people},(_,i)=>o.participants.find(p=>p.id===i+1)||{id:i+1,complete:false,items:[]});
    markDirty(o);displayOrder(o);
  });
}

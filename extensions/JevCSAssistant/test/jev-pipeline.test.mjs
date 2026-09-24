import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnswers, decide } from '../ai/jev-client.js';
import { analyzeThread, calculateCase, fingerprint, validDate } from '../core/orchestrator.js';
import { priceOrder } from '../tools/pricing.js';
import { validateCatalog } from '../catalog/catalog.js';
import { zUstawieniami } from '../config.js';
import { renderCase } from '../templates/render.js';

const catalog = { version: 'test', currency: 'PLN', approved: true, items: [
  { id: 'xyz', name: 'XYZ', unit: 'shot', priceGrosz: 501, quantities: [5,10,20] },
  { id: 'abc', name: 'ABC', unit: 'shot', priceGrosz: 702, quantities: [5,10,20] },
] };
const settings = () => zUstawieniami({ apiKey: 'secret-api', icalUrl: 'https://secret-calendar', jev: { catalog } });
const thread = { threadId: 'T1', ostatniaWiadomoscId: 'M1', wiadomosci: [{ id: 'M1', nadawca: 'client@example.com', tekst: '2 osoby. Osoba 1: XYZ 20, osoba 2: ABC 5, 26.10.2027, 30 minut.' }], ostrzezenia: [] };
function answers(questions, overrides = {}) {
  return Object.fromEntries(Object.entries(questions).map(([id,q]) => {
    const values = { quote:'yes',availability:'yes',review:'no',language:'pl',people:'2',billingPeople:'2',product_xyz:'yes',product_abc:'yes',day:'26',month:'10',year:String(new Date().getFullYear()+1),time:'missing',duration:'30',unsupported:'no',p1_complete:'yes',p2_complete:'yes',p1_xyz:'20',p1_abc:'none',p2_xyz:'none',p2_abc:'5',...overrides };
    const value = values[id];
    assert.ok(Object.hasOwn(q.criteria,value), `fixture missing ${id}=${value}`);
    return [id, { type:'choice', choice:value,confidence:0.99,probabilities:Object.fromEntries(Object.keys(q.criteria).map(k => [k,k===value?1:0])) }];
  }));
}
const mock = (overrides={}) => async ({questions}) => ({ answers: answers(questions,overrides), metrics:{calls:1,costUsd:0.0001,ms:1} });
const calendar = async () => ({proponowane:['12:00','13:30'],zrodlo:{wiekMin:3,przeterminowany:false}});

test('mail → Jev → koszyki → dokładna cena → kalendarz → wzorzec bez LLM', async () => {
  const c = await analyzeThread({thread,settings:settings(),decideImpl:mock()});
  const r = await calculateCase(c,settings(),calendar);
  assert.equal(r.quote.totalGrosz,13530);
  assert.deepEqual(r.quote.lines.map(l => [l.personId,l.itemId,l.quantity]),[[1,'xyz',20],[2,'abc',5]]);
  assert.equal(r.availability.status,'provisional');
  assert.equal(r.draft.mode,'template');
  assert.match(r.draft.text,/135,30/);
  assert.match(r.draft.text,/wymagają potwierdzenia/);
  assert.equal(r.metrics.filter(m=>m.calls).length,2);
});
test('brak roku nie jest uzupełniany bieżącym; kalendarz nie jest wywoływany',async()=>{
  const c=await analyzeThread({thread,settings:settings(),decideImpl:mock({year:'missing'})});
  const r=await calculateCase(c,settings(),async()=>assert.fail('calendar must not run'));
  assert.equal(r.order.date,null); assert.ok(r.missing.includes('date')); assert.match(r.draft.text,/rokiem/);
});
test('brak ilości nie staje się zerem ani pełną ceną',async()=>{
  const c=await analyzeThread({thread,settings:settings(),decideImpl:mock({p1_xyz:'missing'})});
  const r=await calculateCase(c,settings(),calendar);
  assert.equal(r.quote.totalGrosz,null); assert.match(r.draft.text,/ilości dla każdej osoby/);
});
test('błąd kalendarza zachowuje poprawną wycenę',async()=>{
  const c=await analyzeThread({thread,settings:settings(),decideImpl:mock()});
  const r=await calculateCase(c,settings(),async()=>{throw new Error('offline');});
  assert.equal(r.quote.totalGrosz,13530); assert.equal(r.availability.status,'unavailable');
  assert.match(r.draft.text,/Nie możemy jeszcze/);
});
test('brak zatwierdzonego cennika nie tworzy automatycznego draftu',async()=>{
  const u=settings(); u.jev.catalog={...catalog,approved:false};
  const c=await analyzeThread({thread,settings:u,decideImpl:mock()});
  const r=await calculateCase(c,u,calendar); assert.equal(r.draft,null);assert.equal(r.quote.totalGrosz,null);
});
test('nieznane produkty i zmiany rezerwacji kierowane do człowieka',async()=>{
  for(const overrides of [{review:'yes'},{unsupported:'yes'}]) {
    const c=await analyzeThread({thread,settings:settings(),decideImpl:mock(overrides)});
    const r=await calculateCase(c,settings(),calendar);assert.equal(r.draft,null);
  }
});
test('niska pewność triażu nie uruchamia narzędzia ani automatycznego draftu',async()=>{
  const c=await analyzeThread({thread,settings:settings(),decideImpl:async args=>{
    const r=await mock()(args);if(r.answers.availability) r.answers.availability.confidence=0.2;return r;
  }});
  const r=await calculateCase(c,settings(),async()=>assert.fail());assert.equal(r.draft,null);
});
test('kontekst modelu nie zawiera klucza, linku iCal ani adresu email',async()=>{
  const t=structuredClone(thread);t.wiadomosci[0].tekst+=' secret-api https://secret-calendar';
  await analyzeThread({thread:t,settings:settings(),decideImpl:async args=>{
    const state=JSON.stringify(args.state);assert.ok(!state.includes('secret-api'));assert.ok(!state.includes('secret-calendar'));assert.ok(!state.includes('client@example.com'));
    return mock()(args);
  }});
});
test('kontrakt Jev odrzuca brak pola, obcą opcję i uszkodzony rozkład',()=>{
  const q={a:{type:'choice',criteria:{yes:'tak',no:'nie'}}};
  for(const a of [null,{type:'choice',choice:'other',confidence:1,probabilities:{yes:1,no:0}}, {type:'choice',choice:'yes',confidence:1,probabilities:{yes:0.4,no:0.1}}]) assert.throws(()=>validateAnswers({answers:{a}},q));
});
test('adapter: retry 429, sekret tylko w nagłówku, koszt null nie staje się zerem',async()=>{
  let calls=0;const questions={a:{type:'choice',criteria:{yes:'tak',no:'nie'}}};
  const r=await decide({apiKey:'secret',state:{text:'hello'},questions,fetchImpl:async(url,init)=>{
    assert.equal(url,'https://openrouter.ai/api/alpha/decisions');assert.equal(init.headers.Authorization,'Bearer secret');assert.ok(!init.body.includes('secret'));
    if(++calls===1)return {ok:false,status:429};
    return {ok:true,json:async()=>({answers:{a:{type:'choice',choice:'yes',confidence:1,probabilities:{yes:1,no:0}}},usage:{cost:null}})};
  }});assert.equal(calls,2);assert.equal(r.metrics.costUsd,null);
});
test('adapter nie ponawia HTTP 401 ani błędnego JSON kontraktu',async()=>{
  let calls=0;await assert.rejects(decide({apiKey:'x',state:{},questions:{a:{type:'choice',criteria:{x:'x'}}},fetchImpl:async()=>{calls++;return{ok:false,status:401};}}),/401/);assert.equal(calls,1);
});
test('timeout obejmuje ciało odpowiedzi',async()=>{
  await assert.rejects(decide({apiKey:'x',state:{},questions:{a:{type:'choice',criteria:{x:'x'}}},timeoutMs:10,
    fetchImpl:async(_url,{signal})=>({ok:true,json:()=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('abort'))))})}),/czas/);
});
test('duplikaty produktów, obce ID i ilości poza katalogiem nie dają ceny',()=>{
  for(const items of [[{itemId:'xyz',quantity:5},{itemId:'xyz',quantity:5}],[{itemId:'unknown',quantity:5}],[{itemId:'xyz',quantity:9}]])assert.equal(priceOrder({people:1,participants:[{id:1,complete:true,items}]},catalog).totalGrosz,null);
});
test('invalid date i wersja wiadomości',()=>{
  assert.equal(validDate('2027-02-29'),false);assert.equal(validDate('2028-02-29'),true);
  const t=structuredClone(thread);t.wiadomosci[0].tekst+=' correction';assert.notEqual(fingerprint(t),fingerprint(thread));
});
test('wzorzec nie może pominąć kwot ani dodać nieznanego placeholdera',async()=>{
  const c=await analyzeThread({thread,settings:settings(),decideImpl:mock()});const r=await calculateCase(c,settings(),calendar);
  assert.throws(()=>renderCase(r,{pl:'Hello'}),/pomija/);
  assert.throws(()=>renderCase(r,{pl:'{{wycena}}{{dostepnosc}}{{pytania}}{{unknown}}'}),/Nieznana/);
});
test('katalog odrzuca cenę ułamkową i nieznane zależności',()=>{
  const x=structuredClone(catalog);x.items[0].priceGrosz=0.1;assert.throws(()=>validateCatalog(x));
  x.items[0].priceGrosz=500;x.items[0].exclusiveWith=['missing'];assert.throws(()=>validateCatalog(x));
});

import { CSA_CATALOG } from '../catalog/csa-catalog.js';
import { policzDostepnoscZEventow, proponowaneGodziny, klasyfikujEventy, liczbaInstruktorowDlaOsob } from '../logic.js';
import { restoreBlocks } from '../ai/redact.js';
const gun = name => CSA_CATALOG.items.find(i => i.name === name).id;
const basket = (items) => ({ people: 1, billingPeople: 1, participants: [{id:1,complete:true,items}] });
test('cennik użytkownika: 90 zł per osoba, cena blokowa bez błędu dzielenia przez 7',()=>{
  const q=priceOrder(basket([{itemId:gun('Colt 1911 (tactical)'),quantity:14}]),CSA_CATALOG);
  assert.equal(q.totalGrosz,21000);assert.equal(q.personTotals.length,1);
});
test('pakiet usuwa opłatę serwisową także przy dodatkowej broni',()=>{
  const q=priceOrder(basket([{itemId:'basic',quantity:1},{itemId:gun('Glock'),quantity:20}]),CSA_CATALOG);
  assert.equal(q.totalGrosz,32000);assert.ok(!q.lines.some(l=>l.unit==='fee'));
});
test('lista bez liczby uczestników to jeden zestaw do wyceny, nie potwierdzona liczba osób w kalendarzu',()=>{
  const o=basket([{itemId:gun('Glock'),quantity:10}]);o.people=null;
  assert.equal(priceOrder(o,CSA_CATALOG).totalGrosz,15000);
});
test('15 strzałów Glocka zatrzymuje pełną wycenę i daje wymagany komunikat',()=>{
  const q=priceOrder(basket([{itemId:gun('Glock'),quantity:15}]),CSA_CATALOG);
  assert.equal(q.status,'invalid');assert.equal(q.totalGrosz,null);
  const r=renderCase({language:'pl',quote:q,intents:{quote:true},missing:[]});assert.match(r.text,/Błędna liczba strzałów\nOsoba 1: Glock - 15/);
});
test('pełne podsumowanie wszystkich osób, każda opłata serwisowa tylko raz',()=>{
  const o={people:2,participants:[{id:1,complete:true,items:[{itemId:gun('Glock'),quantity:20}]},{id:2,complete:true,items:[{itemId:'vip',quantity:1}]}]};
  const q=priceOrder(o,CSA_CATALOG);assert.equal(q.totalGrosz,64000);assert.deepEqual(q.personTotals.map(p=>p.totalGrosz),[21000,43000]);
  const r=renderCase({language:'pl',quote:q,intents:{quote:true},missing:[]});assert.equal((r.text.match(/• Osoba /g)||[]).length,2);
});
test('aliasy PPSz są jednym produktem, cennik zawiera wszystkie pakiety',()=>{
  validateCatalog(CSA_CATALOG);assert.equal(CSA_CATALOG.items.length,62);assert.equal(CSA_CATALOG.items.filter(i=>i.unit==='package').length,7);
  assert.equal(CSA_CATALOG.items.find(i=>i.id==='ppsz').aliases.length,2);
});
test('redakcja LLM zachowuje blok z wyceną znak w znak',()=>{
  assert.equal(restoreBlocks('Hello\n[[VERIFIED_REPLY]]\nRegards','Cena: 150,00 PLN'),'Hello\nCena: 150,00 PLN\nRegards');
  assert.throws(()=>restoreBlocks('Price 5 [[VERIFIED_REPLY]]','data'));
  assert.throws(()=>restoreBlocks('[[VERIFIED_REPLY]][[VERIFIED_REPLY]]','data'));
});
test('reguły z prototypu: JDG nie zajmuje obsady, START 4os pozostaje rezerwacją',()=>{
  const events=klasyfikujEventy([{tytul:'JDG Adam',start:new Date(),end:new Date()},{tytul:'START 4os',start:new Date(),end:new Date()}]);
  assert.deepEqual(events.map(e=>e.typ),['znacznik','rezerwacja']);
});
test('instruktorzy według dostarczonej tabeli, 16+ ma stałe 6',()=>{
  assert.deepEqual([2,7,12,14,15,16,30,100].map(liczbaInstruktorowDlaOsob),[1,2,3,4,5,6,6,6]);
});
test('propozycje: pełna godzina przed połówką; godzinna wizyta przesuwa następny start',()=>{
  assert.deepEqual(proponowaneGodziny([{od:'12:00',do:'12:30',dostepny:true},{od:'12:30',do:'13:00',dostepny:true},{od:'13:00',do:'13:30',dostepny:false},{od:'13:30',do:'14:00',dostepny:true}]),['12:00','13:30']);
  assert.deepEqual(proponowaneGodziny([{od:'12:00',do:'13:00',dostepny:false},{od:'12:30',do:'13:30',dostepny:true},{od:'13:00',do:'14:00',dostepny:true},{od:'14:00',do:'15:00',dostepny:true}]),['12:30','14:00']);
});
import { calculateAvailability } from '../tools/availability.js';
test('wolna obsada: rezerwacja nie odejmuje instruktorów drugi raz, luka 15 minut blokuje wizytę',()=>{
  const make=(title,h1,m1,h2,m2)=>({tytul:title,start:new Date(2027,9,26,h1,m1),end:new Date(2027,9,26,h2,m2),calodniowe:false});
  const input={dataISO:'2027-10-26',osoby:4,czasTrwaniaMin:60,eventy:[make('2',12,0,13,0),make('4os',12,0,13,0)]};
  let r=calculateAvailability(input,{staffing:'free'});assert.equal(r.sloty.find(s=>s.od==='12:00').dostepny,true);
  input.eventy=[make('2',12,15,13,0)];r=calculateAvailability(input,{staffing:'free'});assert.equal(r.sloty.find(s=>s.od==='12:00').dostepny,false);
});
test('niezgodna liczba osób i wycenionych zestawów nie daje finalnej ceny',()=>{
  const o=basket([{itemId:'basic',quantity:1}]);o.people=2;
  assert.equal(priceOrder(o,CSA_CATALOG).totalGrosz,null);
});
test('zmiana zamówienia unieważnia czas wyprowadzony z katalogu',async()=>{
  const u=settings();u.jev.catalog=structuredClone(catalog);u.jev.catalog.durationRule='maxParticipantSum';u.jev.catalog.items.forEach(i=>i.durationMin=1);
  const c=await analyzeThread({thread,settings:u,decideImpl:mock({duration:'missing'})});
  const r=await calculateCase(c,u,calendar);assert.equal(r.order.durationMin,20);assert.equal(r.order.durationSource,'catalog');
  r.order.participants[0].items[0].quantity=10;
  const changed=await calculateCase(r,u,calendar);assert.equal(changed.order.durationMin,10);
});
test('niepotwierdzone reguły kalendarza blokują obliczenia zamiast zgadywać model obsady',()=>{
  assert.throws(()=>calculateAvailability({}, {staffing:'unconfirmed',proposals:'unconfirmed'}),/Wybierz/);
});
test('wynik wyceny ma osobne sekcje, opłatę i końcową kwotę dla każdej osoby',()=>{
  const q=priceOrder(basket([{itemId:gun('Glock'),quantity:20}]),CSA_CATALOG);
  const result=renderCase({language:'pl',quote:q,intents:{quote:true},missing:[]});
  assert.match(result.text,/Osoba 1\nGlock: 20 strzałów/);
  assert.match(result.text,/Opłata serwisowa: 90,00/);
  assert.match(result.text,/Finalny koszt: 210,00/);
});

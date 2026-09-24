import { KONFIG, klasyfikujEventy, eventyDnia, godzinyOtwarciaDlaDnia, liczbaInstruktorowDlaOsob,
  hhmm, sformatujDostepnosc, proponowaneGodziny, policzDostepnoscZEventow } from '../logic.js';
// Adapted from prototype/dzien-prototyp.js. Exact interval boundaries fix partial half-hour coverage.
export function calculateAvailability(input, policy = {}) {
  if (policy.staffing === 'unconfirmed' || policy.proposals === 'unconfirmed') throw new Error('Wybierz w ustawieniach znaczenie liczby instruktorów i regułę proponowania godzin.');
  if (policy.staffing !== 'free') {
    const r = policzDostepnoscZEventow(input);
    if (policy.proposals === 'everyHour') { r.proponowane=hourlyProposals(r.sloty);r.tekst=sformatujDostepnosc(r,input.preferowanaGodzina); }
    return r;
  }
  const { eventy, dataISO, osoby, czasTrwaniaMin, preferowanaGodzina } = input;
  if (!Number.isInteger(Number(osoby)) || Number(osoby)<1 || !Number.isInteger(Number(czasTrwaniaMin)) || Number(czasTrwaniaMin)<1 || Number(czasTrwaniaMin)>480) throw new Error('Uzupełnij liczbę osób i czas wizyty.');
  const hours = godzinyOtwarciaDlaDnia(dataISO);
  const required = liczbaInstruktorowDlaOsob(osoby);
  const events = klasyfikujEventy(eventyDnia(eventy,dataISO));
  const staff = events.filter(e => e.typ === 'obsada' && !e.calodniowe);
  const [year,month,day] = dataISO.split('-').map(Number);
  const at = minutes => new Date(year,month-1,day,Math.floor(minutes/60),minutes%60);
  const slots=[];
  if(hours) for(let start=hours.od; policy.allowFinishAfterClosing ? start<=hours.do : start+Number(czasTrwaniaMin)<=hours.do; start+=KONFIG.krokSlotuMin) {
    const a=at(start).getTime(),b=at(start+Number(czasTrwaniaMin)).getTime();
    const intersect=staff.filter(e=>e.start.getTime()<b && e.end.getTime()>a);
    const boundaries=[...new Set([a,b,...intersect.flatMap(e=>[Math.max(a,e.start.getTime()),Math.min(b,e.end.getTime())])])].sort((a,b)=>a-b);
    let free=Infinity;
    for(let i=0;i<boundaries.length-1;i++) {
      const covering=intersect.filter(e=>e.start.getTime()<=boundaries[i] && e.end.getTime()>=boundaries[i+1]);
      free=Math.min(free,covering.length?Math.max(...covering.map(e=>Number(e.liczba)||0)):0);
    }
    slots.push({od:hhmm(at(start)),do:hhmm(at(start+Number(czasTrwaniaMin))),wolniInstruktorzy:free===Infinity?0:free,dostepny:free>=required});
  }
  const proposed = policy.proposals === 'everyHour' ? hourlyProposals(slots) : proponowaneGodziny(slots);
  const result={dataISO,otwarte:!!hours,godziny:hours,osoby:Number(osoby),czasTrwaniaMin:Number(czasTrwaniaMin),wymaganiInstruktorzy:required,sloty:slots,proponowane:proposed,eventy:events,
    uwagi:staff.length?[]:['Brak liczbowych wpisów wolnej obsady.'],preferowanaGodzina:preferowanaGodzina||null};
  return {...result,tekst:sformatujDostepnosc(result,preferowanaGodzina)};
}
export function hourlyProposals(slots) {
  const out=[];const map=new Map(slots.map(s=>[s.od,s]));
  for(const s of slots) if(s.od.endsWith(':00')) {
    const selected=s.dostepny?s:map.get(s.od.slice(0,2)+':30');
    if(selected?.dostepny)out.push(selected.od);
  }
  if(slots[0]?.dostepny && !out.includes(slots[0].od))out.unshift(slots[0].od);
  return out;
}

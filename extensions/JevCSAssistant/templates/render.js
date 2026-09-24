export const DEFAULT_TEMPLATES = {
  pl: 'Dzień dobry,\n\n{{wycena}}\n\n{{dostepnosc}}\n\n{{pytania}}',
  en: 'Hello,\n\n{{wycena}}\n\n{{dostepnosc}}\n\n{{pytania}}',
};
const money = (n, lang) => new Intl.NumberFormat(lang === 'en' ? 'en-GB' : 'pl-PL', { style: 'currency', currency: 'PLN' }).format(n / 100);
export function renderCase(c, templates = DEFAULT_TEMPLATES) {
  const en = c.language === 'en';
  const sections = { wycena: '', dostepnosc: '', pytania: '' };
  if (c.quote?.status === 'invalid') {
    sections.wycena = (en ? 'Invalid number of shots' : 'Błędna liczba strzałów') + '\n' + c.quote.invalidShots.map(l => `${en ? 'Person' : 'Osoba'} ${l.personId}: ${l.name} - ${l.quantity}`).join('\n');
  } else if (c.quote?.status === 'complete') {
    sections.wycena = c.quote.personTotals.map(person => {
      const lines=c.quote.lines.filter(l=>l.personId===person.personId).map(l=>{
        const name=l.unit==='fee' && en?'Service fee':l.name;
        const amount=l.unit==='shot'?`${l.quantity} ${en?'shots':'strzałów'} — `:(l.unit==='fee'?'':`× ${l.quantity} — `);
        return `${name}: ${amount}${money(l.totalGrosz,c.language)}`;
      });
      return `${en?'Person':'Osoba'} ${person.personId}\n${lines.join('\n')}\n${en?'Final cost':'Finalny koszt'}: ${money(person.totalGrosz,c.language)}`;
    }).join('\n\n') + `\n\n${en ? 'Summary' : 'Podsumowanie'}:\n` + c.quote.personTotals.map(p => `• ${en ? 'Person' : 'Osoba'} ${p.personId}: ${money(p.totalGrosz, c.language)}`).join('\n') + `\n${en ? 'Total' : 'Razem'}: ${money(c.quote.totalGrosz, c.language)}.`;
  } else if (c.intents.quote) sections.wycena = en ? 'We need to clarify the order before providing a final quote.' : 'Przed podaniem pełnej wyceny potrzebujemy doprecyzować zamówienie.';
  if (c.availability?.status === 'provisional') {
    const times = c.availability.times.join(', ');
    sections.dostepnosc = times
      ? (en ? `Preliminary available times for ${c.order.date}: ${times}. These times require confirmation; no booking has been made.` : `Wstępne dostępne godziny na ${c.order.date}: ${times}. Terminy wymagają potwierdzenia; rezerwacja nie została dokonana.`)
      : (en ? `We found no available times for ${c.order.date} in the calendar data. We will need to verify this.` : `W odczytanych danych kalendarza nie znaleźliśmy wolnych godzin na ${c.order.date}. Wymaga to jeszcze sprawdzenia.`);
  } else if (c.intents.availability) sections.dostepnosc = en ? 'We cannot confirm availability yet.' : 'Nie możemy jeszcze potwierdzić dostępności.';
  const questions = [];
  if (c.missing.includes('people')) questions.push(en ? 'number of participants' : 'liczbę uczestników');
  if (c.missing.includes('date')) questions.push(en ? 'the full date including year' : 'pełną datę wraz z rokiem');
  if (c.missing.includes('time')) questions.push(en ? 'preferred time or acceptable time range' : 'preferowaną godzinę lub dopuszczalny przedział');
  if (c.missing.includes('order')) questions.push(en ? 'the package or firearms and quantities for each participant' : 'pakiet lub bronie i ilości dla każdej osoby');
  if (questions.length) sections.pytania = `${en ? 'Please specify' : 'Prosimy doprecyzować'}: ${questions.join('; ')}.`;
  const template = templates[c.language];
  if (typeof template !== 'string' || template.length > 20000) throw new Error('Brak poprawnego wzorca dla języka.');
  for (const key of Object.keys(sections)) if (sections[key] && !template.includes(`{{${key}}}`)) throw new Error(`Wzorzec pomija wymagany blok {{${key}}}.`);
  const text = template.replace(/\{\{([^{}]+)\}\}/g, (_, k) => {
    if (!Object.hasOwn(sections, k)) throw new Error(`Nieznana zmienna wzorca: ${k}`);
    return sections[k];
  }).replace(/\n{3,}/g, '\n\n').trim();
  return { text, templateId: `standard-${c.language}`, mode: 'template' };
}

import { getCountries, getCountryCallingCode } from 'libphonenumber-js/min';

const polishNames = new Intl.DisplayNames(['pl'], { type: 'region' });
const englishNames = new Intl.DisplayNames(['en'], { type: 'region' });
const aliases: Record<string, string> = {
  GB: 'UK Anglia England Wielka Brytania',
  US: 'USA Ameryka United States of America',
  NL: 'Holandia Holland',
  AE: 'ZEA UAE Emiraty',
};

function normalize(value: string) {
  return value.toLocaleLowerCase('pl').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').trim();
}

// Calling codes come from Google's phone metadata via libphonenumber-js.
// AC, TA and XK are supported region identifiers, not officially assigned ISO codes.
export const COUNTRIES = getCountries().map((code) => ({
  code,
  name: polishNames.of(code) ?? code,
  callingCode: `+${getCountryCallingCode(code)}`,
  isOfficialIso: !['AC', 'TA', 'XK'].includes(code),
  search: normalize(`${polishNames.of(code)} ${englishNames.of(code)} ${code} ${aliases[code] ?? ''}`),
})).sort((a, b) => a.name.localeCompare(b.name, 'pl'));

export function findCountries(query: string) {
  const normalized = normalize(query);
  if (!normalized) return [];
  return COUNTRIES.filter((country) => country.search.includes(normalized) || country.callingCode === normalized);
}

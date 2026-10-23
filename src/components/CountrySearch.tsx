'use client';

import { useState } from 'react';
import { Globe, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { findCountries } from '@/lib/countries';

export function CountrySearch() {
  const [query, setQuery] = useState('');
  const results = findCountries(query);

  return (
    <section aria-labelledby="country-search-heading" className="w-full border-b pb-4">
      <h2 id="country-search-heading" className="mb-3 flex items-center gap-2 text-sm font-medium">
        <Globe className="size-4 text-muted-foreground" aria-hidden="true" />Kody państw
      </h2>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
        <Input aria-label="Szukaj państwa" aria-describedby="country-search-help" placeholder="Nazwa kraju…" value={query}
          onChange={(event) => setQuery(event.target.value)} maxLength={100} className="pl-8 text-sm" />
      </div>
      <p id="country-search-help" className="mt-2 text-xs text-muted-foreground">Kod telefoniczny i ISO, np. Polska.</p>
      {query.trim() && (
        <div className="mt-3">
          <p role="status" className="mb-2 text-xs text-muted-foreground">{results.length ? `Wyniki: ${results.length}` : 'Nie znaleziono państwa.'}</p>
          <ul aria-label="Znalezione państwa" className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto overscroll-contain sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
            {results.map((country) => (
              <li key={country.code} className="rounded-lg border p-2.5">
                <p className="break-words text-sm font-medium">{country.name}</p>
                <dl className="mt-1.5 flex flex-wrap justify-between gap-2 text-xs">
                  <div><dt className="text-muted-foreground">Telefon</dt><dd className="mt-0.5 font-semibold tabular-nums">{country.callingCode}</dd></div>
                  <div><dt className="text-muted-foreground">{country.isOfficialIso ? 'ISO' : 'Kod regionu*'}</dt><dd className="mt-0.5 font-semibold">{country.code}</dd></div>
                </dl>
                {!country.isOfficialIso && <p className="mt-2 text-[11px] text-muted-foreground">* Kod nie jest oficjalnie przypisany w ISO.</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

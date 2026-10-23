// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { CountrySearch } from '@/components/CountrySearch';
import { findCountries } from '@/lib/countries';

afterEach(cleanup);

it('finds Polish and English names, unaccented names, ISO and common aliases', () => {
  for (const query of ['Polska', 'poland', 'PL']) {
    expect(findCountries(query)).toContainEqual(expect.objectContaining({ code: 'PL', callingCode: '+48' }));
  }
  expect(findCountries('wlochy')).toContainEqual(expect.objectContaining({ code: 'IT', callingCode: '+39' }));
  expect(findCountries('UK')).toContainEqual(expect.objectContaining({ code: 'GB', callingCode: '+44' }));
  expect(findCountries('USA')).toContainEqual(expect.objectContaining({ code: 'US', callingCode: '+1' }));
  expect(findCountries('+1')).toContainEqual(expect.objectContaining({ code: 'CA', callingCode: '+1' }));
  expect(findCountries('   ')).toEqual([]);
});

it('shows both codes and an empty state while searching', () => {
  const view = render(<CountrySearch />);
  const input = view.getByRole('textbox', { name: 'Szukaj państwa' });
  fireEvent.change(input, { target: { value: 'Polska' } });
  expect(view.getByText('+48')).toBeTruthy();
  expect(view.getByText('PL')).toBeTruthy();
  fireEvent.change(input, { target: { value: 'nieistniejący kraj' } });
  expect(view.getByRole('status').textContent).toBe('Nie znaleziono państwa.');
  expect(view.queryByText('+48')).toBeNull();
});

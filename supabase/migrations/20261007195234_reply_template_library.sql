-- Shared private library; the Next.js server authenticates the app password.
create table public.reply_template_library (
  id boolean primary key default true check (id),
  templates jsonb not null check (jsonb_typeof(templates) = 'array' and jsonb_array_length(templates) <= 100),
  revision integer not null default 1 check (revision > 0)
);
alter table public.reply_template_library enable row level security;
revoke all on public.reply_template_library from public, anon, authenticated, service_role;
grant select, update on public.reply_template_library to service_role;
insert into public.reply_template_library (templates) values (
  '[{"id":"quote-pl","title":"Odpowiedź z wyceną · PL","content":"Dzień dobry,\n\n{{wycena}}\n\n{{dostepnosc}}\n\n{{pytania}}"},{"id":"quote-en","title":"Odpowiedź z wyceną · EN","content":"Hello,\n\n{{wycena}}\n\n{{dostepnosc}}\n\n{{pytania}}"},{"id":"order-details","title":"Doprecyzowanie zamówienia","content":"Dzień dobry,\n\nDziękujemy za wiadomość. Prosimy o podanie liczby uczestników, wybranego pakietu lub broni i liczby strzałów dla każdej osoby oraz preferowanej daty i godziny wizyty.\n\nNa tej podstawie przygotujemy wycenę i sprawdzimy dostępność terminu."}]'::jsonb
);

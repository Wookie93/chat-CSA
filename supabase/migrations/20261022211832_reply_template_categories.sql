-- Keep the existing library as emails and give each category its own revision.
alter table public.reply_template_library
  add column category text not null default 'emails'
    check (category in ('emails', 'google_reviews'));

alter table public.reply_template_library
  drop constraint reply_template_library_pkey,
  add primary key (id, category);

-- Google review templates start empty; existing email content is preserved.
insert into public.reply_template_library (category, templates)
values ('google_reviews', '[]'::jsonb);

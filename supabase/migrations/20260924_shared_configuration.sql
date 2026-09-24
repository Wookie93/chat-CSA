-- Configuration only: no mail, bookings or Google credentials.
create table public.shared_configuration (
  revision bigint primary key check (revision > 0),
  document jsonb not null check (
    jsonb_typeof(document) = 'object'
    and (document->>'schemaVersion')::integer = 1
    and (document->>'revision')::bigint = revision
  ),
  created_at timestamptz not null default now()
);
alter table public.shared_configuration enable row level security;
revoke all on public.shared_configuration from public, anon, authenticated, service_role;
grant select, insert on public.shared_configuration to service_role;
-- Rollback = new revision containing the old content.

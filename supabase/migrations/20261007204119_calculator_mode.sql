alter table public.app_settings add column calculator_mode text not null default 'llm' check (calculator_mode in ('llm', 'jev'));

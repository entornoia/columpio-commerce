-- BLOQUE 3A.1: control persistente de handoff humano por conversación.
create table if not exists public.instagram_conversations (
  id uuid primary key default gen_random_uuid(),
  channel text not null default 'instagram',
  external_user_id text not null,
  agent_enabled boolean not null default true,
  human_takeover_at timestamptz,
  last_inbound_at timestamptz,
  last_event_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.instagram_conversations add column if not exists channel text not null default 'instagram';
alter table public.instagram_conversations add column if not exists external_user_id text;
alter table public.instagram_conversations add column if not exists agent_enabled boolean not null default true;
alter table public.instagram_conversations add column if not exists human_takeover_at timestamptz;
alter table public.instagram_conversations add column if not exists last_inbound_at timestamptz;
alter table public.instagram_conversations add column if not exists last_event_id text;
alter table public.instagram_conversations add column if not exists created_at timestamptz not null default now();
alter table public.instagram_conversations add column if not exists updated_at timestamptz not null default now();

create unique index if not exists instagram_conversations_channel_user_idx
  on public.instagram_conversations(channel, external_user_id);
create index if not exists instagram_conversations_last_inbound_idx
  on public.instagram_conversations(last_inbound_at desc);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'instagram_conversations_channel_check'
      and conrelid = 'public.instagram_conversations'::regclass
  ) then
    alter table public.instagram_conversations
      add constraint instagram_conversations_channel_check check (channel = 'instagram');
  end if;
end
$$;

drop trigger if exists instagram_conversations_updated_at on public.instagram_conversations;
create trigger instagram_conversations_updated_at
before update on public.instagram_conversations
for each row execute function public.set_updated_at();

alter table public.instagram_conversations enable row level security;
revoke all on table public.instagram_conversations from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update on table public.instagram_conversations to service_role;

drop policy if exists "Authenticated users select Instagram conversations" on public.instagram_conversations;
drop policy if exists "Authenticated users insert Instagram conversations" on public.instagram_conversations;
drop policy if exists "Authenticated users update Instagram conversations" on public.instagram_conversations;
drop policy if exists "Authenticated users delete Instagram conversations" on public.instagram_conversations;

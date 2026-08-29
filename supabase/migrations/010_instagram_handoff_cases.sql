-- BLOQUE 3A.3: casos operativos de handoff humano sin contenido de mensajes.
create table if not exists public.instagram_handoff_cases (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.instagram_conversations(id),
  trigger_event_id text not null,
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  notification_status text not null default 'pending',
  notification_attempted_at timestamptz,
  notification_sent_at timestamptz,
  notification_provider_id text
);

create unique index if not exists instagram_handoff_cases_trigger_event_idx
  on public.instagram_handoff_cases(trigger_event_id);

create index if not exists instagram_handoff_cases_status_created_idx
  on public.instagram_handoff_cases(status, created_at desc);

create index if not exists instagram_handoff_cases_conversation_idx
  on public.instagram_handoff_cases(conversation_id, created_at desc);

create unique index if not exists instagram_handoff_cases_one_open_idx
  on public.instagram_handoff_cases(conversation_id)
  where status in ('pending', 'in_progress');

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'instagram_handoff_cases_reason_check'
      and conrelid = 'public.instagram_handoff_cases'::regclass
  ) then
    alter table public.instagram_handoff_cases add constraint instagram_handoff_cases_reason_check
      check (reason in ('exchange_return', 'after_sales', 'business_proposal', 'human_request', 'unknown_escalation'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'instagram_handoff_cases_status_check'
      and conrelid = 'public.instagram_handoff_cases'::regclass
  ) then
    alter table public.instagram_handoff_cases add constraint instagram_handoff_cases_status_check
      check (status in ('pending', 'in_progress', 'resolved'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'instagram_handoff_cases_notification_status_check'
      and conrelid = 'public.instagram_handoff_cases'::regclass
  ) then
    alter table public.instagram_handoff_cases add constraint instagram_handoff_cases_notification_status_check
      check (notification_status in ('pending', 'sent', 'failed', 'not_configured'));
  end if;
end
$$;

alter table public.instagram_handoff_cases enable row level security;
revoke all on table public.instagram_handoff_cases from public, anon, authenticated;
grant usage on schema public to service_role;
grant select, insert, update on table public.instagram_handoff_cases to service_role;

create or replace function public.transition_instagram_conversation_to_human(
  p_external_user_id text,
  p_trigger_event_id text,
  p_reason text,
  p_classified_at timestamptz,
  p_changed_at timestamptz default now()
)
returns table (
  transitioned boolean,
  case_id uuid,
  agent_enabled boolean,
  human_only boolean,
  human_takeover_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_conversation_id uuid;
  v_case_id uuid;
begin
  if p_reason not in ('exchange_return', 'after_sales', 'business_proposal', 'human_request', 'unknown_escalation') then
    raise exception 'Invalid handoff reason';
  end if;

  update public.instagram_conversations as c
  set
    last_intent = case when p_reason = 'unknown_escalation' then 'unknown' else p_reason end,
    last_intent_at = p_classified_at,
    agent_enabled = false,
    human_only = false,
    human_takeover_at = p_changed_at,
    updated_at = p_changed_at
  where c.channel = 'instagram'
    and c.external_user_id = p_external_user_id
    and c.agent_enabled = true
    and c.human_only = false
  returning c.id into v_conversation_id;

  if v_conversation_id is null then
    return query
      select false, null::uuid, c.agent_enabled, c.human_only, c.human_takeover_at
      from public.instagram_conversations as c
      where c.channel = 'instagram' and c.external_user_id = p_external_user_id;
    return;
  end if;

  insert into public.instagram_handoff_cases (
    conversation_id, trigger_event_id, reason, status, notification_status
  ) values (
    v_conversation_id, p_trigger_event_id, p_reason, 'pending', 'pending'
  )
  on conflict (trigger_event_id) do nothing
  returning id into v_case_id;

  if v_case_id is null then
    select h.id into v_case_id
    from public.instagram_handoff_cases as h
    where h.trigger_event_id = p_trigger_event_id;
  end if;

  return query select true, v_case_id, false, false, p_changed_at;
end;
$$;

revoke all on function public.transition_instagram_conversation_to_human(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.transition_instagram_conversation_to_human(text, text, text, timestamptz, timestamptz) to service_role;

comment on table public.instagram_handoff_cases is
  'Casos operativos de handoff humano. No almacena mensajes ni historial del DM.';

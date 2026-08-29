-- BLOQUE 3A.4: estado conversacional estructurado, sin contenido de mensajes.
alter table public.instagram_conversations
  add column if not exists conversation_state text not null default 'unscoped',
  add column if not exists conversation_state_at timestamptz not null default now(),
  add column if not exists last_product_id uuid,
  add column if not exists last_variant_id uuid,
  add column if not exists last_agent_question text,
  add column if not exists last_commercial_action text,
  add column if not exists commercial_context_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'instagram_conversations_last_product_fk'
      and conrelid = 'public.instagram_conversations'::regclass
  ) then
    alter table public.instagram_conversations
      add constraint instagram_conversations_last_product_fk
      foreign key (last_product_id) references public.products(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'instagram_conversations_last_variant_fk'
      and conrelid = 'public.instagram_conversations'::regclass
  ) then
    alter table public.instagram_conversations
      add constraint instagram_conversations_last_variant_fk
      foreign key (last_variant_id) references public.product_variants(id) on delete set null;
  end if;
end
$$;

alter table public.instagram_conversations drop constraint if exists instagram_conversations_state_check;
alter table public.instagram_conversations add constraint instagram_conversations_state_check
  check (conversation_state in ('unscoped', 'sales', 'after_sales', 'order_tracking', 'human'));

alter table public.instagram_conversations drop constraint if exists instagram_conversations_agent_question_check;
alter table public.instagram_conversations add constraint instagram_conversations_agent_question_check
  check (last_agent_question is null or last_agent_question in (
    'ask_size', 'ask_color', 'confirm_quantity', 'confirm_add', 'confirm_order', 'ask_email'
  ));

alter table public.instagram_conversations drop constraint if exists instagram_conversations_commercial_action_check;
alter table public.instagram_conversations add constraint instagram_conversations_commercial_action_check
  check (last_commercial_action is null or last_commercial_action in (
    'search_catalog', 'add_item', 'set_quantity', 'remove_item', 'view_selection', 'create_order', 'create_payment_link'
  ));

alter table public.instagram_conversations drop constraint if exists instagram_conversations_last_intent_check;
alter table public.instagram_conversations add constraint instagram_conversations_last_intent_check check (
  last_intent is null or last_intent in (
    'sales', 'after_sales', 'exchange_return', 'order_tracking', 'general_info',
    'business_proposal', 'social_reaction', 'human_request', 'unknown'
  )
);

create index if not exists instagram_conversations_state_inbound_idx
  on public.instagram_conversations(conversation_state, last_inbound_at desc);

alter table public.instagram_handoff_cases drop constraint if exists instagram_handoff_cases_reason_check;
alter table public.instagram_handoff_cases add constraint instagram_handoff_cases_reason_check
  check (reason in ('exchange_return', 'after_sales', 'order_tracking', 'business_proposal', 'human_request', 'unknown_escalation'));

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
  if p_reason not in ('exchange_return', 'after_sales', 'order_tracking', 'business_proposal', 'human_request', 'unknown_escalation') then
    raise exception 'Invalid handoff reason';
  end if;

  update public.instagram_conversations as c
  set
    last_intent = case when p_reason = 'unknown_escalation' then 'unknown' else p_reason end,
    last_intent_at = p_classified_at,
    conversation_state = 'human',
    conversation_state_at = p_changed_at,
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

comment on column public.instagram_conversations.conversation_state is
  'Estado operativo de la conversación; no contiene texto ni historial del DM.';
comment on column public.instagram_conversations.last_product_id is
  'Producto focal validado contra el catálogo; nunca proviene directamente del modelo.';
comment on column public.instagram_conversations.last_variant_id is
  'Variante focal validada contra el catálogo; nunca proviene directamente del modelo.';

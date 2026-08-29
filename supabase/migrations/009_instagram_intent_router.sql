-- BLOQUE 3A.3: intención operativa más reciente por conversación.
alter table public.instagram_conversations
  add column if not exists last_intent text;

alter table public.instagram_conversations
  add column if not exists last_intent_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'instagram_conversations_last_intent_check'
      and conrelid = 'public.instagram_conversations'::regclass
  ) then
    alter table public.instagram_conversations
      add constraint instagram_conversations_last_intent_check check (
        last_intent is null or last_intent in (
          'sales', 'after_sales', 'exchange_return', 'general_info',
          'business_proposal', 'social_reaction', 'human_request', 'unknown'
        )
      );
  end if;
end
$$;

comment on column public.instagram_conversations.last_intent is
  'Última intención operativa clasificada. No contiene texto ni historial del mensaje.';

comment on column public.instagram_conversations.last_intent_at is
  'Fecha de la última clasificación de intención para contexto temporal mínimo.';

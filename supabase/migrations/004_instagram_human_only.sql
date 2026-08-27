-- BLOQUE 3A.1b: exclusión permanente del agente por conversación.
alter table public.instagram_conversations
  add column if not exists human_only boolean not null default false;

update public.instagram_conversations
set human_only = false
where human_only is null;

alter table public.instagram_conversations
  alter column human_only set default false;

alter table public.instagram_conversations
  alter column human_only set not null;

comment on column public.instagram_conversations.human_only is
  'Impide permanentemente respuestas automáticas para esta conversación hasta que un administrador la reactive.';

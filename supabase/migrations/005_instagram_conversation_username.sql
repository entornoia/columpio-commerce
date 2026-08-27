-- BLOQUE 3A.1: identificación visual mínima de conversaciones.
alter table public.instagram_conversations
  add column if not exists instagram_username text;

alter table public.instagram_conversations
  add column if not exists profile_checked_at timestamptz;

comment on column public.instagram_conversations.instagram_username is
  'Username público obtenido mediante Instagram User Profile API. El IGSID continúa siendo el identificador técnico.';

comment on column public.instagram_conversations.profile_checked_at is
  'Último intento server-side de actualizar el username de Instagram.';

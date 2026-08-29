-- BLOQUE 3A.5: foco comercial semántico separado de la selección transaccional.
alter table public.instagram_conversations
  add column if not exists focus_product_id uuid,
  add column if not exists focus_variant_id uuid,
  add column if not exists focus_category text,
  add column if not exists focus_updated_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'instagram_conversations_focus_product_fk'
      and conrelid = 'public.instagram_conversations'::regclass
  ) then
    alter table public.instagram_conversations add constraint instagram_conversations_focus_product_fk
      foreign key (focus_product_id) references public.products(id) on delete set null;
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'instagram_conversations_focus_variant_fk'
      and conrelid = 'public.instagram_conversations'::regclass
  ) then
    alter table public.instagram_conversations add constraint instagram_conversations_focus_variant_fk
      foreign key (focus_variant_id) references public.product_variants(id) on delete set null;
  end if;
end
$$;

create or replace function public.set_instagram_semantic_focus(
  p_external_user_id text,
  p_product_id uuid,
  p_variant_id uuid,
  p_category text,
  p_changed_at timestamptz default now()
)
returns table (
  focus_product_id uuid,
  focus_variant_id uuid,
  focus_category text,
  focus_updated_at timestamptz
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_variant_id is not null and p_product_id is null then
    raise exception 'Semantic focus variant requires product';
  end if;
  if p_product_id is not null and not exists (
    select 1 from public.products p where p.id = p_product_id and p.active = true
  ) then
    raise exception 'Semantic focus product is unavailable';
  end if;
  if p_variant_id is not null and not exists (
    select 1 from public.product_variants v
    where v.id = p_variant_id and v.product_id = p_product_id and v.active = true
  ) then
    raise exception 'Semantic focus variant is unavailable';
  end if;

  update public.instagram_conversations c
  set focus_product_id = p_product_id,
      focus_variant_id = p_variant_id,
      focus_category = nullif(btrim(p_category), ''),
      focus_updated_at = case when p_product_id is null and p_variant_id is null and nullif(btrim(p_category), '') is null then null else p_changed_at end,
      updated_at = p_changed_at
  where c.channel = 'instagram' and c.external_user_id = p_external_user_id
    and (c.focus_updated_at is null or c.focus_updated_at <= p_changed_at);

  if not found then
    if not exists (select 1 from public.instagram_conversations c where c.channel = 'instagram' and c.external_user_id = p_external_user_id) then
      raise exception 'Instagram conversation not found';
    end if;
  end if;

  return query
    select c.focus_product_id, c.focus_variant_id, c.focus_category, c.focus_updated_at
    from public.instagram_conversations c
    where c.channel = 'instagram' and c.external_user_id = p_external_user_id;
end;
$$;

revoke all on function public.set_instagram_semantic_focus(text, uuid, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.set_instagram_semantic_focus(text, uuid, uuid, text, timestamptz) to service_role;

comment on column public.instagram_conversations.focus_product_id is 'Producto del que se habla; no implica selección ni carrito.';
comment on column public.instagram_conversations.focus_variant_id is 'Variante focal validada server-side; no implica selección.';
comment on column public.instagram_conversations.focus_category is 'Categoría semántica focal sin contenido del mensaje.';
comment on function public.set_instagram_semantic_focus(text, uuid, uuid, text, timestamptz) is 'Actualiza o limpia atómicamente el foco semántico sin modificar selección, pedido ni handoff.';

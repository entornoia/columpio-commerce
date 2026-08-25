create extension if not exists pgcrypto;

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  name text not null,
  description text not null default '',
  category text not null,
  subcategory text not null default '',
  price numeric(12, 2) not null check (price >= 0),
  style text not null default '',
  season text not null default '',
  formality text not null default '',
  fit text not null default '',
  material text not null default '',
  occasions text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  active boolean not null default true
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  variant_sku text not null unique,
  color text not null,
  size text not null,
  stock integer not null default 0 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  image_url text not null,
  position integer not null default 0 check (position >= 0),
  alt_text text not null default ''
);

create index product_variants_product_id_idx on public.product_variants(product_id);
create index product_images_product_id_idx on public.product_images(product_id);
create unique index product_images_position_idx on public.product_images(product_id, position);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger products_updated_at before update on public.products
for each row execute function public.set_updated_at();
create trigger product_variants_updated_at before update on public.product_variants
for each row execute function public.set_updated_at();


begin;

do $migration$
declare
  current_definition text;
  corrected_definition text;
begin
  select pg_get_functiondef('public.create_web_checkout(text,uuid,jsonb,jsonb,text)'::regprocedure)
  into current_definition;

  if current_definition is null then
    raise exception 'create_web_checkout definition was not found';
  end if;
  if position('variant.sku' in current_definition) = 0 then
    raise exception 'Expected variant.sku reference was not found';
  end if;
  if position('variant.variant_sku' in current_definition) > 0 then
    raise exception 'create_web_checkout is already corrected';
  end if;

  corrected_definition := replace(current_definition, 'variant.sku', 'variant.variant_sku');

  if position('variant.sku' in corrected_definition) > 0
     or position('variant.variant_sku' in corrected_definition) = 0 then
    raise exception 'Variant SKU correction could not be verified';
  end if;

  execute corrected_definition;
end;
$migration$;

commit;

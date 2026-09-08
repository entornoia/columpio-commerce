begin;

create table public.web_order_email_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.web_orders(id) on delete restrict,
  event_type text not null check (event_type = 'order_paid_confirmation'),
  status text not null default 'pending' check (status in ('pending','sending','sent','failed')),
  recipient_email text not null check (recipient_email = lower(trim(recipient_email))),
  provider text not null default 'resend' check (provider = 'resend'),
  provider_message_id text,
  attempts integer not null default 0 check (attempts between 0 and 5),
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (order_id, event_type),
  check ((status = 'sent' and sent_at is not null and provider_message_id is not null) or (status <> 'sent' and sent_at is null)),
  check (last_error_code is null or char_length(last_error_code) <= 100),
  check (last_error_message is null or char_length(last_error_message) <= 240)
);

create index web_order_email_events_dispatch_idx
  on public.web_order_email_events(status, next_attempt_at, created_at)
  where status in ('pending','sending','failed');
create trigger web_order_email_events_updated_at before update on public.web_order_email_events
for each row execute function public.set_updated_at();

alter table public.web_order_email_events enable row level security;
revoke all on table public.web_order_email_events from public, anon, authenticated;
grant select, insert, update on table public.web_order_email_events to service_role;

create or replace function public.enqueue_paid_order_email()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
declare recipient text;
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    select customer.email into recipient from public.web_order_customers customer where customer.order_id = new.id;
    if recipient is null then raise exception 'Paid order customer snapshot missing'; end if;
    insert into public.web_order_email_events(order_id,event_type,recipient_email)
    values(new.id,'order_paid_confirmation',recipient)
    on conflict(order_id,event_type) do nothing;
  end if;
  return new;
end;
$$;
alter function public.enqueue_paid_order_email() owner to postgres;
revoke all on function public.enqueue_paid_order_email() from public, anon, authenticated;

create trigger web_orders_enqueue_paid_email
after update of status on public.web_orders
for each row execute function public.enqueue_paid_order_email();

create or replace function public.claim_web_order_email_events(p_limit integer default 25)
returns table (event_id uuid, order_id uuid, event_type text, recipient_email text, attempts integer)
language plpgsql
volatile
security definer
set search_path = '' as $$
begin
  if p_limit not between 1 and 50 then raise exception 'Invalid email dispatch limit'; end if;
  return query
  with candidates as (
    select event.id
    from public.web_order_email_events event
    where event.attempts < 5 and (
      (event.status in ('pending','failed') and event.next_attempt_at <= now())
      or (event.status = 'sending' and event.claimed_at < now() - interval '15 minutes')
    )
    order by event.next_attempt_at,event.created_at,event.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.web_order_email_events event
    set status='sending',attempts=event.attempts+1,claimed_at=now(),last_error_code=null,last_error_message=null
    from candidates where event.id=candidates.id
    returning event.*
  )
  select claimed.id,claimed.order_id,claimed.event_type,claimed.recipient_email,claimed.attempts from claimed;
end;
$$;
alter function public.claim_web_order_email_events(integer) owner to postgres;
revoke all on function public.claim_web_order_email_events(integer) from public, anon, authenticated;
grant execute on function public.claim_web_order_email_events(integer) to service_role;

create or replace function public.complete_web_order_email_event(p_event_id uuid,p_provider_message_id text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare changed boolean;
begin
  if nullif(trim(p_provider_message_id),'') is null or char_length(p_provider_message_id)>200 then raise exception 'Invalid provider message ID'; end if;
  update public.web_order_email_events set status='sent',provider_message_id=trim(p_provider_message_id),sent_at=now(),claimed_at=null
  where id=p_event_id and status='sending';
  changed := found;
  return changed;
end;
$$;
alter function public.complete_web_order_email_event(uuid,text) owner to postgres;
revoke all on function public.complete_web_order_email_event(uuid,text) from public, anon, authenticated;
grant execute on function public.complete_web_order_email_event(uuid,text) to service_role;

create or replace function public.fail_web_order_email_event(p_event_id uuid,p_error_code text,p_error_message text)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare changed boolean;
begin
  update public.web_order_email_events event set status='failed',claimed_at=null,
    last_error_code=left(coalesce(nullif(trim(p_error_code),''),'provider_error'),100),
    last_error_message=left(coalesce(nullif(trim(p_error_message),''),'No se pudo enviar el correo.'),240),
    next_attempt_at=now()+(least(power(2,event.attempts)::integer,60)*interval '1 minute')
  where event.id=p_event_id and event.status='sending';
  changed := found;
  return changed;
end;
$$;
alter function public.fail_web_order_email_event(uuid,text,text) owner to postgres;
revoke all on function public.fail_web_order_email_event(uuid,text,text) from public, anon, authenticated;
grant execute on function public.fail_web_order_email_event(uuid,text,text) to service_role;

comment on table public.web_order_email_events is 'Outbox idempotente P3. El fallo o retry de email nunca altera pedido, pago, reserva ni stock.';
comment on column public.web_order_email_events.recipient_email is 'Snapshot mínimo del destinatario al pasar el pedido a paid.';

commit;

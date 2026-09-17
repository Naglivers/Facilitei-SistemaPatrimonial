begin;

alter table public.billing_subscriptions drop constraint if exists billing_subscriptions_plan_check;
alter table public.billing_subscriptions add constraint billing_subscriptions_plan_check check (plan in ('basico', 'pro', 'infinite'));

create or replace function public.billing_entitlement(p_user uuid)
returns table(plan text, valid_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.plan, max(p.period_end) from public.billing_payments p
  join public.billing_subscriptions s on s.id=p.subscription_id
  where s.user_id=p_user and p.status='approved' and p.period_start<=now() and p.period_end>now()
  group by s.plan order by case s.plan when 'infinite' then 3 when 'pro' then 2 else 1 end desc limit 1
$$;

create or replace function public.my_plan()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); current_plan text; expires timestamptz; assets bigint; docs bigint; bytes bigint; sub jsonb; asset_max integer; storage_max bigint;
begin
  if uid is null then raise exception 'Faça login para consultar seu plano'; end if;
  select plan,valid_until into current_plan,expires from public.billing_entitlement(uid); current_plan := coalesce(current_plan,'free');
  asset_max := case current_plan when 'free' then 1 when 'basico' then 3 when 'pro' then 15 else null end;
  storage_max := case current_plan when 'free' then 10485760 when 'basico' then 104857600 when 'pro' then 1073741824 else null end;
  select count(*) into assets from public.patrimonio where user_id=uid;
  select count(*),coalesce(sum(d.tamanho),0) into docs,bytes from public.documentos_casa d join public.patrimonio p on p.id=d.patrimonio_id where p.user_id=uid;
  select jsonb_build_object('plan',plan,'status',status) into sub from public.billing_subscriptions where user_id=uid order by (status in ('creating','pending','authorized','paused')) desc,created_at desc limit 1;
  return jsonb_build_object('plan',current_plan,'valid_until',expires,'assets',assets,'documents',docs,'storage_bytes',bytes,'storage_limit',storage_max,'asset_limit',asset_max,'document_limit',null,'subscription',sub);
end $$;

create or replace function public.enforce_plan_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid; current_plan text; used bigint; maximum integer;
begin
  if tg_table_name <> 'patrimonio' then return new; end if;
  if tg_op='UPDATE' then if new.user_id is distinct from old.user_id then raise exception 'Não é permitido transferir o proprietário do patrimônio'; end if; return new; end if;
  uid := new.user_id; if uid is null or (auth.uid() is not null and uid<>auth.uid()) then raise exception 'Proprietário inválido'; end if;
  select plan into current_plan from public.billing_entitlement(uid); current_plan := coalesce(current_plan,'free');
  maximum := case current_plan when 'free' then 1 when 'basico' then 3 when 'pro' then 15 else null end;
  if maximum is null then return new; end if;
  select count(*) into used from public.patrimonio where user_id=uid;
  if used>=maximum then raise exception 'Limite de patrimônios do plano atingido.'; end if;
  return new;
end $$;

create or replace function public.enforce_storage_plan_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid; current_plan text; used bigint; maximum bigint;
begin
  select user_id into uid from public.patrimonio where id=new.patrimonio_id;
  select plan into current_plan from public.billing_entitlement(uid); current_plan := coalesce(current_plan,'free');
  maximum := case current_plan when 'free' then 10485760 when 'basico' then 104857600 when 'pro' then 1073741824 else null end;
  if maximum is null then return new; end if;
  select coalesce(sum(d.tamanho),0) into used from public.documentos_casa d join public.patrimonio p on p.id=d.patrimonio_id where p.user_id=uid;
  if used + new.tamanho > maximum then raise exception 'Limite de armazenamento do plano atingido.'; end if;
  return new;
end $$;

update storage.buckets set file_size_limit=null where id='documentos';
commit;

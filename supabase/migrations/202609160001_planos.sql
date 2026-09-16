begin;

-- O projeto existente deve identificar o proprietário de cada patrimônio.
-- Não atribuir dados antigos ao próximo usuário que entrar no sistema.
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='patrimonio' and column_name='user_id') then
    raise exception 'Antes de instalar os planos, adicione patrimonio.user_id (uuid) e vincule os dados existentes aos respectivos auth.users.';
  end if;
  if exists (select 1 from public.patrimonio where user_id is null) then
    raise exception 'Existem patrimônios sem proprietário. Preencha patrimonio.user_id antes de instalar os planos.';
  end if;
end $$;
alter table public.patrimonio alter column user_id set default auth.uid();
alter table public.patrimonio alter column user_id set not null;
create index if not exists patrimonio_user_idx on public.patrimonio(user_id);
create index if not exists documentos_patrimonio_idx on public.documentos_casa(patrimonio_id);

create table public.billing_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan text not null check (plan in ('basico','pro')),
  status text not null default 'creating' check (status in ('creating','pending','authorized','paused','cancelled','failed')),
  provider_id text unique,
  checkout_url text,
  provider_updated_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index billing_one_open_subscription on public.billing_subscriptions(user_id)
  where status in ('creating','pending','authorized','paused');
create index billing_subscriptions_user_idx on public.billing_subscriptions(user_id);
create table public.billing_payments (
  provider_payment_id text primary key,
  subscription_id uuid not null references public.billing_subscriptions(id),
  invoice_id text not null,
  status text not null,
  period_start timestamptz not null,
  period_end timestamptz not null check (period_end > period_start),
  provider_updated_at timestamptz not null
);
create index billing_payments_subscription_idx on public.billing_payments(subscription_id);
alter table public.billing_subscriptions enable row level security;
alter table public.billing_payments enable row level security;
revoke all on public.billing_subscriptions, public.billing_payments from anon, authenticated;
grant all on public.billing_subscriptions, public.billing_payments to service_role;

create function public.billing_entitlement(p_user uuid)
returns table(plan text, valid_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select s.plan, max(p.period_end) from public.billing_payments p
  join public.billing_subscriptions s on s.id=p.subscription_id
  where s.user_id=p_user and p.status='approved' and p.period_start<=now() and p.period_end>now()
  group by s.plan order by (s.plan='pro') desc limit 1
$$;

create function public.billing_claim_checkout(p_user uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.billing_subscriptions; fresh boolean := false;
begin
  if p_plan not in ('basico','pro') then raise exception 'Plano inválido'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 491));
  select * into item from public.billing_subscriptions where user_id=p_user and status in ('creating','pending','authorized','paused');
  if not found then
    insert into public.billing_subscriptions(user_id,plan) values(p_user,p_plan) returning * into item;
    fresh := true;
  end if;
  return jsonb_build_object('subscription',to_jsonb(item),'created',fresh);
end $$;

-- Atualizações fora de ordem não podem restaurar um pagamento estornado.
create function public.billing_record_payment(p_payment jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.billing_payments as existing
    (provider_payment_id,subscription_id,invoice_id,status,period_start,period_end,provider_updated_at)
  values(p_payment->>'provider_payment_id',(p_payment->>'subscription_id')::uuid,p_payment->>'invoice_id',
    p_payment->>'status',(p_payment->>'period_start')::timestamptz,(p_payment->>'period_end')::timestamptz,(p_payment->>'provider_updated_at')::timestamptz)
  on conflict (provider_payment_id) do update set status=excluded.status, provider_updated_at=excluded.provider_updated_at
    where existing.subscription_id=excluded.subscription_id and existing.provider_updated_at<=excluded.provider_updated_at
      and (existing.status not in ('refunded','charged_back') or excluded.status in ('refunded','charged_back'));
end $$;

create function public.billing_record_subscription(p_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.billing_subscriptions set provider_id=p_data->>'provider_id',status=p_data->>'status',
    checkout_url=p_data->>'checkout_url',provider_updated_at=(p_data->>'provider_updated_at')::timestamptz
  where id=p_id and (provider_id is null or provider_id=p_data->>'provider_id')
    and (provider_updated_at is null or provider_updated_at<=(p_data->>'provider_updated_at')::timestamptz)
    and (status<>'cancelled' or p_data->>'status'='cancelled');
end $$;

create function public.my_plan()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := auth.uid(); current_plan text; expires timestamptz; assets bigint; docs bigint; counts jsonb; sub jsonb;
begin
  if uid is null then raise exception 'Faça login para consultar seu plano'; end if;
  select plan,valid_until into current_plan,expires from public.billing_entitlement(uid);
  current_plan := coalesce(current_plan,'free');
  select count(*) into assets from public.patrimonio where user_id=uid;
  select count(*) into docs from public.documentos_casa d join public.patrimonio p on p.id=d.patrimonio_id where p.user_id=uid;
  select coalesce(jsonb_object_agg(id::text,n),'{}') into counts from (
    select p.id,count(d.id) n from public.patrimonio p left join public.documentos_casa d on d.patrimonio_id=p.id where p.user_id=uid group by p.id
  ) c;
  select jsonb_build_object('plan',plan,'status',status) into sub from public.billing_subscriptions
    where user_id=uid order by (status in ('creating','pending','authorized','paused')) desc, created_at desc limit 1;
  return jsonb_build_object('plan',current_plan,'valid_until',expires,'assets',assets,'documents',docs,'documents_by_asset',counts,
    'asset_limit',case current_plan when 'free' then 1 when 'basico' then 3 else null end,
    'document_limit',case when current_plan='pro' then null else 5 end,'subscription',sub);
end $$;

create function public.enforce_plan_quota()
returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid; current_plan text; used bigint; maximum integer;
begin
  if tg_table_name='patrimonio' then
    if tg_op='UPDATE' then
      if new.user_id is distinct from old.user_id then raise exception 'Não é permitido transferir o proprietário do patrimônio'; end if;
      return new;
    end if;
    uid := new.user_id;
  else
    if tg_op='UPDATE' then
      if new.patrimonio_id is distinct from old.patrimonio_id or new.caminho_arquivo is distinct from old.caminho_arquivo then
        raise exception 'Não é permitido transferir o documento';
      end if;
      return new;
    end if;
    select user_id into uid from public.patrimonio where id=new.patrimonio_id;
  end if;
  if uid is null or (auth.uid() is not null and uid<>auth.uid()) then raise exception 'Proprietário inválido'; end if;
  -- Serializa inclusive duas abas enviando novos registros ao mesmo tempo.
  perform pg_advisory_xact_lock(hashtextextended(uid::text, 492));
  select plan into current_plan from public.billing_entitlement(uid);
  current_plan := coalesce(current_plan,'free');
  if current_plan='pro' then return new; end if;
  if tg_table_name='patrimonio' then
    maximum := case when current_plan='basico' then 3 else 1 end;
    select count(*) into used from public.patrimonio where user_id=uid;
    if used>=maximum then raise exception 'Limite de patrimônios atingido. Veja os planos em Configurações.'; end if;
  else
    if current_plan='free' then
      select count(*) into used from public.documentos_casa d join public.patrimonio p on p.id=d.patrimonio_id where p.user_id=uid;
    else
      select count(*) into used from public.documentos_casa where patrimonio_id=new.patrimonio_id;
    end if;
    if used>=5 then raise exception 'Limite de documentos atingido. Veja os planos em Configurações.'; end if;
  end if;
  return new;
end $$;
create trigger enforce_asset_plan before insert or update on public.patrimonio for each row execute function public.enforce_plan_quota();
create trigger enforce_document_plan before insert or update on public.documentos_casa for each row execute function public.enforce_plan_quota();

-- As políticas restritivas também limitam eventuais políticas permissivas antigas.
alter table public.patrimonio enable row level security;
create policy plan_asset_owner_guard on public.patrimonio as restrictive for all to authenticated
  using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy plan_asset_owner_access on public.patrimonio for all to authenticated
  using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy plan_asset_no_anon on public.patrimonio as restrictive for all to anon using(false) with check(false);
alter table public.documentos_casa enable row level security;
create policy plan_document_owner_guard on public.documentos_casa as restrictive for all to authenticated
  using (exists(select 1 from public.patrimonio p where p.id=patrimonio_id and p.user_id=auth.uid()))
  with check (exists(select 1 from public.patrimonio p where p.id=patrimonio_id and p.user_id=auth.uid()));
create policy plan_document_owner_access on public.documentos_casa for all to authenticated
  using (exists(select 1 from public.patrimonio p where p.id=patrimonio_id and p.user_id=auth.uid()))
  with check (exists(select 1 from public.patrimonio p where p.id=patrimonio_id and p.user_id=auth.uid()));
create policy plan_document_no_anon on public.documentos_casa as restrictive for all to anon using(false) with check(false);

-- Um arquivo novo exige primeiro reservar uma vaga na tabela de documentos.
create function public.owns_document_path(path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.documentos_casa d join public.patrimonio p on p.id=d.patrimonio_id
    where d.caminho_arquivo=path and p.user_id=auth.uid())
$$;
create policy plan_storage_guard on storage.objects as restrictive for all to authenticated
  using(bucket_id<>'documentos' or public.owns_document_path(name))
  with check(bucket_id<>'documentos' or public.owns_document_path(name));
create policy plan_storage_access on storage.objects for all to authenticated
  using(bucket_id='documentos' and public.owns_document_path(name))
  with check(bucket_id='documentos' and public.owns_document_path(name));
create policy plan_storage_no_anon on storage.objects as restrictive for all to anon
  using(bucket_id<>'documentos') with check(bucket_id<>'documentos');
update storage.buckets set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf','image/png','image/jpeg'] where id='documentos';

revoke all on function public.billing_entitlement(uuid),public.billing_claim_checkout(uuid,text),public.billing_record_payment(jsonb),public.billing_record_subscription(uuid,jsonb),public.enforce_plan_quota() from public,anon,authenticated;
grant execute on function public.billing_entitlement(uuid),public.billing_claim_checkout(uuid,text),public.billing_record_payment(jsonb),public.billing_record_subscription(uuid,jsonb) to service_role;
revoke all on function public.my_plan(),public.owns_document_path(text) from public,anon;
grant execute on function public.my_plan(),public.owns_document_path(text) to authenticated;
commit;

begin;

-- O bucket aceita o maior arquivo; as regras abaixo aplicam o limite de cada plano.
update storage.buckets set file_size_limit=1073741824 where id='documentos';

create or replace function public.enforce_pro_asset_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare current_plan text; used bigint;
begin
  select plan into current_plan from public.billing_entitlement(new.user_id);
  if coalesce(current_plan,'free')='pro' then
    select count(*) into used from public.patrimonio where user_id=new.user_id;
    if used >= 15 then raise exception 'Limite de 15 patrimônios do plano Pro atingido.'; end if;
  end if;
  return new;
end $$;
drop trigger if exists enforce_pro_asset_limit on public.patrimonio;
create trigger enforce_pro_asset_limit before insert on public.patrimonio for each row execute function public.enforce_pro_asset_limit();

create or replace function public.enforce_storage_plan_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid; current_plan text; used bigint; maximum bigint;
begin
  select user_id into uid from public.patrimonio where id=new.patrimonio_id;
  select plan into current_plan from public.billing_entitlement(uid);
  current_plan := coalesce(current_plan,'free');
  maximum := case current_plan when 'basico' then 104857600 when 'pro' then 1073741824 else 52428800 end;
  select coalesce(sum(d.tamanho),0) into used from public.documentos_casa d join public.patrimonio p on p.id=d.patrimonio_id where p.user_id=uid;
  if used + new.tamanho > maximum then raise exception 'Limite de armazenamento do plano atingido.'; end if;
  return new;
end $$;
drop trigger if exists enforce_storage_plan_limit on public.documentos_casa;
create trigger enforce_storage_plan_limit before insert on public.documentos_casa for each row execute function public.enforce_storage_plan_limit();
commit;

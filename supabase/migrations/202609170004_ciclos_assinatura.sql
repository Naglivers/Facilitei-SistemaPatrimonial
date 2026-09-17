begin;
alter table public.billing_subscriptions add column if not exists billing_cycle text not null default 'mensal'
  check (billing_cycle in ('mensal','trimestral','semestral','anual'));

create or replace function public.billing_claim_checkout(p_user uuid, p_plan text, p_cycle text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.billing_subscriptions; fresh boolean := false;
begin
  if p_plan not in ('basico','pro') or p_cycle not in ('mensal','trimestral','semestral','anual') then raise exception 'Plano ou período inválido'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 491));
  select * into item from public.billing_subscriptions where user_id=p_user and status in ('creating','pending','authorized','paused');
  if not found then insert into public.billing_subscriptions(user_id,plan,billing_cycle) values(p_user,p_plan,p_cycle) returning * into item; fresh := true; end if;
  return jsonb_build_object('subscription',to_jsonb(item),'created',fresh);
end $$;

create or replace function public.billing_claim_pix(p_user uuid, p_plan text, p_cycle text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.billing_subscriptions; fresh boolean := false;
begin
  if p_plan not in ('basico','pro') or p_cycle not in ('mensal','trimestral','semestral','anual') then raise exception 'Plano ou período inválido'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 491));
  select * into item from public.billing_subscriptions where user_id=p_user and status in ('creating','pending','authorized','paused');
  if not found then insert into public.billing_subscriptions(user_id,plan,provider_type,billing_cycle) values(p_user,p_plan,'pix',p_cycle) returning * into item; fresh := true; end if;
  return jsonb_build_object('subscription',to_jsonb(item),'created',fresh);
end $$;

revoke all on function public.billing_claim_checkout(uuid,text), public.billing_claim_pix(uuid,text) from public,anon,authenticated;
revoke all on function public.billing_claim_checkout(uuid,text,text), public.billing_claim_pix(uuid,text,text) from public,anon,authenticated;
grant execute on function public.billing_claim_checkout(uuid,text,text), public.billing_claim_pix(uuid,text,text) to service_role;
commit;

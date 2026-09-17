begin;

alter table public.billing_subscriptions
  add column if not exists provider_type text not null default 'subscription'
  check (provider_type in ('subscription','pix'));

create function public.billing_claim_pix(p_user uuid, p_plan text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.billing_subscriptions; fresh boolean := false;
begin
  if p_plan not in ('basico','pro') then raise exception 'Plano inválido'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 491));
  select * into item from public.billing_subscriptions
    where user_id=p_user and status in ('creating','pending','authorized','paused');
  if not found then
    insert into public.billing_subscriptions(user_id,plan,provider_type)
      values(p_user,p_plan,'pix') returning * into item;
    fresh := true;
  end if;
  return jsonb_build_object('subscription',to_jsonb(item),'created',fresh);
end $$;

create function public.billing_record_pix_order(p_id uuid, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.billing_subscriptions set provider_id=p_data->>'provider_id', status=p_data->>'status',
    checkout_url=p_data->>'checkout_url', provider_updated_at=(p_data->>'provider_updated_at')::timestamptz
  where id=p_id and provider_type='pix' and (provider_id is null or provider_id=p_data->>'provider_id');
end $$;

create function public.billing_record_pix_payment(p_id uuid, p_payment jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.billing_payments as existing
    (provider_payment_id,subscription_id,invoice_id,status,period_start,period_end,provider_updated_at)
  values(p_payment->>'provider_payment_id',p_id,p_payment->>'invoice_id','approved',
    (p_payment->>'period_start')::timestamptz,(p_payment->>'period_end')::timestamptz,(p_payment->>'provider_updated_at')::timestamptz)
  on conflict (provider_payment_id) do update set status='approved',provider_updated_at=excluded.provider_updated_at
    where existing.subscription_id=excluded.subscription_id and existing.provider_updated_at<=excluded.provider_updated_at;
  update public.billing_subscriptions set status='cancelled',provider_updated_at=(p_payment->>'provider_updated_at')::timestamptz
    where id=p_id and provider_type='pix';
end $$;

revoke all on function public.billing_claim_pix(uuid,text),public.billing_record_pix_order(uuid,jsonb),public.billing_record_pix_payment(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.billing_claim_pix(uuid,text),public.billing_record_pix_order(uuid,jsonb),public.billing_record_pix_payment(uuid,jsonb) to service_role;
commit;

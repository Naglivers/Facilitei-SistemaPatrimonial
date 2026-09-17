create table if not exists public.support_tickets (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  assunto text not null check (char_length(btrim(assunto)) between 3 and 160),
  categoria text not null default 'geral' check (categoria in ('geral', 'conta', 'pagamentos', 'patrimonios', 'documentos', 'erro')),
  mensagem text not null check (char_length(btrim(mensagem)) between 10 and 4000),
  status text not null default 'aberto' check (status in ('aberto', 'em_andamento', 'resolvido', 'fechado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists support_tickets_user_created_idx on public.support_tickets(user_id, created_at desc);

create or replace function public.set_support_ticket_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists support_tickets_updated_at on public.support_tickets;
create trigger support_tickets_updated_at before update on public.support_tickets
for each row execute function public.set_support_ticket_updated_at();

alter table public.support_tickets enable row level security;

drop policy if exists "Usuários veem seus tickets" on public.support_tickets;
create policy "Usuários veem seus tickets" on public.support_tickets
for select to authenticated using (user_id = auth.uid());

drop policy if exists "Usuários abrem tickets" on public.support_tickets;
create policy "Usuários abrem tickets" on public.support_tickets
for insert to authenticated with check (user_id = auth.uid());

revoke update, delete on public.support_tickets from authenticated;

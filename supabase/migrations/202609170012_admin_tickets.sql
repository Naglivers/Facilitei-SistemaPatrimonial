create table if not exists public.support_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.support_admins enable row level security;
revoke all on public.support_admins from anon, authenticated;

create or replace function public.is_support_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.support_admins where user_id = auth.uid());
$$;

grant execute on function public.is_support_admin() to authenticated;

drop policy if exists "Administradores veem tickets" on public.support_tickets;
create policy "Administradores veem tickets" on public.support_tickets
for select to authenticated using (public.is_support_admin());

drop policy if exists "Administradores atualizam tickets" on public.support_tickets;
create policy "Administradores atualizam tickets" on public.support_tickets
for update to authenticated using (public.is_support_admin()) with check (public.is_support_admin());

create table if not exists public.support_ticket_messages (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.support_tickets(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mensagem text not null check (char_length(btrim(mensagem)) between 1 and 4000),
  is_admin boolean not null default public.is_support_admin(),
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_messages_ticket_idx on public.support_ticket_messages(ticket_id, created_at);
alter table public.support_ticket_messages enable row level security;

create policy "Dono ve respostas do ticket" on public.support_ticket_messages
for select to authenticated using (
  public.is_support_admin() or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = auth.uid())
);

create policy "Administrador responde tickets" on public.support_ticket_messages
for insert to authenticated with check (public.is_support_admin() and is_admin = true);

-- Depois de rodar esta migration, substitua pelo seu e-mail e execute no SQL Editor:
-- insert into public.support_admins (user_id)
-- select id from auth.users where email = 'SEU_EMAIL_AQUI'
-- on conflict do nothing;

-- Migração de isolamento de dados por usuário.
-- Execute no SQL Editor do projeto Supabase.
-- Os registros já existentes serão vinculados a lucasventura06@gmail.com.

begin;

-- 1. Adiciona o vínculo com auth.users nas quatro tabelas.
alter table public.casa add column if not exists user_id uuid;
alter table public.pagamentos_casa add column if not exists user_id uuid;
alter table public.gastos_casa add column if not exists user_id uuid;
alter table public.documentos_casa add column if not exists user_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'casa_user_id_fkey') then
    alter table public.casa add constraint casa_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pagamentos_casa_user_id_fkey') then
    alter table public.pagamentos_casa add constraint pagamentos_casa_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gastos_casa_user_id_fkey') then
    alter table public.gastos_casa add constraint gastos_casa_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'documentos_casa_user_id_fkey') then
    alter table public.documentos_casa add constraint documentos_casa_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- 2. Atribui os registros antigos ao usuário informado.
do $$
declare
  legacy_owner uuid;
begin
  select id into legacy_owner from auth.users where email = 'lucasventura06@gmail.com';
  if legacy_owner is null then
    raise exception 'A conta lucasventura06@gmail.com não existe em auth.users. Crie-a/confirme-a antes de executar a migração.';
  end if;

  update public.casa set user_id = legacy_owner where user_id is null;

  -- Tabelas filhas herdam o proprietário da casa correspondente.
  update public.pagamentos_casa p set user_id = c.user_id
  from public.casa c where c.id = p.casa_id and p.user_id is null;
  update public.gastos_casa g set user_id = c.user_id
  from public.casa c where c.id = g.casa_id and g.user_id is null;
  update public.documentos_casa d set user_id = c.user_id
  from public.casa c where c.id = d.casa_id and d.user_id is null;
end $$;

-- 3. Todos os registros futuros pertencem automaticamente ao usuário autenticado.
alter table public.casa alter column user_id set default auth.uid();
alter table public.pagamentos_casa alter column user_id set default auth.uid();
alter table public.gastos_casa alter column user_id set default auth.uid();
alter table public.documentos_casa alter column user_id set default auth.uid();

alter table public.casa alter column user_id set not null;
alter table public.pagamentos_casa alter column user_id set not null;
alter table public.gastos_casa alter column user_id set not null;
alter table public.documentos_casa alter column user_id set not null;

create index if not exists casa_user_id_idx on public.casa(user_id);
create index if not exists pagamentos_casa_user_id_idx on public.pagamentos_casa(user_id);
create index if not exists gastos_casa_user_id_idx on public.gastos_casa(user_id);
create index if not exists documentos_casa_user_id_idx on public.documentos_casa(user_id);

-- 4. Remove políticas anteriores dessas quatro tabelas para não deixar acesso amplo ativo.
do $$
declare item record;
begin
  for item in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('casa', 'pagamentos_casa', 'gastos_casa', 'documentos_casa')
  loop
    execute format('drop policy if exists %I on public.%I', item.policyname, item.tablename);
  end loop;
end $$;

alter table public.casa enable row level security;
alter table public.pagamentos_casa enable row level security;
alter table public.gastos_casa enable row level security;
alter table public.documentos_casa enable row level security;

-- Casas: cada pessoa só vê e gerencia os próprios imóveis.
create policy "Usuário gerencia próprias casas"
on public.casa for all to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- Tabelas filhas: além do user_id, impedem vincular dados à casa de outro usuário.
create policy "Usuário gerencia próprios pagamentos"
on public.pagamentos_casa for all to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (select 1 from public.casa c where c.id = casa_id and c.user_id = auth.uid())
);

create policy "Usuário gerencia próprios gastos"
on public.gastos_casa for all to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (select 1 from public.casa c where c.id = casa_id and c.user_id = auth.uid())
);

create policy "Usuário gerencia próprios documentos"
on public.documentos_casa for all to authenticated
using (user_id = auth.uid())
with check (
  user_id = auth.uid()
  and exists (select 1 from public.casa c where c.id = casa_id and c.user_id = auth.uid())
);

commit;

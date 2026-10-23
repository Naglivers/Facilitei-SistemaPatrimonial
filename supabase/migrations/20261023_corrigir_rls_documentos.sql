-- Corrige o RLS de documentos e do bucket privado "documentos".
-- O aplicativo cria primeiro o registro em documentos_casa e, em seguida,
-- envia o arquivo ao Storage usando o mesmo caminho_arquivo.

begin;

update public.documentos_casa d
set user_id = p.user_id
from public.patrimonio p
where p.id = d.patrimonio_id
  and d.user_id is null;

alter table public.documentos_casa enable row level security;

drop policy if exists "Usuário gerencia próprios documentos" on public.documentos_casa;
drop policy if exists plan_document_owner_guard on public.documentos_casa;
drop policy if exists plan_document_owner_access on public.documentos_casa;
drop policy if exists plan_document_no_anon on public.documentos_casa;
drop policy if exists documentos_do_proprietario on public.documentos_casa;

create policy documentos_do_proprietario
on public.documentos_casa
for all to authenticated
using (
  user_id = auth.uid()
  and exists (
    select 1 from public.patrimonio p
    where p.id = patrimonio_id and p.user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.patrimonio p
    where p.id = patrimonio_id and p.user_id = auth.uid()
  )
);

drop policy if exists plan_storage_guard on storage.objects;
drop policy if exists plan_storage_access on storage.objects;
drop policy if exists plan_storage_no_anon on storage.objects;
drop policy if exists documentos_storage_do_proprietario on storage.objects;

create policy documentos_storage_do_proprietario
on storage.objects
for all to authenticated
using (
  bucket_id = 'documentos'
  and exists (
    select 1
    from public.documentos_casa d
    join public.patrimonio p on p.id = d.patrimonio_id
    where d.caminho_arquivo = name and p.user_id = auth.uid()
  )
)
with check (
  bucket_id = 'documentos'
  and exists (
    select 1
    from public.documentos_casa d
    join public.patrimonio p on p.id = d.patrimonio_id
    where d.caminho_arquivo = name and p.user_id = auth.uid()
  )
);

commit;

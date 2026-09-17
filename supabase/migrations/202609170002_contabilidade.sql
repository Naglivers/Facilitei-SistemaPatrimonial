create table public.contabilidade_perfil (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  razao_social text not null,
  documento_fiscal text not null,
  regime_tributario text,
  inscricao text,
  cep text,
  logradouro text,
  numero text,
  cidade_uf text,
  contador_nome text,
  contador_email text,
  contador_telefone text,
  observacoes text,
  updated_at timestamptz not null default now(),
  constraint contabilidade_documento_format check (length(regexp_replace(documento_fiscal, '[^0-9]', '', 'g')) in (11,14))
);

alter table public.contabilidade_perfil enable row level security;
revoke all on public.contabilidade_perfil from anon;
grant select, insert, update, delete on public.contabilidade_perfil to authenticated;

create policy contabilidade_perfil_proprio on public.contabilidade_perfil
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.atualiza_data_contabilidade()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger contabilidade_perfil_updated_at before update on public.contabilidade_perfil
  for each row execute function public.atualiza_data_contabilidade();

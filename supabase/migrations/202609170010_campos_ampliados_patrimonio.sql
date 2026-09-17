-- Campos complementares para cada tipo de patrimônio.
alter table public.patrimonio
  add column if not exists descricao text,
  add column if not exists data_aquisicao date,
  add column if not exists observacoes text,
  add column if not exists matricula text,
  add column if not exists inscricao_iptu text,
  add column if not exists area_m2 numeric(12,2),
  add column if not exists quartos integer,
  add column if not exists banheiros integer,
  add column if not exists placa text,
  add column if not exists renavam text,
  add column if not exists marca_modelo text,
  add column if not exists ano_fabricacao integer,
  add column if not exists cor text,
  add column if not exists documento_referencia text;

create index if not exists patrimonio_placa_idx on public.patrimonio(placa)
  where placa is not null;

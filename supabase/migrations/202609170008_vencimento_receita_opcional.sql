-- Permite informar vencimento em receitas avulsas e mantém a exigência para recorrentes.
alter table public.pagamentos_casa
  drop constraint if exists pagamentos_casa_vencimento_por_tipo_check;

alter table public.pagamentos_casa
  add constraint pagamentos_casa_vencimento_por_tipo_check
  check (tipo <> 'recorrente' or data_vencimento is not null);

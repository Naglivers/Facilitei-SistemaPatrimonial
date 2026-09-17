-- Data opcional para programar e lembrar gastos futuros.
alter table public.gastos_casa
  add column if not exists data_vencimento date;

create index if not exists gastos_casa_data_vencimento_idx
  on public.gastos_casa (data_vencimento)
  where data_vencimento is not null;

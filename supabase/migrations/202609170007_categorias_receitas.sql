-- Categorias para receitas, com uma categoria padrão para os lançamentos antigos.
alter table public.pagamentos_casa
  add column if not exists categoria text not null default 'OUTRAS RECEITAS';

update public.pagamentos_casa
set categoria = upper(regexp_replace(trim(coalesce(categoria, 'OUTRAS RECEITAS')), '\\s+', ' ', 'g'));

create or replace function public.normalizar_categoria_financeira()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.categoria := upper(regexp_replace(trim(coalesce(new.categoria, 'SEM CATEGORIA')), '\\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists normalizar_categoria_gasto_trigger on public.gastos_casa;
create trigger normalizar_categoria_gasto_trigger
before insert or update of categoria on public.gastos_casa
for each row execute function public.normalizar_categoria_financeira();

drop trigger if exists normalizar_categoria_pagamento_trigger on public.pagamentos_casa;
create trigger normalizar_categoria_pagamento_trigger
before insert or update of categoria on public.pagamentos_casa
for each row execute function public.normalizar_categoria_financeira();

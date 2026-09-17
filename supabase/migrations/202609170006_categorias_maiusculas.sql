-- Padroniza categorias já existentes e futuras para evitar duplicidades como
-- "manutenção", "MANUTENÇÃO" e " Manutenção ".
update public.gastos_casa
set categoria = upper(regexp_replace(trim(categoria), '\\s+', ' ', 'g'))
where categoria is not null
  and categoria is distinct from upper(regexp_replace(trim(categoria), '\\s+', ' ', 'g'));

create or replace function public.normalizar_categoria_gasto()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.categoria := upper(regexp_replace(trim(coalesce(new.categoria, '')), '\\s+', ' ', 'g'));
  return new;
end;
$$;

drop trigger if exists normalizar_categoria_gasto_trigger on public.gastos_casa;
create trigger normalizar_categoria_gasto_trigger
before insert or update of categoria on public.gastos_casa
for each row execute function public.normalizar_categoria_gasto();

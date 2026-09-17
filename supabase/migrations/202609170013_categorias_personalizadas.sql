create table public.categorias_personalizadas (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('income', 'expense')),
  nome text not null check (char_length(nome) between 1 and 80),
  created_at timestamptz not null default now(),
  unique (user_id, tipo, nome)
);

create function public.normalizar_categoria_personalizada()
returns trigger language plpgsql set search_path = public as $$
begin
  new.nome := upper(btrim(regexp_replace(new.nome, '[[:space:]]+', ' ', 'g')));
  return new;
end;
$$;

create trigger normalizar_categoria_personalizada_trigger
before insert or update on public.categorias_personalizadas
for each row execute function public.normalizar_categoria_personalizada();

alter table public.categorias_personalizadas enable row level security;
revoke all on public.categorias_personalizadas from anon, authenticated;
grant select, insert on public.categorias_personalizadas to authenticated;
grant usage, select on sequence public.categorias_personalizadas_id_seq to authenticated;
create policy "Usuários veem suas categorias" on public.categorias_personalizadas
for select to authenticated using (user_id = auth.uid());
create policy "Usuários cadastram suas categorias" on public.categorias_personalizadas
for insert to authenticated with check (user_id = auth.uid());

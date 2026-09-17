alter table public.gastos_casa add column if not exists data_pagamento date;
alter table public.pagamentos_casa add column if not exists data_lancamento date;

update public.pagamentos_casa
set data_lancamento = coalesce(data_lancamento, data_vencimento, data_recebimento, current_date)
where data_lancamento is null;

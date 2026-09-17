# Planos e pagamentos

O sistema oferece assinaturas mensais pelo Mercado Pago:

| Plano | Mensalidade | Patrimônios | Documentos |
| --- | ---: | --- | --- |
| Free | R$ 0,00 | 1 | Até 10 MB de arquivos |
| Básico | R$ 19,99 | Até 3 | Até 100 MB de arquivos |
| Pro | R$ 29,99 | Até 15 | Até 1 GB de arquivos |
| Infinite | Sob consulta | Ilimitados | Ilimitados |

Os limites são impostos no banco de dados. A tela apenas mostra o uso e evita tentativas desnecessárias. Assim, abrir várias abas ou alterar o código no navegador não permite ultrapassar a cota.

## Ativação

1. No Supabase, confira se `patrimonio.user_id` existe e se todos os registros existentes têm um proprietário. A migração interrompe a instalação se houver registros sem dono, para evitar que uma conta nova consiga acessar dados antigos.
2. Execute [a migração de planos](../supabase/migrations/202609160001_planos.sql) no SQL Editor do Supabase.
3. Faça o deploy das duas Edge Functions:

   ```powershell
   supabase functions deploy billing
   supabase functions deploy mercadopago-webhook
   ```

4. Configure os segredos no projeto Supabase. `SITE_URL` precisa ser a URL HTTPS pública e final do site, sem barra no fim. Não use `localhost`.

   ```powershell
   supabase secrets set MP_ACCESS_TOKEN="seu-access-token-de-producao" MP_COLLECTOR_ID="seu-id-de-vendedor" MP_WEBHOOK_SECRET="sua-assinatura-secreta" SITE_URL="https://seu-dominio.com"
   ```

5. No painel do Mercado Pago, habilite os eventos `subscription_preapproval`, `subscription_authorized_payment` e `payment`, apontando para:

   ```text
   https://SEU-PROJETO.supabase.co/functions/v1/mercadopago-webhook
   ```

   Copie a assinatura secreta gerada pelo Mercado Pago para `MP_WEBHOOK_SECRET`.
6. Faça uma assinatura de teste com as credenciais de teste do Mercado Pago. Depois confirme: o retorno abre Configurações, o plano aparece como ativo e os novos limites passam a valer.

## Regras de cobrança

O checkout cria uma assinatura mensal pendente e redireciona o usuário ao Mercado Pago. O acesso pago só é liberado após uma cobrança aprovada confirmada pelo webhook. A renovação automática ocorre no Mercado Pago.

Ao cancelar, o sistema interrompe as próximas cobranças e mantém o acesso até o fim do período já aprovado. Quando o período expira, os patrimônios e documentos permanecem disponíveis, mas novas inclusões voltam a obedecer ao plano Free.

Trocar de plano pede o cancelamento da assinatura atual antes de criar uma nova. A nova assinatura começa uma cobrança mensal integral; não há crédito automático do período anterior.

## Segurança incluída

- O access token do Mercado Pago fica apenas nos segredos da Edge Function.
- Webhooks exigem validação HMAC da assinatura `x-signature`.
- Cada evento consulta a API do Mercado Pago e confirma vendedor, valor, moeda, plano e referência antes de alterar o acesso.
- Eventos repetidos ou fora de ordem são idempotentes; um estorno não pode ser sobrescrito por uma notificação antiga.
- Os arquivos são reservados na tabela de documentos antes do envio ao Storage. Isso garante que o limite continue correto mesmo com duas abas ou com falha no upload.

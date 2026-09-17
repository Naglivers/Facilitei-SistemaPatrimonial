# Publicação do Facilitei nas lojas

O projeto já contém os aplicativos nativos Android e iPhone. Antes de gerar uma versão de loja, atualize os arquivos do aplicativo com:

```powershell
npm run mobile:sync
```

## Android — Google Play

1. Instale o Android Studio e abra o projeto com `npm run android:open`.
2. Em **Build > Generate Signed Bundle / APK**, gere um **Android App Bundle (.aab)** assinado com uma chave de produção. Guarde essa chave em local seguro: ela será necessária em toda atualização futura.
3. Crie a conta no [Google Play Console](https://play.google.com/console), crie o aplicativo e envie o `.aab` para testes internos antes da produção.
4. Preencha a ficha da loja: ícone, capturas de tela, descrição, e-mail de suporte, política de privacidade e formulário de segurança dos dados.

## iPhone — App Store

1. Em um Mac com Xcode instalado, execute `npm run ios:open`.
2. No Xcode, selecione uma equipe Apple Developer, defina o identificador `br.com.facilitei.patrimonio` e configure a assinatura automática.
3. Em **Product > Archive**, envie a versão para o App Store Connect.
4. No App Store Connect, complete a ficha da loja, privacidade, capturas de tela e envie para a revisão da Apple.

## Antes de enviar para revisão

- Use apenas URLs HTTPS no Supabase e no Mercado Pago.
- Configure no Supabase as URLs permitidas para o aplicativo e revise o login Google em dispositivos reais.
- Para o login Google, crie clientes OAuth específicos para Android e iOS no Google Cloud. O cliente Android precisa do nome do pacote `br.com.facilitei.patrimonio` e da impressão digital SHA-1 da chave de assinatura; o cliente iOS precisa do identificador do pacote. O botão atual foi criado para navegador e deve ser trocado por autenticação nativa antes da revisão das lojas.
- Publique uma política de privacidade acessível por URL, incluindo o tratamento de dados patrimoniais e documentos enviados.
- Teste cadastro, login, recuperação de sessão, assinaturas, envio e abertura de documentos em Android e iPhone.
- Informe à Apple e ao Google que o app processa dados financeiros/patrimoniais e armazena documentos privados.

As assinaturas vendidas dentro do aplicativo precisam passar pela análise das regras de cobrança de cada loja. Revise o fluxo atual com Mercado Pago antes do envio, pois a Apple pode exigir compra dentro do app para recursos digitais.

# Instagram: como retomar

Status em 20/11/2026: **pronto no sistema, oculto para os clientes**.
O código está completo e testado. O que falta é só a liberação da Meta, que depende de um CNPJ.

---

## O que já está feito

### No sistema (código)
- **Login fácil pelo Instagram** (Business Login for Instagram): o cliente clica em *Conectar*, entra com usuário e senha na tela oficial do Instagram e toca em *Permitir*. Não precisa de Página do Facebook. A senha nunca passa pelo nosso servidor.
- **Conexão antiga pelo Facebook** continua funcionando como alternativa (exige Página ligada ao Instagram). É usada automaticamente se o passo 2 da configuração ficar em branco.
- **Renovação automática do acesso**: o token do Instagram vale 60 dias; o sistema renova sozinho os que vencem em menos de 20 dias (a cada 12 horas).
- **Webhook protegido**: só aceita mensagens assinadas pela Meta (confere a chave do app e a do Instagram).
- **Telas para o cliente**: tela de conectar com 3 lembretes, página de passo a passo (`/instagram/ajuda`) e mensagens de erro que apontam para a ajuda.
- **Chave liga/desliga**: em *Administração > Configurações > Instagram*, "Mostrar o Instagram para os clientes". Desligada, o cliente vê "Em breve" e não consegue criar robô de Instagram. O admin sempre vê e consegue testar.

Arquivos principais: `instagram.js`, `modulos/instagram-api.js`, `views/instagram-conectar.ejs`, `views/instagram-ajuda.ejs`, configuração em `modulos/usuarios.js` e `views/admin-config.ejs`.

### Na Meta (developers.facebook.com, app "CalixtoSystem", ID 1456157699509257)
- [x] App do tipo Empresa criado, com política de privacidade, termos e URL de exclusão de dados
- [x] Produto Instagram adicionado (API com login do Instagram)
- [x] ID e chave secreta do app e do Instagram salvos em *Administração > Configurações*
- [ ] Conferir: URL de redirecionamento cadastrada em *Configurar login comercial do Instagram*: `https://calixtosystem.com.br/instagram/auth/callback`
- [ ] Conferir: webhook cadastrado (*Configurar webhooks*): URL `https://calixtosystem.com.br/instagram/webhook`, token igual ao do painel, campo **messages** ativado
- [ ] Conferir: sua conta adicionada como **Testador do Instagram** (*Funções do app > Funções*) e convite aceito no app do Instagram (*Configurações > Apps e sites > Convites de testador*)

---

## O que falta (em ordem)

### 1. CNPJ
A Meta só libera para todos os clientes depois de verificar uma empresa.
Opções: abrir o próprio CNPJ (ME no Simples, com contador, aceita atividade de software) ou usar o CNPJ de um familiar com acordo por escrito.

### 2. Verificação da empresa
*Configurações do negócio > Central de Segurança > Verificação da empresa > Iniciar verificação.*
Dados iguais aos do cartão CNPJ; documento (cartão CNPJ ou contrato social) e comprovante de endereço ou telefone no nome da empresa. Leva de 2 a 10 dias úteis.

### 3. Análise do app (acesso avançado)
*Análise do app > Permissões e recursos*: pedir **acesso avançado** a:
- `instagram_business_basic`
- `instagram_business_manage_messages`

Preparar antes:
- **Usuário de teste no sistema** para o analista: criar em *Administração* com plano vitalício e **sem** "trocar senha no próximo login", com um robô de Instagram e um fluxo simples (boas-vindas + menu).
- **Textos de "Uso permitido" e "Instruções da análise"** (em inglês): estão na conversa com o Claude de 20/11/2026; peça de novo se precisar.
- **Vídeo de 1 a 3 minutos**: login no sistema, *Conectar* > *Entrar com o Instagram*, tela de permissões da Meta, tela "Instagram conectado", mensagem chegando de outra conta e o robô respondendo. Usar o mesmo vídeo nas duas permissões.

Resposta da Meta: de 1 a 7 dias. Se recusar, ela informa o motivo.

### 4. Publicar o app
No topo do painel da Meta, mudar de *Desenvolvimento* para **Ao vivo**.

### 5. Liberar no sistema
*Administração > Configurações > Instagram* > ligar **"Mostrar o Instagram para os clientes"**.
Pronto: qualquer cliente cria um robô de Instagram e conecta sozinho.

---

## Teste rápido depois de liberar
1. Crie um robô de Instagram e clique em *Conectar* > *Entrar com o Instagram*.
2. Entre com uma conta profissional e toque em *Permitir*.
3. De outra conta, mande um Direct. O robô deve responder em segundos.
4. Se não responder: `pm2 logs CalixtoCore --lines 80` na VPS e procure linhas com `[INSTA`.

## Antes de liberar, se quiser atender alguém já
Adicione o @ do cliente como **Testador do Instagram** no app da Meta. Ele aceita o convite no app do Instagram. Depois, ligue a chave "Mostrar o Instagram para os clientes" por alguns minutos, peça para ele criar o robô de Instagram e conectar, e desligue de novo (quem já conectou continua funcionando com a chave desligada).

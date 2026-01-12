
---

# 📘 MANUAL TÉCNICO CALIXTOMASTERBOT V9.0

## CAPÍTULO 1: ARSENAL TECNOLÓGICO, INSTALAÇÃO E DEPENDÊNCIAS

Este capítulo disseca as tecnologias que compõem o motor do Calixto OmniSystem. Entender essas peças é fundamental para qualquer manutenção, upgrade ou correção de bugs críticos.

---

### 1.1 O Motor de Comunicação: @whiskeysockets/baileys

A peça mais crítica do sistema. Diferente da API Oficial da Meta (que cobra por mensagem), o Baileys simula um navegador real conectando-se ao WhatsApp Web via WebSocket.

* **Para que serve:** É a ponte entre o seu código Node.js e os servidores do WhatsApp. Ele gerencia a criptografia de ponta a ponta, envia mensagens, recebe status de leitura e manipula arquivos de mídia.
* **Instalação:**
```powershell
npm install @whiskeysockets/baileys

```


* **Configuração:**
No arquivo `modulos/whatsapp.js`, é instanciado através da função `makeWASocket`. Exige uma estratégia de autenticação (`useMultiFileAuthState`) para salvar as credenciais na pasta `/sessions` ou `/clientes`.
* **Nota de Versão:** Estamos usando a versão `^7.0.0-rc.9`. Isso indica uma versão "Release Candidate". É estável, mas requer atenção às atualizações de segurança do WhatsApp.

---

### 1.2 O Cérebro de Estado: Redis & IORedis

O CalixtoMasterBot utiliza uma **Arquitetura Híbrida**. Enquanto os dados vitais ficam no disco, o estado da conversa ("Onde o usuário está agora?") vive na memória RAM através do Redis.

* **Para que serve:**
1. **Velocidade:** Recupera o estado do cliente em 2 milissegundos.
2. **Sessão:** Evita leituras lentas no banco de dados principal a cada mensagem recebida.
3. **Filas (Bull):** Gerencia processos em segundo plano.


* **Instalação:**
O projeto possui duas bibliotecas (redundância ou legados de módulos diferentes):
```powershell
npm install redis ioredis

```


* **Configuração:**
Configurado no arquivo `modulos/redis.js`. Requer um servidor Redis rodando (geralmente na porta `6379`). Em produção, usa-se a string de conexão no `.env`.

---

### 1.3 O Gerenciador de Banco de Dados: Prisma ORM

O Prisma é o tradutor que permite que o código JavaScript converse com o banco de dados PostgreSQL sem precisar escrever SQL puro.

* **Para que serve:**
* **Segurança:** Previne injeção de SQL.
* **Tipagem:** Garante que se você pedir "nome do cliente", o banco não devolva um número.
* **Schema:** Define a estrutura do banco no arquivo `prisma/schema.prisma`.


* **Instalação:**
```powershell
npm install prisma --save-dev
npm install @prisma/client

```


* **Configuração:**
1. Definir modelos em `prisma/schema.prisma`.
2. Conectar via `.env` (`DATABASE_URL="postgresql://..."`).
3. Rodar `npx prisma generate` sempre que houver alteração.



---

### 1.4 A Interface em Tempo Real: Socket.io

Enquanto o Express serve as páginas, o Socket.io mantém o canal aberto entre o Navegador (Dashboard) e o Servidor.

* **Para que serve:**
* **QR Code Dinâmico:** Atualiza o QR Code na tela sem precisar dar F5 na página.
* **Status Online:** Mostra "Conectado" ou "Desconectado" instantaneamente no painel.
* **Logs:** Envia logs do terminal direto para a tela do administrador.


* **Instalação:**
```powershell
npm install socket.io

```


* **Configuração:**
Inicializado no `index.js` atrelado ao servidor HTTP (`server`). No frontend (`views`), o cliente se conecta para escutar eventos como `'qrcode'` ou `'connection-status'`.

---

### 1.5 O Motor Visual: EJS (Embedded JavaScript)

O sistema não usa React ou Vue complexos. Ele usa EJS para gerar HTML dinâmico direto no servidor (Server-Side Rendering).

* **Para que serve:** Permite injetar variáveis do Backend (ex: Lista de Clientes do banco) diretamente no HTML antes de enviar para o navegador. É o que faz o `dashboard.ejs` mostrar a tabela de usuários.
* **Instalação:**
```powershell
npm install ejs

```


* **Configuração:**
No `index.js`: `app.set('view engine', 'ejs');` e `app.set('views', './views');`.

---

### 1.6 Inteligência de Texto: String-Similarity

Uma ferramenta pequena, mas poderosa, usada no `engine.js` para o recurso de "Fuzzy Match".

* **Para que serve:** Permite que o bot entenda erros de digitação. Se o menu diz "Financeiro" e o usuário digita "finaceiro" ou "finan", essa biblioteca calcula a semelhança (0 a 1) e aceita a resposta se for parecida o suficiente.
* **Instalação:**
```powershell
npm install string-similarity

```



---

### 1.7 Utilitários do Sistema (Middleware & Helpers)

Dependências que atuam nos bastidores para manter a estabilidade.

* **Express (`^5.2.1`):** O servidor web. Estamos usando a versão 5 (moderna), que possui melhor tratamento de erros em promessas (Promises).
* **Dotenv:** Carrega variáveis sensíveis (senhas, portas) do arquivo `.env` para a memória, garantindo segurança.
* **Node-Cron:** O "Despertador". Executa tarefas agendadas (como limpeza de cache ou disparos programados) em horários específicos.
* **Pino:** Logger de alta performance. Substitui o `console.log` tradicional, gerando logs estruturados (JSON) que são mais leves e fáceis de analisar em caso de erro.
* **Multer / Express-Fileupload:** Gerenciam o upload de arquivos (áudios, imagens) que você sobe pelo painel para enviar nas mensagens.

---

### 1.8 Frontend Library: Drawflow (Visual)

*Nota: Não está no `package.json` pois é um script de frontend importado via CDN ou arquivo estático na pasta `public`, mas é vital citar.*

* **Para que serve:** É a biblioteca JavaScript que cria a interface de "nós e linhas" (Fluxograma) no seu navegador. Ele exporta um JSON que o `interpretador.js` lê para saber o que o bot deve fazer.
* **Configuração:** Arquivos localizados em `public/css/drawflow.css` e `public/js/drawflow.min.js`.

---

**Fim do Capítulo 1.**

CAPÍTULO 2: GUIAS OPERACIONAIS
A operação do Calixto OmniSystem não deve ser feita "no escuro". Existem procedimentos padrão para garantir que os dados não sejam corrompidos durante o início ou o encerramento do sistema.

2.1 GUIA DE INÍCIO (LAUNCH SEQUENCE)
Para colocar o sistema no ar, não basta apenas "rodar o código". Existe uma ordem de precedência que deve ser respeitada para evitar erros de conexão com o banco de dados.

2.1.1 Pré-voo (Checklist)
Antes de iniciar o bot, verifique se os sistemas de suporte estão ativos:

PostgreSQL: O serviço do banco de dados deve estar rodando (Porta 5432).

Redis: O servidor de memória deve estar acessível (Porta 6379). Se você não usa o Redis como serviço do Windows, inicie-o manualmente em um terminal separado.

2.1.2 Procedimento de Decolagem (Start)
No ambiente de produção, utilizamos o PM2 para gerenciar o processo. Nunca use node index.js diretamente, pois se o bot cair, ele não volta.

Comando Padrão:

PowerShell

npx pm2 start index.js --name "calixto-omnisystem"
npx pm2 start: Invoca o gerenciador.

index.js: O arquivo de entrada.

--name "calixto-omnisystem": Batiza o processo. Isso facilita identificá-lo nos logs depois.

Validação de Sucesso: Após o comando, uma tabela aparecerá. O status deve estar verde: online. Se estiver errored ou stopping, consulte o Guia de Monitoramento.

2.2 GUIA DE MONITORAMENTO (COCKPIT)
Uma vez no ar, você precisa saber o que está acontecendo. O sistema oferece duas visões: a Visão de Engenharia (Terminal) e a Visão de Controle (Dashboard).

2.2.1 A Visão de Engenharia (Logs em Tempo Real)
Para ver o "cérebro" do bot pensando, processando mensagens e erros:

Comando:

PowerShell

npx pm2 logs calixto-omnisystem --lines 50
--lines 50: Mostra as últimas 50 linhas do histórico imediato.

O que procurar:

[ENGINE]: Logs de processamento de fluxo (ex: "Cliente entrou no nó X").

[SISTEMA]: Logs de conexão (ex: "Conectado", "QR Code Gerado").

🔴 Vermelho: Erros críticos ou exceções não tratadas.

2.2.2 Painel de Instrumentos (PM2 Monit)
Para monitorar o consumo de recursos (CPU e RAM) e garantir que não há vazamento de memória:

Comando:

PowerShell

npx pm2 monit
Isso abre um painel gráfico dentro do terminal.

Esquerda: Lista de processos.

Direita Superior: Logs em tempo real.

Direita Inferior: Métricas de Saúde (Uso de Memória).

2.2.3 Visão de Controle (Dashboard Web)
A interface para o usuário final.

URL: http://localhost:3000/dashboard

Indicadores:

Status: Bolinha Verde (Online) ou Vermelha (Offline).

QR Code: Se o bot estiver desconectado, o código aparecerá aqui automaticamente via Socket.io.

2.3 GUIA DE STOP (ENCERRAMENTO)
Existem duas formas de parar o sistema: a graciosa e a forçada.

2.3.1 Parada Graciosa (Soft Stop)
Este é o método padrão. Ele envia um sinal (SIGINT) para o bot, permitindo que ele feche as conexões com o banco e salve os arquivos pendentes antes de desligar.

Comando:

PowerShell

npx pm2 stop calixto-omnisystem
Use este comando para manutenções rotineiras ou atualizações de código.

2.3.2 Extermínio de Processos (Kill / Force Stop)
Utilizado quando o bot trava, entra em loop infinito ou se torna um "Processo Zumbi" (continua rodando no fundo mesmo após o stop).

Passo 1: Matar o Gerenciador

PowerShell

npx pm2 kill
Passo 2: Varredura do Windows (Obrigatório em casos de Erro 515) O comando acima mata o gerenciador, mas às vezes o node.exe continua vivo segurando a porta do WhatsApp.

PowerShell

taskkill /F /IM node.exe
Repita este comando até receber a mensagem "ERRO: O processo... não foi encontrado". Isso garante que a memória está limpa.

2.4 GUIA DE RESET (EMERGÊNCIA)
Procedimentos para restaurar o sistema após falhas críticas.

2.4.1 Reset de Aplicação (Restart)
Use quando você altera o código (engine.js, fluxo.js) ou edita o arquivo .env.

PowerShell

npx pm2 restart calixto-omnisystem
Nota: Isso não desconecta o WhatsApp, apenas reinicia o software.

2.4.2 Reset de Sessão (A Cura do Erro 515)
Use quando o bot entra em "Loop de Conexão", pede QR Code repetidamente ou apresenta erro de descriptografia.

Pare o sistema (npx pm2 stop calixto-omnisystem).

Navegue até a pasta do projeto.

Delete a pasta sessions (ou auth_info_baileys dependendo da config).

Inicie novamente. Isso forçará a geração de um novo QR Code limpo.

2.4.3 Reset de Banco de Dados (Nuclear Option)
Use APENAS em ambiente de desenvolvimento ou se o banco estiver corrompido irremediavelmente. Isso apaga todos os clientes e fluxos.

Pare o sistema.

Execute o script de limpeza (se houver zerar_tudo.js) ou delete o arquivo do banco (se for SQLite).

Rode npx prisma db push para recriar as tabelas do zero.

**Fim do Capítulo 2.**

CAPÍTULO 3: INSTALAÇÃO EM PRODUÇÃO (WINDOWS SERVER)
Este capítulo marca a transição do ambiente de desenvolvimento para o ambiente de produção. Até o momento, o sistema foi operado via VS Code. No entanto, para um software de alta disponibilidade que deve operar 24/7 (SaaS), depender de uma interface gráfica (IDE) é um risco operacional.

Aqui, aprenderemos a desacoplar o CalixtoMasterBot da IDE e transformá-lo em um Serviço Nativo do Windows, que opera de forma "Headless" (sem interface), inicia automaticamente com o sistema operacional e possui persistência contra falhas de energia.

3.1 RODANDO SEM IDE (MODO HEADLESS)
O VS Code é uma ferramenta de escrita de código, não de execução de servidores. Ele consome memória RAM desnecessária apenas para renderizar a interface gráfica. Em um cenário profissional, o bot deve ser controlado exclusivamente via terminal (Command Line Interface).

3.1.1 O Conceito de "Serviço"
O objetivo desta etapa é configurar o bot para rodar nos bastidores, similar ao Antivírus ou aos Drivers do sistema: invisível ao usuário comum, mas sempre ativo e monitorando.

3.1.2 Preparando o Ambiente
Para executar comandos que alteram o registro de inicialização do Windows, é necessário elevar os privilégios de acesso:

Feche o VS Code completamente para garantir que nenhum arquivo esteja travado.

Pressione a tecla Windows e digite PowerShell.

CRUCIAL: Não clique apenas em abrir. Clique com o botão direito e selecione "Executar como Administrador".

3.1.3 Navegação via Terminal
Sem a barra lateral de arquivos do VS Code, a navegação entre pastas é feita via comandos. Utilize o comando cd (Change Directory) para entrar na pasta do projeto.

Comando: cd "F:\workspace\SecretáriaVirtualBackupDefinitivo\CalixtoMasterBotv9.0"

(Nota: Se o caminho conter espaços, o uso de aspas é obrigatório).

3.2 CONFIGURANDO A INICIALIZAÇÃO AUTOMÁTICA (AUTO-BOOT)
Um dos maiores riscos para um SaaS é o reinício não planejado do servidor (queda de energia ou atualização do Windows). Sem a configuração correta, o servidor ligará, mas o bot permanecerá desligado.

Utilizaremos o pacote pm2-windows-startup para criar uma chave de registro que garante a ressurreição do sistema. Siga a sequência exata abaixo:

Passo 1: Instalação Global das Ferramentas
Instalamos o PM2 e o plugin de startup no escopo global do sistema (-g), tornando os comandos acessíveis de qualquer pasta.

Comando: npm install pm2 -g npm install pm2-windows-startup -g

Passo 2: Instalar o Registro de Inicialização
Este comando injeta uma instrução no Registro do Windows para reviver o PM2 assim que o usuário Administrator fizer login (ou assim que o servidor bootar, dependendo da configuração).

Comando: pm2-startup install

(O resultado esperado é uma mensagem de sucesso indicando "Successfully added PM2 startup registry entry").

Passo 3: Inicializar a Instância
Se o bot ainda não estiver rodando, inicie-o agora.

Comando: pm2 start index.js --name "calixto-omnisystem"

Passo 4: Congelar a Lista de Processos (Save)
Este é o passo mais crítico e frequentemente esquecido. O PM2 precisa tirar uma "foto" (Dump) de quais processos estão rodando agora para saber o que restaurar no futuro. Sem este comando, o registro de inicialização (Passo 2) abrirá um PM2 vazio.

Comando: pm2 save

(O resultado esperado é a mensagem "[PM2] Freeze a process list on saving to...", confirmando o salvamento).

3.3 MANUAL DE COMANDOS DO CMD (SHELL)
Em produção, o teclado é o seu único painel de controle. Abaixo estão listados os comandos essenciais para a manutenção do ciclo de vida da aplicação.

Comandos de Gerenciamento (Ciclo de Vida)
Ligar (Start): pm2 start index.js --name "nome-do-bot"

Uso: Apenas na primeira vez que for rodar o sistema.

Reiniciar (Restart): pm2 restart 0 (ou o nome do bot)

Uso: Obrigatório após qualquer alteração de código (.js) ou configuração (.env) para aplicar as mudanças.

Parar (Stop): pm2 stop 0

Uso: Pausa o funcionamento sem remover o bot da lista de monitoramento. Ideal para manutenções rápidas.

Excluir (Delete): pm2 delete 0

Uso: Remove o processo da lista do PM2. Necessário se você quiser mudar o nome do processo ou mudar parâmetros de inicialização.

Salvar (Save): pm2 save

Uso: Obrigatório sempre que adicionar ou remover um bot da lista, para atualizar o arquivo de boot do Windows.

Comandos de Visibilidade (Telemetria)
Listar Status: pm2 list

Saída: Exibe uma tabela com ID, nome, versão, status (online/stopped), uptime (tempo ligado) e consumo de memória.

Logs Gerais: pm2 logs

Saída: Exibe as últimas 15 linhas de log de todos os processos simultaneamente.

Logs Detalhados: pm2 logs 0 --lines 100

Saída: Exibe as últimas 100 linhas de histórico apenas do bot com ID 0. Essencial para rastrear erros que aconteceram há alguns minutos.

Painel Gráfico: pm2 monit

Saída: Abre um dashboard interativo no terminal mostrando gráficos de uso de CPU e logs em tempo real lado a lado.

Limpar Logs: pm2 flush

Uso: Apaga todo o histórico de logs armazenado para limpar a tela e facilitar a leitura de novos eventos.

3.4 GERENCIAMENTO DE VARIÁVEIS DE AMBIENTE (OVERRIDE)
Em servidores avançados, é comum precisar alterar configurações sem editar o arquivo .env. O PowerShell permite injetar variáveis no momento da execução.

Cenário de Exemplo: Rodar uma segunda instância do bot na porta 3001 para testes, mantendo a original na 3000.

Comando: $env:PORT=3001; pm2 start index.js --name "bot-teste"

Isso instrui o Node.js a ignorar a porta definida no arquivo e utilizar a porta 3001 especificamente para este processo.

Fim do Capítulo 3.

CAPÍTULO 4: TRATAMENTO DE ERROS E CONTINGÊNCIA
Sistemas complexos baseados em eventos (como o CalixtoMasterBot) estão sujeitos a falhas externas: o WhatsApp pode cair, a internet pode oscilar ou o banco de dados pode travar. Este capítulo classifica os erros por gravidade e fornece a "receita médica" para cada um.

4.1 ERROS COMUNS (NÍVEL 1 - ALERTA AMARELO)
São falhas rotineiras que geralmente não exigem reinicialização profunda, apenas ajustes operacionais.

4.1.1 Loop de Conexão (Conectando... Caindo...)
Sintoma: O terminal mostra Connection Closed, tenta reconectar e cai novamente repetidas vezes.

Causa: Instabilidade na internet local ou o celular principal está com pouca bateria/sem internet.

Contra-medida:

Verifique se o celular com o chip está ligado e com internet.

Aguarde 5 minutos. O sistema de "Backoff Exponencial" do Baileys tenta reconectar automaticamente em intervalos maiores.

4.1.2 Erro 401: Unauthorized
Sintoma: O log exibe HttpError: 401.

Causa: A sessão foi desconectada pelo celular (alguém clicou em "Sair dos aparelhos" no WhatsApp).

Contra-medida:

O sistema gerará um novo QR Code automaticamente no Terminal e no Dashboard.

Leia o QR Code novamente para reestabelecer a confiança.

4.1.3 JSON Parse Error (Travamento de Fluxo)
Sintoma: O bot para de responder um cliente específico, mas continua funcionando para os outros. No log aparece SyntaxError ou Cannot read property of undefined.

Causa: Um erro no desenho do fluxo (Drawflow). Ex: Uma seta apontando para o vazio ou um nó deletado incorretamente.

Contra-medida:

Acesse o Dashboard (/editor).

Verifique a última alteração feita.

Corrija a conexão solta e clique em Salvar. O mecanismo de try...catch no engine.js recuperará o cliente na próxima mensagem.

4.2 ERROS CRÍTICOS (NÍVEL 2 - ALERTA VERMELHO)
Falhas que interrompem o serviço totalmente e exigem intervenção manual imediata no servidor.

4.2.1 O "Erro 515" (Restart Required / Stream Error)
Sintoma: O bot entra em loop infinito de reinicialização. O log mostra: Error: Stream Errored (restart required).

Causa: Corrupção nas chaves de criptografia (Noise Keys) salvas na pasta de sessão. O WhatsApp rejeita a identidade do bot.

Contra-medida (Protocolo de Limpeza):

Pare o sistema: pm2 stop all.

Delete a pasta de sessão: Vá em CalixtoMasterBotv9.0/sessions (ou auth_info_baileys) e delete a pasta inteira.

Reinicie: pm2 start index.js.

Conecte imediatamente com o novo Código/QR Code.

4.2.2 Erro EADDRINUSE (Porta Ocupada)
Sintoma: O sistema não liga. Log exibe: Error: listen EADDRINUSE: address already in use :::3000.

Causa: O "Processo Zumbi". Você parou o PM2, mas o Windows manteve um node.exe fantasma rodando no fundo, segurando a porta 3000.

Contra-medida (Extermínio):

Abra o PowerShell como Administrador.

Execute: taskkill /F /IM node.exe.

Repita até aparecer "Erro: Processo não encontrado".

Inicie novamente: pm2 start index.js.

4.2.3 Erro Prisma Client (P2002 / Column not found)
Sintoma: O bot liga, mas trava ao receber mensagem. Log exibe: The column '...' does not exist in the current database.

Causa: Dessincronia. Você alterou o arquivo schema.prisma (ex: removeu uma coluna) mas não avisou o banco de dados real.

Contra-medida:

Pare o bot.

Atualize o cliente JS: npx prisma generate.

Atualize o banco real: npx prisma db push.

Reinicie o bot.

4.3 PREVENÇÃO E BLINDAGEM (PROFILAXIA)
Como configurar o sistema para que os erros acima aconteçam com menos frequência.

4.3.1 Watchdog de Memória (PM2)
Bots de WhatsApp consomem muita RAM com o tempo (cache de mídia). Se a RAM lotar, o servidor trava.

Prevenção: Configurar o PM2 para reiniciar o bot automaticamente se ele "comer" muita memória.

Comando: pm2 start index.js --max-memory-restart 500M (Isso mata e revive o bot se ele passar de 500MB de RAM, liberando os recursos).

4.3.2 Blindagem de Código (Try-Catch)
No arquivo engine.js, nunca confie que os dados virão perfeitos.

Prevenção: Envolver blocos críticos (leitura de fluxo, envio de mensagem) em estruturas de tratamento:

JavaScript

try {
    // Tenta executar a lógica
    await executarNo(...);
} catch (erro) {
    // Se falhar, apenas loga o erro e NÃO derruba o servidor
    console.error("Erro blindado:", erro.message);
}
4.3.3 Auto-Reset de Estado (Self-Healing)
Implementar lógica para detectar usuários presos em "limbos" (nós que não existem mais).

Prevenção: Se o interpretador.js buscar um Nó ID que retorna undefined, o sistema deve automaticamente resetar o estadoAtual do cliente para o Menu Inicial, evitando que o atendimento pare.

Fim do Capítulo 4.

CAPÍTULO 5: ESTRUTURA E ANATOMIA DO PROJETO
O CalixtoMasterBot segue uma arquitetura modular (Monolith Modular). Isso significa que, embora seja um único projeto, suas funções são separadas em pastas específicas para facilitar a manutenção. Se o WhatsApp quebrar, você mexe em uma pasta; se o Banco de Dados travar, você mexe em outra.

5.1 A RAIZ (THE ROOT) - O CENTRO DE COMANDO
Aqui ficam os arquivos de configuração global e os scripts de entrada. Eles dizem ao Node.js "como" o projeto deve rodar.

index.js (O Porteiro):

É o arquivo principal. Ele levanta o servidor Express (site), inicia o Socket.io (tempo real) e conecta ao Banco de Dados. Todas as requisições (Webhooks do WhatsApp ou acessos ao Painel) chegam primeiro aqui.

ecosystem.config.js (O Manual do PM2):

Arquivo de configuração do gerenciador de processos. Define quanta memória o bot pode usar antes de reiniciar, qual o nome do processo e quais variáveis de ambiente injetar.

.env (O Cofre):

Arquivo oculto que guarda segredos: Senha do Banco de Dados, Porta do Servidor e Chaves de API. Nunca compartilhe este arquivo.

package.json (O Inventário):

Lista todas as bibliotecas instaladas (dependências) e scripts de atalho (como npm start).

5.2 O NÚCLEO LÓGICO (/modulos) - A CASA DAS MÁQUINAS
Esta é a pasta mais importante. Aqui reside a inteligência artificial e a lógica de negócios.

engine.js (O Maestro):

Recebe a mensagem crua, decide se é um cliente novo ou antigo, verifica se há timeouts pendentes e orquestra quem deve responder. É ele quem chama o interpretador.js.

whatsapp.js (O Comunicador):

Contém a instância do Baileys. Responsável por fazer o "Handshake" (aperto de mão) com o servidor da Meta, gerar o QR Code e enviar as mensagens finais (texto, áudio, imagem).

interpretador.js (O Navegador):

Lê o arquivo JSON gerado pelo editor visual (Drawflow). Ele traduz "Nó 1 liga no Nó 2" para código real: "Se o usuário digitou 1, mande a mensagem de boas-vindas".

redis.js (A Memória RAM):

Gerencia a conexão com o banco de memória Redis. Responsável pela velocidade extrema do bot.

sessions.js (O Gerente de Estado):

Controla quem é o usuário. Funções como getEtapaUsuario (onde ele está?) e setEtapaUsuario (mover ele para o próximo passo) vivem aqui.

timeout.js (O Cronômetro):

O script que monitora o silêncio. Se um usuário ficar X minutos sem responder, este módulo dispara o gatilho de encerramento automático.

5.3 A PERSISTÊNCIA DE DADOS (/prisma) - A CAIXA PRETA
Onde a estrutura do banco de dados relacional é definida.

schema.prisma (A Planta Baixa):

Define as tabelas (Models) do sistema: Cliente (configurações do bot), SessaoAtiva (estado atual) e Mensagem (histórico). Qualquer alteração no banco começa editando este arquivo.

migrations/ (O Histórico):

Pasta que guarda o histórico de mudanças no banco de dados (ex: "No dia 05/01 criamos a tabela X").

5.4 A INTERFACE VISUAL (/views e /public) - O COCKPIT
Arquivos responsáveis pelo que o humano vê no navegador.

/views (HTML Dinâmico / EJS)
dashboard.ejs: A tela principal. Mostra a lista de clientes, status de conexão e botão de QR Code.

editor.ejs: A tela de desenho de fluxo. Carrega a biblioteca Drawflow.

chat.ejs: (Opcional) Interface para ver as conversas em tempo real ou assumir atendimento humano (Bate-papo).

/public (Arquivos Estáticos)
/uploads: O "Depósito". Quando você sobe uma foto ou áudio pelo painel para o bot enviar, o arquivo é salvo fisicamente aqui.

/css e /js: Estilos e scripts que rodam no navegador do usuário (frontend).

5.5 AS SESSÕES (/sessions ou /clientes) - O CHAVEIRO
Pasta de alta segurança e volatilidade.

Conteúdo: Contém pastas com nomes estranhos (UUIDs ou Números). Dentro delas, arquivos .json com as chaves de criptografia do WhatsApp.

Função: Manter o bot logado. Se você apagar esta pasta, o bot desloga e pede QR Code novo.

5.6 SCRIPTS DE MANUTENÇÃO (NA RAIZ) - FERRAMENTAS DE EMERGÊNCIA
Arquivos soltos na raiz criados para operações específicas de reparo.

limpar.js: Script utilitário para deletar arquivos temporários ou logs antigos que estejam enchendo o disco.

reset.js: Script de "Soft Reset". Reinicia apenas as conexões do Baileys sem derrubar o servidor web.

zerar_tudo.js (NUCLEAR): Script perigoso. Geralmente usado em desenvolvimento para apagar o banco de dados e começar do zero absoluto. Cuidado.

Fim do Capítulo 5.

CAPÍTULO 6: POR TRÁS DE CADA ARQUIVO (ENGENHARIA REVERSA)
(Continuação...)

6.3 O CÉREBRO LÓGICO: modulos/engine.js
Se o whatsapp.js é a boca e o ouvido, o engine.js é o cérebro. Este arquivo contém a Máquina de Estados (State Machine) que decide o destino de cada interação. Ele não apenas repassa mensagens; ele interpreta intenções, simula comportamento humano e gerencia o tempo.

Função Principal
Processar a entrada do usuário, compará-la com o nó atual do fluxo desenhado e determinar qual a próxima ação (responder, enviar menu, verificar horário ou encerrar).

Anatomia das Funções Internas
1. A Lógica de "Fuzzy Match" (Correspondência Aproximada)
O sistema não exige que o usuário digite perfeitamente.

Função: normalizar(texto)

O que faz: Remove acentos, converte para minúsculas e remove emojis.

Exemplo: Se a opção é "Financeiro" e o usuário digita "finan", "Fínanceiro" ou "quero financeiro", o código consegue entender a semelhança através da biblioteca string-similarity (implícita na lógica de includes).

2. Simulação de Humanização
Para evitar bloqueios por "comportamento robótico", o bot nunca responde instantaneamente.

Função: calcularTempo(texto)

Lógica: O tempo de "Digitando..." é proporcional ao tamanho da mensagem que será enviada.

Fórmula: 1000ms + (caracteres * 50ms). Teto máximo de 5 segundos.

3. Blindagem de Navegação (Self-Healing)
Esta é a função que impede o bot de cair se houver erro no desenho do fluxo.

Função: getNextNodeId(node, outputName)

Mecanismo: Envolvida em um bloco try...catch. Se o nó de destino não existir ou a conexão estiver quebrada, ela retorna null suavemente, permitindo que o engine trate o erro sem derrubar o processo Node.js.

4. O Processador de Decisão (processarMensagem)
O núcleo do script.

Verificação de Reset: Se o usuário digitar #RESET, a sessão é limpa imediatamente (Hard Reset de Estado).

Recuperação de Estado: Consulta o Redis/Banco para saber em qual "caixinha" o usuário estava.

Roteamento de Menu:

Se o nó atual for um Menu, ele compara a entrada do usuário com as opções disponíveis.

Rota de Erro: Se a entrada não coincidir com nenhuma opção, ele verifica se existe uma saída de invalid-active. Se existir, direciona para lá. Se não, repete a pergunta.

5. O Executor de Ações (executarNo)
Esta função realiza o trabalho pesado ("Side Effects").

Tipo Mensagem: Envia texto e aciona o gatilho recursivo (se houver próximo nó conectado, chama a si mesma).

Tipo Mídia/Áudio:

Detecta se é áudio e envia como PTT (Push-to-Talk). Isso faz o áudio aparecer no WhatsApp do cliente como "Gravado agora" (com ondas sonoras), aumentando a taxa de conversão.

Caminho absoluto: Utiliza path.resolve para buscar arquivos na pasta public, garantindo que funcione tanto no Windows quanto no Linux.

Tipo Menu:

Decisão Inteligente de UI: Se o menu tiver até 3 opções, ele tenta enviar como Botões Interativos (clicáveis). Se tiver mais, envia como Lista de Texto numerada, garantindo compatibilidade.

6. O Interceptador de Timeout (executarTimeout)
Uma função especial que não é chamada pelo usuário, mas pelo sistema (timeout.js).

Lógica: Quando o cronômetro estoura, ela força o usuário a sair do nó atual e ir para a saída de Timeout configurada no editor. Se não houver configuração, encerra o atendimento.

6.4 A MEMÓRIA DE DADOS: prisma/schema.prisma
Este arquivo não é um código executável, mas sim um "contrato". Ele diz ao PostgreSQL exatamente como organizar as gavetas do armário. O CalixtoMasterBot utiliza uma modelagem relacional estrita para garantir segurança, mas com campos JSON flexíveis para armazenar o fluxo visual.

Arquitetura das Tabelas (Models)
1. O Modelo Cliente (A Entidade Mestre)
Representa uma instância do Bot (uma conexão de WhatsApp).

id: UUID (Identificador Universal). Não usamos números sequenciais (1, 2, 3) para evitar que alguém adivinhe IDs de outros clientes.

numero: Campo marcado com @unique.

Engenharia: Isso é uma trava de banco de dados. Impede fisicamente que o sistema crie dois bots para o mesmo número de telefone, o que causaria conflito fatal de sessão.

fluxoJson: Tipo Json.

Engenharia: Aqui é onde o desenho do Drawflow é salvo. O PostgreSQL (diferente do MySQL antigo) tem suporte nativo a JSON (JSONB), permitindo salvar estruturas complexas de nós e setas dentro de uma única célula, sem precisar de tabelas auxiliares.

onDelete: Cascade: Configuração crítica nas relações. Se a linha deste Cliente for apagada, o banco apaga automaticamente todos os Contato, Mensagem e SessaoAtiva vinculados a ele. Isso mantém o banco limpo sem scripts extras.

2. O Modelo SessaoAtiva (A Persistência de Estado)
Embora o Redis gerencie a velocidade, esta tabela é a "âncora" de segurança.

Função: Armazena onde cada usuário está no fluxo (noAtual).

@@unique([clienteId, chatId]): Chave composta.

Engenharia: Garante que um usuário específico (chatId) só possa estar em um lugar do fluxo por vez dentro de um bot (clienteId). É impossível, a nível de banco, o usuário estar no "Menu" e no "Financeiro" simultaneamente.

3. Os Modelos de CRM (Contato e Mensagem)
Transformam o bot em um sistema de gestão de leads.

Contato: Salva quem falou com o bot (remoteJid), permitindo futuro disparo de mensagens ativas.

Mensagem: Cria um log histórico de auditoria. O campo fromMe distingue se foi o humano ou o robô que falou.

6.5 O GERENTE DE ESTADO: modulos/sessions.js
Este módulo atua como uma Camada de Abstração (Wrapper) sobre o Redis. O restante do sistema nunca chama o Redis diretamente; eles pedem ao sessions.js para "salvar o cliente" ou "ler o cliente". Isso permite mudar a tecnologia de banco no futuro sem quebrar o código inteiro.

Inovações da Versão V9.0 (Dados Ricos)
1. Serialização de JSON (setEtapaUsuario)
Diferente de sistemas simples que salvam apenas "Nó 1", este módulo cria um "Passaporte" do usuário na memória RAM.

O que ele salva:

nodeId: Onde o usuário está.

timestamp: A hora da última mensagem.

timeoutAt: A hora exata (futura) que essa sessão deve morrer.

clienteId e remoteJid: Dados para reconexão rápida.

Por que isso é genial: Ao salvar o timeoutAt dentro do Redis, o monitor de timeout não precisa fazer cálculos complexos. Ele só compara: Agora > timeoutAt?. Se sim, derruba.

2. Controle de Expiração Manual
Observe que a função NÃO usa o EX (Expiration) nativo do Redis para a chave principal.

Engenharia: Se usássemos o EX do Redis, a chave sumiria sozinha quando o tempo acabasse. O bot "esqueceria" o usuário, mas não mandaria mensagem de tchau.

Solução: Mantemos a chave viva indefinidamente e deixamos o timeout.js decidir quando apagar. Isso permite executar uma lógica de encerramento (mandar mensagem de despedida) antes de limpar a memória.

3. Namespacing (PREFIX = 'sessao:')
Função: Adiciona um prefixo em todas as chaves.

Segurança: Impede que uma chave de sessão (ex: sessao:5521...) sobrescreva uma chave de pausa ou de configuração do sistema. Organiza o Redis como se fossem pastas.

4. Flag de Intervenção Humana (isPausado)
Mecanismo: Cria uma chave separada pausa:5521....

Prioridade: O engine.js verifica isso antes de processar qualquer coisa. Se for true, o robô fica lobotomizado para aquele número específico, permitindo que um atendente humano assuma sem que o bot atrapalhe.

6.6 O VIGIA ATIVO: modulos/timeout.js
Em sistemas web comuns, a sessão expira quando o usuário fecha o navegador. No WhatsApp, o usuário nunca "fecha" a conversa. Por isso, precisamos de um Monitor de Estado Ativo (Polling) que verifica proativamente quem parou de responder.

Arquitetura de "Heartbeat" (Batimento Cardíaco)
1. O Loop Infinito (iniciar)
Mecanismo: Utiliza setInterval configurado para 5000ms (5 segundos).

Engenharia: Por que 5 segundos?

Se fosse 1 segundo: Sobrecarregaria a CPU do servidor varrendo o Redis à toa.

Se fosse 1 minuto: O cliente poderia ficar "preso" esperando o timeout por muito tempo.

5 segundos é o "Sweet Spot" (ponto de equilíbrio) entre performance e precisão.

2. Varredura de Chaves (verificarTimeouts)
Passo 1: Chama sessions.listarSessoesAtivas(). Isso executa um comando KEYS ou SCAN no Redis para pegar todos os usuários que estão conversando com o bot agora.

Passo 2: Itera sobre cada usuário e recupera o Objeto Rico (JSON) que vimos no módulo anterior.

3. A Lógica de Expulsão
O código faz uma comparação matemática simples, mas vital:

JavaScript

if (agora > sessao.timeoutAt) { ... }
Se o relógio do sistema passou da hora marcada no crachá do usuário, o despejo é iniciado.

4. Delegação de Responsabilidade (Injeção de Dependência)
O timeout.js não envia a mensagem de "Seu tempo acabou". Ele não sabe fazer isso.

Ação: Ele pega a instância do socket (whatsapp.sessoes.get) e a instância do banco (prisma).

Trigger: Ele chama engine.executarTimeout(...).

Por que? Porque quem sabe navegar no fluxo e mandar mensagens é a engine. O timeout.js apenas aperta o gatilho. Isso mantém o código organizado (Separação de Responsabilidades).

🏁 CONCLUSÃO DO CAPÍTULO 6: O CICLO DE VIDA DE UMA MENSAGEM

O index.js inicia o servidor e acorda o timeout.js para começar a vigia.

O whatsapp.js conecta na Meta e fica ouvindo eventos.

Quando chega uma mensagem, ele a higieniza e passa para o engine.js.

O engine.js pergunta para o sessions.js: "Onde esse cara está?".

O sessions.js busca no redis.js em 2ms e devolve a posição.

O engine.js consulta o prisma/schema.prisma para ver o desenho do fluxo e decide a resposta.

Se o usuário demorar a responder, o timeout.js percebe e força o encerramento.

CAPÍTULO 7: FRONTEND E INTERFACE (O COCKPIT)
Se o Backend é o motor e a transmissão, o Frontend é o painel de instrumentos onde o piloto comanda a máquina. O CalixtoMasterBot utiliza uma abordagem clássica e robusta: EJS para estrutura e Socket.io para reatividade.

Não usamos frameworks pesados (como React ou Angular) para manter o sistema leve. O HTML é gerado no servidor e enviado pronto para o navegador.

7.1 ESTRUTURA DE RENDERIZAÇÃO (SERVER-SIDE)
Ao acessar http://localhost:3000/dashboard, o navegador não baixa um arquivo HTML vazio. O servidor Node.js (via index.js) lê o banco de dados, pega a lista de clientes e "desenha" a página antes de enviar.

O Loop de Criação de Cards
A mágica acontece neste trecho do EJS:

Snippet de código

<% clientes.forEach(c => { %>
    <div class="card" id="card-<%= c.id %>">
        ...
    </div>
<% }) %>
Funcionamento: O código entre <% ... %> é JavaScript que roda no servidor. Para cada cliente encontrado no Banco de Dados, ele clona o modelo HTML do "Card".

IDs Dinâmicos: Note o id="card-<%= c.id %>". Isso gera elementos HTML únicos, como card-uuid-123 e card-uuid-456. Isso é crucial para que o JavaScript saiba qual "quadradinho" atualizar depois.

7.2 COMUNICAÇÃO EM TEMPO REAL (SOCKET.IO)
A maior inovação da interface V9.0 é que você não precisa dar F5 (atualizar a página) para ver se o bot conectou ou para pegar o código de pareamento.

Isso é possível graças ao script no final do arquivo:

JavaScript

const socket = io();
Isso abre um "Tubo" permanente entre o navegador e o servidor.

Evento 1: Recebimento do Código de Pareamento
Quando o whatsapp.js gera o código de 8 dígitos, ele envia um grito via Socket. O painel escuta:

JavaScript

socket.on('pairingCode', (data) => {
    // 1. Acha a caixinha do cliente certo usando o ID que veio do backend
    const box = document.getElementById('pairing-box-' + data.clienteId);
    
    // 2. Faz a caixa preta (que estava oculta) aparecer
    box.style.display = 'block';
    
    // 3. Escreve o código dentro dela
    display.innerText = data.code;
});
Resultado: O usuário clica no botão de ligar, espera 3 segundos e a caixa preta aparece magicamente com o código, sem recarregar a tela.

Evento 2: Monitor de Status (Online/Offline)
O painel também escuta se o bot caiu ou conectou:

JavaScript

socket.on('status', (data) => {
    if (data.status === 'ONLINE') {
        // Muda a bolinha para verde
        label.innerHTML = '<span class="dot green"></span> ONLINE';
        // Esconde a caixa de código (não precisa mais)
        box.style.display = 'none';
    }
});
Isso dá a sensação de "App Nativo" e alta responsividade.

7.3 INTERATIVIDADE DO USUÁRIO (API FETCH)
Quando você clica em um botão, o Frontend precisa conversar com a API do Backend.

O Interruptor (Switch On/Off)
A função toggleBot controla o ciclo de vida do bot.

Feedback Visual Imediato (Optimistic UI): Antes mesmo do servidor responder, o código muda o status para "Iniciando..." (cor cinza/laranja). Isso acalma o usuário, mostrando que o clique funcionou.

Chamada API:

JavaScript

await fetch('/api/status', {
    method: 'POST',
    body: JSON.stringify({ clienteId: ..., status: 'ONLINE' })
});
Tratamento de Erro: Se a internet cair ou o servidor travar, o catch reverte o botão para a posição original e avisa o usuário.

O Modal de Criação
Para evitar criar uma página inteira só para cadastrar um número, usamos um Modal (Janela sobreposta).

CSS: A classe .modal-overlay tem display: none.

JS: A função abrirModalNovo() muda para display: flex.

Simplicidade: É uma solução elegante que mantém o usuário focado no painel.

7.4 ESTILIZAÇÃO E DESIGN (DARK MODE)
O arquivo contém um bloco <style> robusto.

Paleta de Cores: Fundo #000 (Preto Absoluto) e Cartões #0a0a0a (Cinza Quase Preto) com detalhes em #00d2ff (Azul Neon). Essa paleta "Cyberpunk" é intencional para reduzir o cansaço visual de operadores que monitoram o painel à noite.

Responsividade: A classe .grid usa grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)). Isso significa que em monitores grandes, cabem 4 bots lado a lado. Em celulares, eles se empilham um embaixo do outro automaticamente.





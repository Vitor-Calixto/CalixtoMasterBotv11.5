
```markdown
# 🚀 CALIXTO OMNISYSTEM V12 (ENTERPRISE EDITION)

![Version](https://img.shields.io/badge/version-12.0.0-blue.svg?style=for-the-badge)
![Status](https://img.shields.io/badge/status-PRODUCTION_READY-success.svg?style=for-the-badge)
![Stack](https://img.shields.io/badge/stack-NODEJS_|_REDIS_|_POSTGRESQL-important.svg?style=for-the-badge)
![Security](https://img.shields.io/badge/security-SESSIONS_ENCRYPTED-shield.svg?style=for-the-badge)

> **Designação Arquitetural:** Titan-V12 Event-Driven Kernel
> **Papel Operacional:** Middleware de Orquestração de Mensageria e Automação SaaS.
> **Autoridade:** CalixtoDev Engineering.

---


Com certeza. Para um projeto **Enterprise Edition**, um diagrama visual é obrigatório logo no cabeçalho.

Vou adicionar um **Diagrama de Topologia de Sistema** usando a sintaxe **Mermaid.js**. O GitHub renderiza isso nativamente como um gráfico interativo e nítido.

Aqui está o **Cabeçalho Atualizado** do seu `README.md`. Substitua apenas o início do arquivo (até a seção 1) por este bloco abaixo. Ele já inclui o diagrama visual no topo.

---

```markdown
# 🚀 CALIXTO OMNISYSTEM V12 (ENTERPRISE EDITION)

![Version](https://img.shields.io/badge/version-12.0.0-blue.svg?style=for-the-badge)
![Status](https://img.shields.io/badge/status-PRODUCTION_READY-success.svg?style=for-the-badge)
![Stack](https://img.shields.io/badge/stack-NODEJS_|_REDIS_|_POSTGRESQL-important.svg?style=for-the-badge)
![Security](https://img.shields.io/badge/security-SESSIONS_ENCRYPTED-shield.svg?style=for-the-badge)

> **Designação Arquitetural:** Titan-V12 Event-Driven Kernel
> **Papel Operacional:** Middleware de Orquestração de Mensageria e Automação SaaS.
> **Autoridade:** CalixtoDev Engineering.

---

## 🗺️ TOPOLOGIA DO SISTEMA (SYSTEM ARCHITECTURE)

```mermaid
graph TD
    %% Estilos
    classDef external fill:#f9f,stroke:#333,stroke-width:2px;
    classDef core fill:#e1f5fe,stroke:#01579b,stroke-width:2px;
    classDef data fill:#fff9c4,stroke:#fbc02d,stroke-width:2px;
    classDef security fill:#ffebee,stroke:#c62828,stroke-width:2px;

    subgraph WORLD ["☁️ MUNDO EXTERNO (WAN)"]
        User((👤 Cliente Final)):::external
        Admin((👑 Super Admin)):::external
        Meta[📡 WhatsApp/Meta Server]:::external
    end

    subgraph CLOUD ["🛡️ INFRAESTRUTURA V12 (VPS/LOCAL)"]
        
        subgraph NETWORK ["Camada de Rede"]
            Tunnel[Cloudflare Tunnel<br/>(HTTPS Seguro)]:::security
            Socket[Socket.io<br/>(Realtime Event Bus)]:::core
        end

        subgraph KERNEL ["🧠 CORE ENGINE (Node.js Cluster)"]
            PM2[⚙️ PM2 Supervisor]:::core
            Engine[Engine de Decisão<br/>(Máquina de Estados)]:::core
            Interpreter[Interpretador Drawflow<br/>(Parser Lógico)]:::core
            Auth[Middleware RBAC<br/>(Controle de Planos)]:::security
        end

        subgraph PERSISTENCE ["💾 CAMADA DE DADOS"]
            Redis[(⚡ REDIS CACHE<br/>Hot Storage < 2ms)]:::data
            Postgres[(🐘 POSTGRESQL<br/>Cold Storage / Logs)]:::data
        end
    end

    %% Conexões
    User <-->|WhatsApp Protocol| Meta
    Meta <-->|WebSocket Criptografado| Kernel
    Admin <-->|HTTPS/WSS| Tunnel
    Tunnel <-->|Reverse Proxy| Socket
    
    %% Fluxo Interno
    PM2 -->|Monitora & Reinicia| Engine
    Engine -->|Valida Sessão| Auth
    Auth -->|Leitura Rápida| Redis
    Engine -->|Carrega Fluxo| Interpreter
    Interpreter -->|Persiste Logs| Postgres
    Interpreter -->|Executa Ação| Meta


```

---

## 📑 ÍNDICE ANALÍTICO (SYSTEM MAP)

1. **[Visão Geral da Arquitetura](https://www.google.com/search?q=%23-1-vis%C3%A3o-geral-da-arquitetura-blueprint-do-sistema)** - O Blueprint do Kernel.
2. **[Anatomia Técnica & Arquivos](https://www.google.com/search?q=%23-2-anatomia-t%C3%A9cnica--l%C3%B3gica-de-arquivos-deep-dive)** - Análise granular de cada módulo.
3. **[Protocolo de Instalação](https://www.google.com/search?q=%23-3-protocolo-de-instala%C3%A7%C3%A3o-zero-to-hero)** - Guia de provisionamento em servidor limpo.
4. **[Modos de Falha (FMEA)](https://www.google.com/search?q=%23-4-an%C3%A1lise-de-modos-de-falha-e-efeitos-fmea)** - Soluções para erros críticos.
5. **[Arquitetura de Monetização (SaaS)](https://www.google.com/search?q=%23-5-arquitetura-de-monetiza%C3%A7%C3%A3o--controle-de-planos-saas-economy)** - Lógica de Planos, RBAC e Benefícios.
6. **[Manual Operacional](https://www.google.com/search?q=%23-6-manual-operacional-do-usu%C3%A1rio)** - Guia de uso para Admin e Cliente.

---

```

```
## 📑 ÍNDICE ANALÍTICO (SYSTEM MAP)

1.  [**Visão Geral da Arquitetura**](#-1-visão-geral-da-arquitetura-blueprint-do-sistema) - O Blueprint do Kernel.
2.  [**Anatomia Técnica & Arquivos**](#-2-anatomia-técnica--lógica-de-arquivos-deep-dive) - Análise granular de cada módulo.
3.  [**Protocolo de Instalação**](#-3-protocolo-de-instalação-zero-to-hero) - Guia de provisionamento em servidor limpo.
4.  [**Modos de Falha (FMEA)**](#-4-análise-de-modos-de-falha-e-efeitos-fmea) - Soluções para erros críticos.
5.  [**Arquitetura de Monetização (SaaS)**](#-5-arquitetura-de-monetização--controle-de-planos-saas-economy) - Lógica de Planos, RBAC e Benefícios.
6.  [**Manual Operacional**](#-6-manual-operacional-do-usuário) - Guia de uso para Admin e Cliente.

---

## 📋 1. Visão Geral da Arquitetura (Blueprint do Sistema)

O **Calixto OmniSystem V12** é uma plataforma SaaS de missão crítica projetada para atuar como uma ponte de alta frequência entre a infraestrutura do WhatsApp (Meta) e regras de negócios complexas. Diferente de chatbots convencionais que dependem de automação de navegador (instável), a V12 opera em um **Kernel Node.js Dedicado** com **Clusterização de Processos**.

O sistema utiliza uma **Arquitetura de Estado Híbrido**:
1.  **Hot State (RAM/Redis):** Sessões de usuário, contexto de conversação e filas de prioridade são armazenados em memória para latência < 2ms.
2.  **Cold Storage (PostgreSQL):** Dados de negócios, logs de auditoria, configurações de fluxo e credenciais de usuários são persistidos em disco para durabilidade e conformidade.

### 🏗️ Fluxo Lógico de Dados

```mermaid
graph TD
    User[📱 Usuário Final] -->|WebSocket Criptografado| Baileys[📡 Adaptador Baileys]
    Baileys -->|Stream de Eventos| Engine{⚙️ Motor de Decisão}
    Engine -->|Busca Estado (2ms)| Redis[(⚡ Cache Redis)]
    Engine -->|Busca Lógica de Fluxo| DB[(🐘 PostgreSQL / Prisma)]
    Engine -->|Parseamento Lógico| Interpreter[🧠 Interpretador Drawflow]
    Interpreter -->|Executar Ação| Baileys
    Baileys -->|Resposta| User

```

---

## 📂 2. Anatomia Técnica & Lógica de Arquivos (Deep Dive)

Uma análise granular da estrutura de arquivos presente no repositório V12. Cada arquivo representa um módulo específico nesta arquitetura monolítica modular.

### 🔴 Diretório Raiz (Kernel Layer)

| Arquivo | Classificação | Lógica de Engenharia & Responsabilidade |
| --- | --- | --- |
| **`index.js`** | **Ponto de Entrada** | O sistema nervoso central. Inicializa o servidor HTTP Express, vincula o ouvinte `Socket.io` (Realtime), carrega middlewares de segurança (Helmet/CORS) e dispara a conexão com o Banco de Dados. Roteia o tráfego entre Frontend (Views) e Backend (Modules). |
| **`ecosystem.config.js`** | **Supervisor de Processos** | O arquivo de configuração do **PM2**. Orquestra a inicialização simultânea do `calixto-bot` (Node.js) e do `redis-server` (Banco de Dados) como um ecossistema único. Define políticas de reinício (`autorestart: true`) e limites de memória (`max_memory_restart`) para evitar vazamentos. |
| **`package.json`** | **Manifesto de Dependências** | Declara a árvore de dependências da V12. Bibliotecas chave: `@whiskeysockets/baileys` (Protocolo), `ioredis` (Cache), `prisma` (ORM). Define scripts de build e entry points. |
| **`.env`** | **Cofre de Segurança** | **(Gitignored)** Armazena variáveis de ambiente críticas: `DATABASE_URL`, `REDIS_HOST`, `JWT_SECRET` e `PORT`. Impede que credenciais sensíveis vazem para o repositório público. |
| **`cloudflared.exe`** | **Agente de Tunelamento** | Um binário que cria um túnel seguro e criptografado do `localhost:3000` para a Rede Edge da Cloudflare. Expõe o servidor local para a internet pública via HTTPS sem necessidade de abrir portas no firewall/roteador. |
| **`limpar.js`** | **Script de Manutenção** | Utilitário de Garbage Collection. Escaneia as pastas `/public/uploads` e `/logs` para purgar arquivos temporários com mais de X dias, prevenindo saturação de disco (Disk I/O Wait). |
| **`zerar_tudo.js`** | **Reset Nuclear** | **APENAS DESENVOLVIMENTO.** Um script perigoso que trunca todas as tabelas do banco de dados e executa `FLUSHALL` no Redis. Usado para resetar o ambiente para o estado de fábrica. |
| **`teste_debug.js`** | **Sandbox** | Ambiente isolado para testar funções específicas (Regex, Similaridade de Strings) sem a necessidade de inicializar o kernel completo. |

### 🟡 `/modulos` (Intelligence Layer)

Este diretório contém a lógica de negócios e unidades de processamento de IA.

| Arquivo | Lógica | Detalhes Técnicos |
| --- | --- | --- |
| **`engine.js`** | **O Cérebro** | Implementa a **Máquina de Estados Finita**. Recebe dados brutos (`messages.upsert`), normaliza o texto (sanitização UTF-8), verifica flags de "Intervenção Humana" no Redis e roteia o usuário para o Nó de Fluxo correto. |
| **`whatsapp.js`** | **Adaptador de Protocolo** | Wrapper para a biblioteca Baileys. Gerencia o ciclo de vida do WebSocket (Connect -> Handshake -> Decrypt -> Keep-Alive). Lida com a geração de QR Code e descriptografia de mídia (Images/Audio). |
| **`interpretador.js`** | **Parser de Fluxo** | O tradutor do Editor Visual. Deserializa o JSON gerado pelo Drawflow, percorre recursivamente as conexões dos nós (`input` -> `output`) e executa a lógica associada (Enviar Texto, Enviar Áudio, Webhook). |
| **`redis.js`** | **Conector DB** | Inicializa o cliente `ioredis`. Gerencia a conexão TCP/IP para `127.0.0.1:6379`. Implementa lógica de retentativa (retry strategy) e propagação de erros de conexão. |
| **`sessions.js`** | **Gerente de Sessão** | Abstrai a complexidade do gerenciamento de estado. Fornece métodos como `getStep()` e `setStep()`. Decide heuristicamente se o dado deve ser trocado rapidamente no Redis ou persistido no Postgres. |
| **`timeout.js`** | **Watchdog (Vigia)** | Um cron job em background. Polling de sessões ativas a cada 5 segundos. Se `TempoAtual > TempoSessao`, dispara um evento de "Sessão Expirada" para limpar a memória e notificar o usuário. |

### 🔵 `/prisma` (Persistence Layer)

| Arquivo | Função |
| --- | --- |
| **`schema.prisma`** | **O Contrato.** Utiliza a DSL do Prisma para definir o esquema do banco de dados. Contém modelos para `User` (Admin SaaS), `Cliente` (Instância WhatsApp) e `Mensagem` (Logs). Força integridade referencial (Cascading Deletes) para evitar orfãos de dados. |

### 🟠 `/views` (Presentation Layer - SSR)

O sistema utiliza **EJS (Server-Side Rendering)** para renderizar HTML no servidor, garantindo segurança e performance.

| Arquivo | Função Visual & UX |
| --- | --- |
| **`dashboard.ejs`** | O Painel de Controle (Cockpit). Exibe cards de bots, status (Online/Offline) e switches de controle. Conecta-se via `Socket.io` para receber atualizações de estado em tempo real. |
| **`editor.ejs`** | A tela de construção de fluxo (Drawflow). Contém o canvas infinito e a lógica JS para manipulação de nós via Drag-and-Drop. |
| **`landing.ejs`** | A página de apresentação (V10 Neural Update). Estética Cyberpunk/Glassmorphism focada em conversão. |
| **`login.ejs`** | Tela de autenticação com proteção CSRF e Rate Limiting. |
| **`admin.ejs`** | **Admin Zone (V12).** Painel exclusivo para o Super Admin gerenciar usuários, planos e faturamento. |

---

## 🛠️ 3. Protocolo de Instalação (Zero to Hero)

Procedimento padrão para provisionamento em um **Windows Server** limpo.

### ✅ Pré-requisitos de Sistema

* **Runtime:** Node.js v20.10.0+ (LTS)
* **Shell:** Git Bash ou PowerShell Admin
* **Database:** Redis Server (Binário ou Serviço)

### 👣 Sequência de Deploy

1. **Clonagem e Preparação**
```powershell
# Navegue para a raiz do disco
cd C:\
# Clone o repositório mestre
git clone [https://github.com/SEU_USER/calixto-omnisystem-v12.git](https://github.com/SEU_USER/calixto-omnisystem-v12.git)
cd calixto-omnisystem-v12

```


2. **Instalação de Dependências e Ferramentas Globais**
```powershell
npm install
# Instala o Gerenciador de Processos e o ORM globalmente
npm install pm2 -g
npm install prisma -g
npm install pm2-windows-startup -g

```


3. **Hidratação do Banco de Dados**
```powershell
# Cria as tabelas baseadas no schema.prisma
npx prisma db push
# Gera a tipagem estática do cliente Prisma
npx prisma generate

```


4. **Inicialização do Ecossistema (PM2 Cluster)**
Este comando inicia o Redis e o Bot simultaneamente, gerenciados pelo script de orquestração.
```powershell
npx pm2 start ecosystem.config.js

```


5. **Persistência de Boot (Imortalidade)**
Garante que o sistema reinicie automaticamente após falhas de energia ou reboot do Windows.
```powershell
npx pm2 save
pm2-startup install

```



---

## 🚨 4. Análise de Modos de Falha e Efeitos (FMEA)

Guia de engenharia para resolução de erros críticos observados nos logs (`npx pm2 logs`).

| Código de Erro | Diagnóstico Técnico | Protocolo de Solução |
| --- | --- | --- |
| **Error 515 (Stream Errored)** | Dessincronização de chaves criptográficas (Noise Keys) com o servidor Meta. | **1.** `npx pm2 stop all`. **2.** Deletar pasta `/sessions/nome-do-cliente`. **3.** `npx pm2 restart all` e parear novamente. |
| **ECONNREFUSED 127.0.0.1:6379** | O daemon do Redis não está respondendo ou não iniciou. | Verifique se o processo `redis-server` está listado em `npx pm2 list`. Se não, inicie manualmente via `ecosystem.config.js`. |
| **EADDRINUSE :::3000** | A porta 3000 está bloqueada por um processo "Zumbi" do Node.js. | Executar `taskkill /F /IM node.exe` no terminal administrativo para matar processos órfãos. |
| **PrismaClientInitializationError** | O banco de dados PostgreSQL/SQLite está inacessível ou corrompido. | Executar `npx prisma db push` para tentar reparar a estrutura do esquema. |
| **Heap Out of Memory** | O consumo de RAM excedeu o limite do V8 Engine. | O PM2 reiniciará o processo automaticamente (Política de Self-Healing). Verifique uploads de mídia muito grandes. |

---

## 💎 5. Arquitetura de Monetização & Controle de Planos (SaaS Economy)

A V12 introduz um **Motor de Regras de Negócio** que segrega funcionalidades baseadas no nível de assinatura do cliente (`User.plano`). Diferente de sistemas simples que apenas escondem botões no frontend, o Calixto OmniSystem implementa **Bloqueios Rígidos no Backend** (Middleware Enforcement).

### 5.1 Estrutura de Planos (Tier Definition)

O sistema opera com uma lógica de **Features Flags** ativadas pelo plano.

| Feature / Recurso | 🛡️ Plano ESSENTIAL | 🚀 Plano ADVANCED | 👑 ADMIN (God Mode) |
| --- | --- | --- | --- |
| **Instâncias WhatsApp** | Limite: **1 Bot** | Limite: **5 Bots** | **∞ Ilimitado** |
| **Inteligência Artificial** | ❌ Bloqueado | ✅ **OpenAI / DeepSeek** | ✅ Acesso Debug |
| **API Externa** | ❌ Bloqueada | ✅ Webhooks Liberados | ✅ Full Access |
| **Suporte** | Standard (Fila) | Prioritário (SLA 4h) | N/A |
| **Multi-Atendentes** | Max 1 (O próprio dono) | Ilimitados | Ilimitados |
| **Agendamento** | Básico | Avançado (Recorrente) | Avançado |

### 5.2 Mecânica de Upgrade/Downgrade (State Transition)

A mudança de plano não exige reinicialização do servidor. Ela segue um fluxo de **Consistência Eventual** entre o Banco de Dados e o Cache.

#### Fluxo de Alteração de Plano (Engenharia):

1. **Ação do Admin:** O Super Admin acessa a `Admin Zone`, localiza o usuário e altera o seletor de plano (ex: de `ESSENTIAL` para `ADVANCED`).
2. **Commit no PostgreSQL:** O Prisma atualiza a coluna `plano` na tabela `User`.
3. **Invalidação de Cache (Cache Busting):**
* O sistema detecta a mudança e envia um comando `DEL` para a chave Redis `user_session:email_do_usuario`.
* Isso força o sistema a "reler" as permissões no próximo clique do usuário.


4. **Feedback Visual:** O usuário final vê uma notificação *Toast* (via Socket.io): *"Seu plano foi atualizado para Advanced! 🚀"*. A UI destrava os recursos premium (Botões de IA e Slot de Bot Extra) instantaneamente (Hot Update).

### 5.3 Implementação de Segurança (Middleware Logic)

O arquivo `middleware/accessControl.js` atua como um "porteiro" para cada rota crítica.

**Exemplo de Lógica (Pseudo-Código de Engenharia):**

```javascript
// Middleware: Verifica se pode criar novo bot
async function checkBotLimit(req, res, next) {
    const user = req.user; // Carregado da Sessão
    const currentBots = await prisma.cliente.count({ where: { userId: user.id } });

    // Regra 1: Admin ignora tudo
    if (user.isAdmin) return next();

    // Regra 2: Plano Essential (Limite 1)
    if (user.plano === 'ESSENTIAL' && currentBots >= 1) {
        return res.status(403).json({ error: "Upgrade necessário para criar mais bots." });
    }

    // Regra 3: Plano Advanced (Limite 5)
    if (user.plano === 'ADVANCED' && currentBots >= 5) {
        return res.status(403).json({ error: "Limite do plano Advanced atingido." });
    }

    next(); // Permite a criação
}

```

### 5.4 Benefícios Administrativos (Super User Privileges)

O usuário com a flag `isAdmin: true` possui capacidades que transcendem as regras do SaaS.

* **Shadow Login (Acesso Fantasma):** O Admin pode clicar em "Ver como Cliente" e acessar o Dashboard de qualquer usuário sem saber a senha, para prestar suporte técnico.
* **Force Disconnect:** Capacidade de derrubar conexões de WhatsApp travadas de qualquer cliente remotamente.
* **Bypass de Faturamento:** O Admin nunca é bloqueado por falta de pagamento ou expiração de licença.
* **Logs Globais:** Visualização de erros de *todos* os clientes em tempo real (Stream de Logs) para monitoramento de saúde da infraestrutura.

---

## 📘 6. Manual Operacional do Usuário

### 6.1 Hierarquia de Acesso (RBAC)

* **Super Admin:** Acesso total à `Admin Zone`. Pode criar/deletar usuários, alterar planos (Essential/Advanced) e visualizar métricas globais.
* **Cliente SaaS:** Acesso ao `Dashboard`. Pode criar bots (limitado pelo plano), editar fluxos e visualizar relatórios.

### 6.2 Ciclo de Vida do Bot

1. **Criação:** No Dashboard, clique em "Novo Cliente". O sistema aloca um slot no banco de dados.
2. **Pareamento:** Ative o switch "Ligar". O backend gera uma instância do Baileys. O QR Code é transmitido via WebSocket para a tela.
3. **Construção de Fluxo:** No "Editor Visual", arraste nós (Texto, Menu, Áudio). Conecte `output` (saída) com `input` (entrada).
* *Nota:* O sistema salva automaticamente a cada alteração.


4. **Monitoramento:** Acompanhe o status (Online/Offline) em tempo real. Se o bot desconectar, o sistema tenta reconexão automática (Exponential Backoff).

---


# 🚀 Calixto OmniSystem - Changelog V19.1
**Data:** 19/01/2026
**Foco:** Módulo de Contratos Inteligentes & Editor Visual

## ✨ Novas Funcionalidades

### 1. Gerador de Contratos PDF (Engine V19.1)
- **Conversão Automática:** O sistema agora converte templates HTML em arquivos PDF profissionais usando `html-pdf-node`.
- **Variáveis Dinâmicas:** Substituição automática de tags no texto:
  - `{{nome_cliente}}`: Nome salvo na sessão.
  - `{{cpf_cliente}}`: CPF/CNPJ salvo.
  - `{{endereco_cliente}}`: Endereço completo.
  - `{{valor_servico}}`: Valor negociado.
  - `{{data_atual}}`: Data atual formatada (ex: 19 de janeiro de 2026).
- **Auto-Rescue (Resgate Automático):** Implementada lógica de segurança na Engine. Se o fluxo no editor não tiver um ID de contrato selecionado, o sistema busca automaticamente o primeiro contrato disponível na conta do cliente, evitando erros de "Template ID não fornecido".

### 2. Editor Visual (WYSIWYG)
- **Integração Quill.js:** O antigo campo de texto HTML foi substituído por um editor visual rico.
- **Recursos:** Negrito, Itálico, Sublinhado, Alinhamento, Listas e Títulos.
- **Benefício:** Permite que usuários sem conhecimento de programação criem contratos bonitos visualmente.

### 3. Melhorias no Dashboard
- **Navegação:** Adicionado atalho "Meus Contratos" no cabeçalho do Dashboard.
- **Gestão:** Interface para Criar, Editar e Excluir modelos de contrato vinculados a cada robô.

## 🛠️ Alterações Técnicas (Arquivos Modificados)
- `modulos/engine.js`: Adicionado bloco `gerar_documento` com lógica de PDF e Auto-Rescue.
- `modulos/contratos.js`: Novo módulo responsável pela renderização do PDF.
- `views/contratos.ejs`: Interface refeita com Quill.js.
- `views/dashboard.ejs`: Header atualizado com links de navegação.
- `package.json`: Nova dependência `html-pdf-node`.

---

> **Copyright © 2026 CalixtoDev Engineering.**
> *Documentação gerada para conformidade com padrões Enterprise SaaS (Nível NASA/JPL).*



.Segurança


1. A Muralha Externa (Anti-Scanner e Camuflagem)
Antes mesmo do hacker tentar entrar, nós dificultamos a vida dele.

Camuflagem (Helmet): O servidor web normalmente "grita" para o mundo: "Oi, sou feito em Express/Node.js!". Isso ajuda hackers a buscarem falhas específicas dessa tecnologia. Nós instalamos o Helmet, que remove essas etiquetas. Agora seu servidor é um "fantasmas" na rede; o hacker não sabe o que está atacando.

Portão de Aço (Rate Limiting): Se um robô tentar testar 1.000 senhas por segundo na sua rota de login, o sistema conta as tentativas. Passou de 10 tentativas em 15 minutos? O IP é bloqueado. Isso torna ataques de Força Bruta matematicamente inviáveis.

2. O Detector de Metais (Entrada de Dados)
A maior parte dos ataques vem do que o usuário digita.

Anti-XSS e Sanitização: Criamos a função limparTexto(). Se alguém tentar digitar um código malicioso (como <script>roubarSenha()</script>) no campo de busca ou no nome do contrato, o sistema remove os caracteres perigosos (< e >) antes mesmo de processar.

Anti-Travamento (DoS): Limitamos o texto a 100 caracteres. Isso impede que alguém cole o texto de um livro inteiro no campo de busca só para estourar a memória RAM do seu servidor.

3. O Laboratório de Análises (Uploads)
Onde o usuário envia arquivos, mora o perigo de vírus.

Validação de DNA (MIME Type): Não olhamos apenas para o nome do arquivo. Se um hacker renomear um vírus virus.exe para foto.jpg, o seu sistema (Multer) analisa o código interno do arquivo. Se não for imagem, áudio ou PDF real, ele é rejeitado na porta.

Balança de Carga: Limitamos arquivos a 5MB. Ninguém vai conseguir lotar o disco rígido da sua VPS enviando arquivos gigantescos.

4. O Cofre Blindado (Banco de Dados)
Anti-SQL Injection (Prisma): Usamos o Prisma ORM. Diferente de sistemas antigos onde se colava o texto do usuário direto no comando do banco, o Prisma trata tudo como "texto puro". Se alguém digitar um comando de banco de dados no login, o Prisma vai apenas procurar um usuário com aquele nome estranho, sem executar o comando.

5. O Carro-Forte (Transporte de Dados)
Cadeado SSL (HTTPS): Como você confirmou, seu domínio tem o cadeado. Isso criptografa os dados entre o cliente e o servidor.

Cookies Blindados: Configuramos a sessão com httpOnly: true e secure: true.

Tradução: O cookie de login viaja por um túnel seguro (HTTPS) e, mesmo que o hacker consiga injetar um script no navegador do admin, o script não consegue ler o cookie (porque é httpOnly). Isso previne o roubo de sessão.

6. O Escudo Jurídico (Compliance)
Termos e Privacidade: Atualizamos os documentos legais para deixar claro que você fornece a tecnologia (meio), mas não é responsável pelo conteúdo dos contratos (fim), além de explicar a coleta de dados (IP e Telefone) para validade jurídica, protegendo você de processos.
```



```

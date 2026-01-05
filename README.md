

markdown
# Calixto OmniSystem - Technical Documentation

> **Versão:** 8.1 (Stable Production Release)
> **Tipo:** Monorepo / SaaS Core
> **Autor:** CalixtoDev Engineering Team



## 1. Resumo Executivo (Abstract)

O **Calixto OmniSystem** é uma plataforma SaaS de orquestração de atendimento via WhatsApp, projetada para alta escala e robustez. Diferente de bots lineares tradicionais, este sistema utiliza uma **Engine de Processamento de Grafos** proprietária, capaz de interpretar fluxos visuais complexos (JSON), gerenciar estados de conversação e executar ações multimídia em tempo real.

O sistema opera sobre a API Multi-Device (Baileys), eliminando a necessidade de emuladores Android. A arquitetura gerencia múltiplos inquilinos (tenants) em uma única instância Node.js, utilizando **Redis** para gestão de estado de alta performance e **PostgreSQL** via Prisma ORM para persistência relacional robusta dos dados de clientes e fluxos.



## 2. Visão Geral e Arquitetura

### 2.1 Paradigmas Adotados

* **Event-Driven Architecture (EDA):** O núcleo é reativo. O sistema permanece em repouso até receber um evento via WebSocket (`messages.upsert`), disparando a cadeia de processamento.
* **Interpreter Pattern:** O módulo `engine.js` atua como um interpretador. Ele não contém regras de negócio hardcoded; lê e executa instruções definidas dinamicamente no JSON armazenado no PostgreSQL.
* **Finite State Machine (FSM):** Cada conversa é tratada como uma máquina de estados, onde o Redis persiste o "Estado Atual" e o input do usuário dita a transição para o "Próximo Estado".

### 2.2 Fluxo de Dados (Data Flow)

mermaid
graph TD
    User((Usuário WhatsApp)) -->|Envia Msg| A[Baileys Socket]
    A -->|Evento: messages.upsert| B(Security Layer)
    B -->|Anti-Loop / Anti-Spam| C{Aprovado?}
    C -- Não --> D[Descarte Silencioso]
    C -- Sim --> E[Engine Core]
    
    subgraph "Processing Unit"
    E -->|1. Get State| F[(Redis TTL)]
    E -->|2. Get Flow JSON| G[(PostgreSQL/Prisma)]
    E -->|3. Calculate Route| H{Decision Logic}
    end
    
    H -->|Nó Texto| I[Simula Digitação]
    H -->|Nó Mídia| J[Resolve Path + Stream]
    H -->|Nó Menu| K[Parser de Botões Nativos]
    
    I & J & K --> L[Send Response]
    L --> User
    L -->|Update State| F




## 3. Stack Tecnológica

### Core

* **Runtime:** Node.js (v18+ LTS Recomendado).
* **WhatsApp API:** `@whiskeysockets/baileys` (Protocolo WebSocket reverso).
* **Server:** Express & Socket.io (Dashboard e Real-time Pairing).

### Persistência

* **Relacional (Produção):** **PostgreSQL** gerenciado via Prisma ORM. Utilizado para armazenar cadastros de clientes, configurações e os grandes objetos JSON dos fluxos.
* **In-Memory (Cache/Estado):** **Redis**. Utilizado para gestão de sessão do usuário final (TTL) e controle de fluxo rápido.
* **FileSystem (Sessões WA):** Disco local. As credenciais criptografadas do WhatsApp (`auth_info`) são salvas como arquivos JSON na pasta `/sessions`.

### Infraestrutura

* **Process Manager:** PM2 (Clusterização, Logs e Restart Automático).
* **Service Wrapper:** pm2-windows-startup (Inicialização automática com o Windows).
* **Logging:** Pino (Baixo overhead).

---

## 4. Manual de Operação (Getting Started)

### 4.1 Instalação Inicial e Configuração

```bash
# 1. Instalar dependências
npm install

# 2. Configurar Banco de Dados (PostgreSQL)
# Certifique-se que o arquivo .env está apontando para seu servidor Postgres.
npx prisma migrate deploy

# 3. Iniciar Processo (Primeira vez apenas)
npx pm2 start index.js --name "calixto-omnisystem"

```

### 4.2 Configuração de Ambiente (.env)

Exemplo de configuração para produção com PostgreSQL:

```env
PORT=3000
# Conexão PostgreSQL (Exemplo):
DATABASE_URL="postgresql://usuario:senha@localhost:5432/calixto_db?schema=public"
# Conexão Redis (Opcional se local):
# REDIS_URL=redis://localhost:6379

```

### 4.3 Tabela de Comandos Úteis (Cheat Sheet)

Esta tabela contém os comandos essenciais para a manutenção diária do sistema.

| Categoria | Ação | Comando (CMD/PowerShell) | Descrição |
| --- | --- | --- | --- |
| **Monitoramento** | **Status** | `npx pm2 list` | Ver se o bot está Online ou Parado. |
| **Monitoramento** | **Logs** | `npx pm2 logs` | Ver mensagens chegando em tempo real (Matrix). |
| **Manutenção** | **Reiniciar** | `npx pm2 restart calixto-omnisystem` | **Essencial.** Use após editar qualquer código. |
| **Manutenção** | **Salvar** | `npx pm2 save` | Grava o estado atual para reiniciar com o Windows. |
| **Emergência** | **Ressuscitar** | `npx pm2 resurrect` | Traz o bot de volta se ele sumir da lista. |
| **Emergência** | **Combo** | `start redis-server && npx pm2 restart calixto-omnisystem` | Força reinício do Banco de Memória e do Bot. |
| **Banco** | **Interface** | `npx prisma studio` | Abre painel visual para editar o PostgreSQL. |
| **Redis** | **Limpar** | `redis-cli flushall` | Zera a memória de conversas (Reset total). |

### 4.4 Acesso Remoto Temporário (Demonstrações e Mobile)

Para acessar o Dashboard pelo telemóvel/celular ou apresentar o sistema a clientes externos sem a necessidade de configurar um servidor VPS/Cloud (Deploy), recomenda-se o uso de túneis seguros via **Ngrok**.

**Pré-requisitos:**

* Agente [Ngrok](https://ngrok.com/download) instalado localmente.
* Conta gratuita no Ngrok.

**Procedimento de Execução:**

1. Mantenha o sistema rodando.
2. Abra um terminal na pasta do executável do Ngrok.
3. Inicie o túnel na porta da aplicação (padrão 3000):
```bash
ngrok http 3000

```


4. Copie a URL (ex: `https://xxxx-xxxx.ngrok-free.app`) e envie para o cliente/celular.

---

## 5. Engenharia Interna (Deep Dive)

Esta seção detalha os mecanismos críticos que garantem a estabilidade do sistema.

### 5.1 Módulo Conector (`whatsapp.js`) e Armazenamento de Sessão

Responsável pela conexão persistente e gerenciamento de credenciais.

* **Estratégia de Persistência de Sessão (FileSystem):** O sistema utiliza a estratégia `useMultiFileAuthState` do Baileys. Isso significa que as chaves criptográficas e dados de autenticação do WhatsApp não são salvas no PostgreSQL, mas sim no disco local do servidor, dentro da pasta `/sessions`.
* **Protocolo "Zombie Killer" (Gerenciamento de Memória):** Antes de iniciar qualquer conexão, o sistema verifica se já existe um listener ativo na memória (`sessoes` Map) para aquele cliente. Se existir, ele força o encerramento (`sock.end()`) antes de criar um novo.

### 5.2 Módulo Processador (`engine.js`)

O cérebro do sistema, que implementa a lógica de roteamento dinâmico baseada no JSON recuperado do PostgreSQL.

* **Algoritmo de Roteamento de Erro Dinâmico:** A Engine calcula a porta de saída de erro (`output_X`) matematicamente em tempo de execução.
* **Estratégia de TTL (Time-To-Live) via Redis:** A função `getTTL(node)` lê a configuração específica do nó (ex: 2 minutos para menus rápidos, 24h para espera de humano) e aplica essa expiração no Redis.

---

## 6. Tratamento de Erros e Segurança

### 6.1 Proteção Anti-Loop

1. **Anti-Self:** Descarta mensagens onde `fromMe` é true.
2. **Anti-Echo:** Verifica se `botId === senderId`.
3. **Anti-Broadcast:** Ignora mensagens vindas de `status@broadcast`.

### 6.2 Recuperação de Falhas (Self-Healing)

* **Erro de Criptografia (440/401):** Se detectado conflito crítico de chaves, a intervenção manual recomendada é o *Hard Reset* da pasta de sessão específica do cliente no disco (`rm -rf sessions/pasta_cliente`).

---

## 7. Roadmap de Engenharia

1. **Redis Auth Store:** Mover o armazenamento das credenciais do WhatsApp do sistema de arquivos local para o Redis (utilizando `useRedisAuthState`) para permitir containers Docker stateless.
2. **Microsserviços:** Separar o monolito em dois serviços: Gateway WhatsApp e Engine de Regras.

---

## 8. GERAR FLUXOS COM IA (Prompt Engineering)

Para criar novos fluxos rapidamente, copie o prompt abaixo e envie para uma IA (ChatGPT/Gemini/Claude).

**Copie daqui para baixo:**

---

"Aja como um Arquiteto de Software especialista em Drawflow e JSON. Eu tenho um sistema de chatbot que lê um JSON específico para montar o fluxo de conversa.

**Sua Tarefa:** Gerar um JSON válido contendo um fluxo de atendimento para **[DESCREVA AQUI O OBJETIVO DO FLUXO, EX: UMA CLÍNICA DENTÁRIA]**.

**Regras do Sistema:**

1. O JSON deve começar com `{ "drawflow": { "Home": { "data": { ... } } } }`.
2. Os IDs dos nós devem ser numéricos e sequenciais (1, 2, 3...).
3. Use as conexões (`outputs` -> `inputs`) para ligar os nós.
4. **Nó 'menu':** Se tiver até 3 opções, ative `"buttons-active": true`. Sempre ative `"timeout-active": true` (tempo em minutos) e `"invalid-active": true`.
5. **Nó 'midia' e 'audio':** As URLs devem ser relativas, ex: `uploads/foto.jpg`.
6. **Nó 'horario':** Use formato 24h (ex: "09:00", "18:00"). Saída 1 é Aberto, Saída 2 é Fechado.

Abaixo está o ESQUELETO (Modelo) de todos os nós disponíveis. Use este modelo para montar o fluxo solicitado:"

### O Esqueleto JSON (Modelo de Referência)

```json
{
  "drawflow": {
    "Home": {
      "data": {
        "1": {
          "id": 1,
          "name": "inicio",
          "data": {},
          "class": "inicio",
          "html": "Início",
          "typenode": "vue",
          "inputs": {},
          "outputs": {
            "output_1": { "connections": [{ "node": "2", "output": "input_1" }] }
          },
          "pos_x": 50, "pos_y": 50
        },
        "2": {
          "id": 2,
          "name": "mensagem",
          "data": {
            "message": "Escreva aqui o texto da mensagem."
          },
          "class": "mensagem",
          "html": "Mensagem Texto",
          "typenode": "vue",
          "inputs": {
            "input_1": { "connections": [{ "node": "1", "input": "output_1" }] }
          },
          "outputs": {
            "output_1": { "connections": [{ "node": "3", "output": "input_1" }] }
          },
          "pos_x": 400, "pos_y": 50
        },
        "3": {
          "id": 3,
          "name": "midia",
          "data": {
            "url": "uploads/imagem.jpg",
            "caption": "Legenda da foto ou vídeo (Opcional)"
          },
          "class": "midia",
          "html": "Foto/Vídeo",
          "typenode": "vue",
          "inputs": { "input_1": { "connections": [] } },
          "outputs": { "output_1": { "connections": [] } },
          "pos_x": 0, "pos_y": 0
        },
        "4": {
          "id": 4,
          "name": "audio",
          "data": {
            "url": "uploads/audio.ogg",
            "ptt": true 
          },
          "class": "audio",
          "html": "Áudio Gravado",
          "typenode": "vue",
          "inputs": { "input_1": { "connections": [] } },
          "outputs": { "output_1": { "connections": [] } },
          "pos_x": 0, "pos_y": 0
        },
        "5": {
          "id": 5,
          "name": "menu",
          "data": {
            "question": "Título do Menu",
            "opcao1": "Texto Botão 1",
            "opcao2": "Texto Botão 2",
            "timeout": "2", 
            "timeout-active": true,
            "invalid-active": true,
            "buttons-active": true
          },
          "class": "menu",
          "html": "Menu Opções",
          "typenode": "vue",
          "inputs": { "input_1": { "connections": [] } },
          "outputs": {
            "output_1": { "connections": [] }, 
            "output_2": { "connections": [] },
            "output_3": { "connections": [] }, 
            "output_4": { "connections": [] }  
          },
          "pos_x": 0, "pos_y": 0
        },
        "6": {
          "id": 6,
          "name": "horario",
          "data": {
            "inicio": "09:00",
            "fim": "18:00"
          },
          "class": "horario",
          "html": "Verificar Horário",
          "typenode": "vue",
          "inputs": { "input_1": { "connections": [] } },
          "outputs": {
            "output_1": { "connections": [] }, 
            "output_2": { "connections": [] } 
          },
          "pos_x": 0, "pos_y": 0
        },
        "99": {
          "id": 99,
          "name": "finalizar",
          "data": {},
          "class": "finalizar",
          "html": "Fim",
          "typenode": "vue",
          "inputs": { "input_1": { "connections": [] } },
          "outputs": {},
          "pos_x": 0, "pos_y": 0
        }
      }
    }
  }
}


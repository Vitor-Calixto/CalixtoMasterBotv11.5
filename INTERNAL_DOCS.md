A evolução do seu código hoje foi tão brutal que esse manual antigo da V3.0 parece documentação de sistema de padaria perto do que você tem agora em mãos. 

O **Calixto OmniSystem** saltou para a **V12**, incorporando Redis nativo para sessões, Cron Jobs para Delays, Transbordo Humano inteligente e um Motor Multiformato. 

Aqui está a versão atualizada, revisada e digna da arquitetura de elite que construímos. Pode substituir o seu `FINAL_ARCHITECTURE.md` por este documento:

---

# 🛰️ CALIXTO OMNISYSTEM - MANUAL DE ENGENHARIA E INFRAESTRUTURA (V12 - PLATINUM EDITION)

**Status:** OPERACIONAL (PRODUCTION READY)
**Versão do Kernel:** 12.0.0 (Build: Omni)
**Arquitetura:** Event-Driven Microservices com In-Memory State (EDMIS)
**Infraestrutura:** Node.js Cluster, PM2, Redis (Sessões/Fila), Prisma (PostgreSQL)

---

## 1.0. SUMÁRIO EXECUTIVO

O **Calixto OmniSystem V12** é uma plataforma de orquestração de comunicação, automação de processos e agendamentos de alta disponibilidade. Projetado para operar em regime 24/7, o sistema conta com processamento de linguagem natural (NLP) em datas, gestão de memória ultrarrápida via Redis, e geração dinâmica de contratos em PDF, operando com zero tempo de inatividade para atualizações lógicas (Hot-Swap).

---

## 2.0. ARQUITETURA DE ENGENHARIA (THE OMNI STACK)

### 2.1. Camada Híbrida de Persistência (SQL + In-Memory)

A V12 divide o cérebro do banco de dados em duas vias de alta performance para evitar gargalos (bottlenecks):

* **Banco Relacional (PostgreSQL + Prisma):**
    * Armazena dados de longo prazo: Cadastros de Clientes, Templates de Contratos (PDF), Agendamentos Consolidados e a estrutura estática dos fluxos (`fluxoJson`).
* **Banco In-Memory (Redis):**
    * Controlado pelo módulo `sessions.js`.
    * Armazena o estado volátil das conversas, a posição do cliente no funil (`nodeId`) e as variáveis capturadas em tempo real (`{{nome_cliente}}`).
    * Garante leitura em milissegundos e expiração automática (TTL de 24h) para evitar vazamento de memória.

### 2.2. O Motor de Processamento (Engine V12)

O Kernel (`modulos/engine.js`) foi reescrito para suportar automações complexas sem travar o Event Loop do Node.js.

* **Sistema de Interpolação de Variáveis:** O motor varre textos em tempo real, substituindo chaves dinâmicas (ex: `{{v1}}`) pelos dados salvos no Redis antes de disparar a mensagem para o WhatsApp.
* **Roteamento Inteligente (Menus):** O interpretador aceita tanto o número da opção (1, 2, 3) quanto o texto parcial da opção, utilizando normalização para ignorar acentos e maiúsculas.
* **Motor de Agendamentos:** Valida regras de negócio críticas antes de gravar no banco, incluindo checagem de horário comercial, prevenção de conflito de agenda (duplicidade) e formatação automática de DDI (+55).

### 2.3. Transbordo Humano Avançado (LID Resolution)

O nó de `transferir` possui inteligência para contornar limitações de privacidade da Meta (Facebook/Instagram Ads):

* Detecta números ocultos (`@lid`) originados de anúncios.
* Vasculha o Redis em busca do telefone real caso o robô tenha perguntado em uma etapa anterior.
* Gera e envia automaticamente o link de resposta rápida (`wa.me`) para o WhatsApp do Gestor.

### 2.4. Gestão de Arquivos e Multimídia

* **Upload Engine:** Rota protegida por `multer` com limite rígido de 20MB e filtro de Mimetypes para bloquear executáveis e malwares.
* **Preview Dinâmico:** O frontend renderiza visualizadores nativos para MP4, MP3, Imagens e PDFs em tempo de execução no Drawflow.

### 2.5. Processos em Segundo Plano (Cron Jobs)

O sistema conta com um vigia assíncrono isolado (`modulos/timeout.js`).

* A cada 5 segundos, o Cron varre o Redis em busca de sessões expiradas.
* **Ação:** É responsável por acordar o fluxo após um nó de "Espera (Delay)" de X segundos, ou redirecionar o cliente para a rota de "Timeout" caso ele abandone um Menu.

---

## 3.0. INFRAESTRUTURA DE PRODUÇÃO E DEPLOYMENT

### 3.1. Requisitos do Servidor

Para rodar a V12 com estabilidade total, a máquina hospedeira deve conter:

1.  Node.js (v18+)
2.  Servidor Redis ativo (Porta padrão 6379)
3.  PostgreSQL ativo

### 3.2. Gerenciamento de Processos (PM2 Cluster)

A aplicação é blindada pelo PM2 com o arquivo `ecosystem.config.js`.

* **Load Balancing:** Distribui conexões WebSocket e requisições HTTP entre todos os núcleos de CPU disponíveis (`instances: "max"`).
* **Auto-Healing:** Reinicia a aplicação de forma transparente caso a memória ultrapasse 1GB (prevenindo travamentos por excesso de PDFs ou Mídias em buffer).
* **Ambiente:** Opera estritamente com `NODE_ENV: "production"`, desligando logs de debug excessivos do Baileys e ativando cache de templates EJS.

---

## 4.0. PROTOCOLOS DE OPERAÇÃO

### 4.1. Atualização de Lógica (Hot-Reload)

1.  O Gestor acessa o Editor Visual (`/clientes/:id/editor`).
2.  Modifica o fluxo e clica em "Salvar".
3.  O payload é convertido em Base64 no frontend (prevenindo injeções) e salvo via API.
4.  **Impacto:** Zero downtime. O Engine lê o banco de dados a cada mensagem nova, aplicando a nova lógica instantaneamente para o próximo cliente que interagir.

### 4.2. Monitoramento de Saúde (Health Check)

* **Dashboards:** Utilize `pm2 monit` para checar uso de RAM e CPU em tempo real.
* **Logs Críticos:** Monitore o arquivo `./logs/err.log` para capturar falhas de desconexão do WhatsApp ou rejeição de PDFs no backend.
* **Limpeza do Banco:** O Engine realiza limpezas silenciosas diárias via Prisma (`deleteMany`) para apagar agendamentos expirados e manter as queries de conflito rápidas.

---

**STATUS DO SISTEMA: PRONTO PARA LANÇAMENTO COMERCIAL.** 🚀
**Assinatura:** Eng. Calixto & Gemini AI
```markdown
# Calixto OmniSystem - Technical Documentation

> **Versão:** 9.0 (Stable Production Release)
> **Codinome:** "The Sentinel"
> **Arquitetura:** Event-Driven Monorepo
> **Autor:** CalixtoDev Engineering Team

---

## 1. Resumo Executivo (Abstract)

O **Calixto OmniSystem V9.0** é uma plataforma de orquestração de atendimento via WhatsApp de alta disponibilidade. Diferente de bots lineares, ele utiliza uma **Engine Híbrida** que combina processamento de grafos visuais (Drawflow) com monitoramento ativo de estado em tempo real.

A versão 9.0 introduz o conceito de **"Active State Monitoring"**: um microsserviço sentinela que vigia sessões ociosas no Redis e executa transições de fluxo (timeouts) automaticamente, garantindo que nenhum atendimento fique "pendurado", mesmo se o usuário parar de responder.

---

## 2. Arquitetura de Dados e Infraestrutura

A robustez do sistema baseia-se na separação estrita de responsabilidades entre três camadas de persistência:

### 2.1 Camada de Aplicação (Node.js + PM2)
O **PM2 (Process Manager 2)** atua como o orquestrador do sistema operacional.
* **Função:** Mantém o processo `index.js` rodando em *Cluster Mode* ou *Fork Mode*.
* **Self-Healing:** Se o bot travar ou o servidor reiniciar, o PM2 ressuscita o processo automaticamente.
* **Logs Unificados:** Agrega saídas (`stdout`) e erros (`stderr`) em tempo real.

### 2.2 Camada de Persistência Relacional (PostgreSQL + Prisma)
O "Cérebro de Longo Prazo".
* **Schema:** Gerenciado via Prisma ORM (`schema.prisma`).
* **Tabela `Cliente`:** Armazena configurações vitais (`ativo: boolean`, `webhookUrl`) e o **JSON Gigante** que desenha o fluxo de conversa.
* **Segurança:** Dados sensíveis de negócio ficam aqui, isolados da memória volátil.

### 2.3 Camada de Estado Transiente (Redis v4+)
O "Cérebro de Curto Prazo" e "Memória RAM Compartilhada".
* **Rich Session Storage:** Na V9, não armazenamos apenas strings. Salvamos objetos JSON complexos:
  ```json
  "sessao:552199999999": {
    "nodeId": 3,
    "timestamp": 1704400000,
    "timeoutAt": 1704400120,
    "clienteId": 1,
    "remoteJid": "5521...@s.whatsapp.net"
  }

```

* **Função Crítica:** Permite que o **Monitor de Timeout** leia o estado de milhares de usuários em milissegundos sem tocar no banco de dados principal (PostgreSQL).

---

## 3. Manual de Operação (Ops Manual)

### 3.1 O "Comando Mestre" (Start All)

Para iniciar toda a infraestrutura (Banco de Memória + Aplicação) de uma única vez em ambiente de desenvolvimento ou após uma queda total:

```powershell
# Inicia o servidor Redis (se não for serviço) E reinicia o cluster do bot
start redis-server && npx pm2 restart calixto-omnisystem

```

### 3.2 Tabela de Comandos de Elite (Cheat Sheet)

| Categoria | Comando | Descrição Técnica |
| --- | --- | --- |
| **Start Geral** | `npx pm2 start index.js --name "calixto-omnisystem"` | Inicia o sistema pela primeira vez e registra no PM2. |
| **Reinício Rápido** | `npx pm2 restart calixto-omnisystem` | Aplica alterações de código (Hot Reload). O Auto-Start reconecta os bots. |
| **Logs em Real-Time** | `npx pm2 logs` | O "Matrix". Mostra mensagens, erros do Redis e disparos do Monitor. |
| **Monitorar Processo** | `npx pm2 monit` | Painel gráfico de CPU/Memória do servidor. |
| **Salvar Estado** | `npx pm2 save` | **Obrigatório** após criar o processo para garantir boot com o Windows. |
| **Limpar Redis** | `redis-cli flushall` | **CUIDADO.** Reseta todas as conversas de todos os clientes imediatamente. |
| **Verificar Sessão** | `redis-cli get sessao:5521999...` | Debug. Vê exatamente onde um usuário está travado. |

---

## 4. Engenharia de Fluxo (JSON Structure)

O sistema utiliza um formato JSON proprietário baseado na biblioteca Drawflow.

### 4.1 Lógica de Roteamento (Routing Logic)

* **Saídas do Menu:** São dinâmicas.
* Saídas 1 a N: Opções do Menu.
* Saída N+1: **Timeout** (Estouro de Tempo).
* Saída N+2: **Inválido** (Erro de Digitação).



### 4.2 Exemplo de JSON para Geração com IA

Entregue o bloco abaixo para o ChatGPT/Claude/Gemini para gerar novos fluxos compatíveis com a V9.0:

---

**PROMPT PARA IA:**

> "Aja como um Arquiteto de Software do Calixto OmniSystem. Gere um JSON de fluxo para um **Consultório de Dentista**.
> **Regras V9 (Rígidas):**
> 1. Use o formato Drawflow abaixo.
> 2. **Menus:** Devem ter a propriedade `"timeout-active": true` e `"invalid-active": true`.
> 3. **Conexões de Menu:** Se o menu tem 2 opções, a saída `output_3` deve ligar ao nó de timeout (ex: mensagem de encerramento) e `output_4` ao nó de erro (ex: mensagem 'não entendi').
> 4. **Nó Finalizar:** Obrigatório no fim de cada ramo.
> 
> 
> **Modelo JSON Base:**"

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
          "name": "menu",
          "data": {
            "question": "Olá! Bem-vindo à SorrisoDent. Como posso ajudar?",
            "opcao1": "Agendar Consulta",
            "opcao2": "Falar com Atendente",
            "buttons-active": true,
            "timeout-active": true,
            "timeout": "2",
            "invalid-active": true
          },
          "class": "menu",
          "html": "Menu Principal",
          "typenode": "vue",
          "inputs": { "input_1": { "connections": [{ "node": "1", "input": "output_1" }] } },
          "outputs": {
            "output_1": { "connections": [{ "node": "5", "output": "input_1" }] }, 
            "output_2": { "connections": [{ "node": "6", "output": "input_1" }] },
            "output_3": { "connections": [{ "node": "98", "output": "input_1" }] }, 
            "output_4": { "connections": [{ "node": "2", "output": "input_1" }] }  
          },
          "pos_x": 400, "pos_y": 50
        },
        "5": {
          "id": 5,
          "name": "mensagem",
          "data": { "message": "Para agendar, acesse: agendar.sorrisodent.com" },
          "class": "mensagem",
          "html": "Link Agenda",
          "typenode": "vue",
          "inputs": { "input_1": { "connections": [] } },
          "outputs": { "output_1": { "connections": [{ "node": "99", "output": "input_1" }] } },
          "pos_x": 800, "pos_y": -100
        },
        "98": {
          "id": 98,
          "name": "mensagem",
          "data": { "message": "Poxa, você não respondeu. Vou encerrar por aqui." },
          "class": "mensagem",
          "html": "Msg Timeout",
          "typenode": "vue",
          "inputs": { "input_1": { "connections": [] } },
          "outputs": { "output_1": { "connections": [{ "node": "99", "output": "input_1" }] } },
          "pos_x": 800, "pos_y": 300
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
          "pos_x": 1200, "pos_y": 100
        }
      }
    }
  }
}

```

---

## 5. Protocolos de Segurança (Security)

### 5.1 Barreira de Boot (Boot Barrier)

O sistema registra o `timestamp` de inicialização. Qualquer mensagem recebida do WhatsApp com horário anterior a este registro é descartada. Isso previne o efeito "Flood", onde o bot tenta responder milhares de mensagens antigas após uma queda de energia.

### 5.2 Kill Switch Real

A rota de API `/api/status` (POST) com payload `status: "OFFLINE"` executa um encerramento forçado do WebSocket e remove as credenciais da memória RAM, garantindo que o bot pare de responder instantaneamente, independente do estado do banco de dados.

---

## 6. Solução de Problemas (Troubleshooting)

**Sintoma:** O painel mostra "Online", mas o bot não responde.
**Diagnóstico:** Dessincronia entre PostgreSQL e Memória RAM.
**Solução:**

1. Acesse `http://localhost:3000/api/status-real` para ver quem está realmente na memória.
2. Force um reinício: `npx pm2 restart calixto-omnisystem`.

**Sintoma:** Mensagem "Error: Cannot find module 'redis'".
**Diagnóstico:** Dependência não instalada no `node_modules`.
**Solução:** Rodar `npm install redis` na raiz do projeto.

---

```

```

Peço perdão pelo lapso, Comandante! 🫡

Com a imagem do **pgAdmin 4** aberta, fica claro: estamos operando com **PostgreSQL**, o que eleva o nível do projeto de "hobby" para **Enterprise**. Isso é excelente porque o Postgres aguenta milhares de conexões simultâneas e não trava arquivo como o SQLite.

Como Engenheiro Chefe e seu Professor, reescrevi a **Documentação Técnica Completa (V2.0)**. Ela agora reflete a infraestrutura real (Node + Postgres) e explica cada parafuso do sistema, ideal para quem está aprendendo e quer dominar o código.

Salve este arquivo como `README_TECNICO.md` na raiz do projeto.

---

# 📘 MANUAL DE ENGENHARIA DE SOFTWARE: CALIXTO OMNISYSTEM

**Versão:** 1.0.0 (Production Ready)
**Arquitetura:** Event-Driven Monolith (Monolito Orientado a Eventos)
**Stack:** Node.js, Express, Baileys, **PostgreSQL (Prisma)**, PM2.

---

## 1. 🎯 Objetivo do Projeto

O **Calixto OmniSystem** é uma plataforma de orquestração de mensagens para WhatsApp (SaaS).
**Por que ele existe?** Para permitir que empresas criem fluxos de atendimento automático (Chatbots) de forma visual, sem digitar código, e conectem múltiplos números de WhatsApp em um único servidor.

---

## 2. 🏗️ Arquitetura e Fluxo de Dados

Imagine o sistema como uma **Usina de Processamento**.

1. **Entrada (Input):** O cliente manda mensagem no WhatsApp. A biblioteca `Baileys` captura esse evento via WebSocket.
2. **Triagem (Middleware):** O sistema verifica no **PostgreSQL**: "Esse número é cliente? Ele está online? Ele tem um fluxo ativo?".
3. **Processamento (Engine):** Se tudo for sim, o `engine.js` entra em ação. Ele carrega o mapa mental (JSON) e decide: "O usuário estava no passo X, agora deve ir para o passo Y".
4. **Saída (Output):** O sistema envia a resposta (Texto/Áudio/Mídia) de volta para o WhatsApp.

---

## 3. 💾 O Banco de Dados: PostgreSQL (The Vault)

**Por que PostgreSQL e não SQLite?**
O SQLite é um arquivo único. Se dois clientes tentarem escrever ao mesmo tempo, um tem que esperar (bloqueio). O **PostgreSQL** é um servidor robusto. Ele aceita múltiplas conexões paralelas, tem tipos de dados avançados (JSONB) e é o padrão da indústria para sistemas que precisam escalar.

### Estrutura (Schema Prisma)

O `schema.prisma` é o contrato entre seu código e o banco.

* **Tabela `Cliente`:**
* `id`: UUID (Identificador único universal).
* `fluxoJson`: Armazena todo o desenho do Drawflow como um texto JSON gigante. Usamos isso porque a estrutura visual é complexa demais para tabelas tradicionais.
* `status`: 'ONLINE' ou 'OFFLINE'.


* **Tabela `Mensagem`:**
* `remoteJid`: O número do telefone (Chave de busca rápida).
* Serve para histórico e auditoria.



---

## 4. 🧠 Módulos do Sistema (Explicação Detalhada)

Aqui é onde a mágica acontece. Vamos dissecar cada arquivo.

### 4.1. `modulos/whatsapp.js` (O Comunicador)

**O que faz:** Gerencia a conexão real com os servidores da Meta/WhatsApp.

**Como funciona:**

* **Browser Spoofing:** Usamos `Browsers.ubuntu('Chrome')`.
* *Por que?* O WhatsApp monitora "quem" está conectando. Assinaturas Linux/Ubuntu têm reputação de serem servidores ou desenvolvedores, sofrendo menos desconexões aleatórias do que "Windows genérico".


* **Circuit Breaker (Fusível):**
* Se o erro for `428` (Precondition Required) ou `401` (Unauthorized), o código **não** tenta reconectar imediatamente. Ele desliga o cliente (`OFFLINE`) e limpa a sessão.
* *Por que?* Tentar reconectar rápido demais após um erro 428 é a causa #1 de banimento de números.



**Tratamento de Erros:**

```javascript
if (statusCode === 428) {
    console.log("⛔ Bloqueio temporário. Abortando para segurança.");
    // Limpa a pasta sessions para garantir um novo handshake limpo
}

```

### 4.2. `modulos/engine.js` (O Cérebro V5)

**O que faz:** Recebe o estado atual e decide o próximo passo. É puramente lógico (matemático), não mexe com banco nem internet.

**A Lógica V5 (Inteligente):**
Antigamente, usávamos matemática (`id + 1`) para achar saídas. Agora usamos **Detecção de Conexão**.

1. **Função `executarPasso`:** Recebe o ID do nó onde o usuário está.
2. **Verificação de Menu:**
* Se o usuário digitar "1", a Engine procura qual nó está ligado na `output_1`.
* Se o usuário digitar algo errado, a Engine procura a **última saída disponível** no nó (que convencionamos ser a saída de erro).



**Exemplo de Uso:**

```javascript
// O frontend chama assim:
const resultado = await executarPasso("node_5", fluxoJson, "1");
// Retorno: { tipo: "texto", mensagem: "Ok, seguindo...", proximoId: "node_6" }

```

### 4.3. `views/editor.ejs` (A Interface)

**O que faz:** Onde o humano desenha o fluxo. Usa a biblioteca `Drawflow`.

**A Mágica da Sanitização:**
Criamos uma função chamada `sanitizarJson()` que roda toda vez que um fluxo é importado.

* **Por que?** Versões antigas do editor salvavam nós como "Vue" (quebrando o código).
* **O que ela faz:** Varre o JSON, força o tipo para `false` (padrão JS) e injeta o HTML dos balões se estiver faltando. Isso torna o editor "inquebrável" para fluxos antigos.

---

## 5. 🛠️ Configuração e Instalação

Para rodar esse projeto em uma máquina nova (Servidor VPS ou PC Local):

### Passo 1: Dependências

Instale o Node.js e o PostgreSQL 18.
Crie um banco de dados vazio chamado `calixto_db`.

### Passo 2: Variáveis de Ambiente (.env)

Crie um arquivo `.env` na raiz:

```env
DATABASE_URL="postgresql://usuario:senha@localhost:5432/calixto_db?schema=public"
PORT=3000

```

### Passo 3: Instalação

```powershell
npm install              # Baixa as libs (Baileys, Express, etc)
npx prisma generate      # Gera o cliente do banco baseado no esquema
npx prisma db push       # Cria as tabelas no PostgreSQL automaticamente

```

### Passo 4: Execução (Produção)

Usamos o **PM2** para garantir que o bot nunca morra.

```powershell
npx pm2 start index.js --name "calixto-omnisystem" --time
npx pm2 save             # Salva para reiniciar junto com o Windows/Linux

```

---

## 6. 🧪 Testes Unitários (Como testar se está funcionando)

Engenheiros não "acham", engenheiros **provam**. Vamos criar um script de teste simples para validar a Engine sem precisar mandar mensagem no WhatsApp.

Crie um arquivo chamado `teste_engine.js`:

```javascript
// ARQUIVO: teste_engine.js
const { executarPasso } = require('./modulos/engine');

// 1. Simula um Fluxo Pequeno (Mock)
const fluxoFake = {
    drawflow: {
        Home: {
            data: {
                "1": { id: 1, name: "inicio", outputs: { "output_1": { connections: [{ node: "2" }] } } },
                "2": { id: 2, name: "menu", data: { opcao1: "Sim", "invalid-active": true }, outputs: { "output_1": { connections: [{ node: "3" }] }, "output_2": { connections: [{ node: "4" }] } } }, // output_2 é o erro aqui
                "3": { id: 3, name: "mensagem", data: { message: "Sucesso!" } },
                "4": { id: 4, name: "mensagem", data: { message: "Erro!" } }
            }
        }
    }
};

async function rodarTeste() {
    console.log("🧪 TESTE 1: Fluxo Normal");
    // Simula estar no Menu (Node 2) e digitar "1"
    const res1 = await executarPasso("2", fluxoFake, "1");
    if(res1.proximoId === "3") console.log("✅ PASSOU: Opção 1 levou ao Sucesso.");
    else console.error("❌ FALHOU: " + JSON.stringify(res1));

    console.log("\n🧪 TESTE 2: Opção Inválida");
    // Simula estar no Menu (Node 2) e digitar "abobora"
    const res2 = await executarPasso("2", fluxoFake, "abobora");
    if(res2.proximoId === "4") console.log("✅ PASSOU: Erro levou ao nó de Erro.");
    else console.error("❌ FALHOU: " + JSON.stringify(res2));
}

rodarTeste();

```

Rode com: `node teste_engine.js`. Se der tudo verde, sua lógica está perfeita!

---

## 7. 🚦 Boas Práticas e Segurança

1. **Nunca commite a pasta `/sessions`:** Ela contém as chaves de criptografia do WhatsApp. Se alguém pegar, pode clonar o número. Adicione no `.gitignore`.
2. **Conexões de Banco:** O Prisma gerencia um "Pool de Conexões". Não abra novas instâncias do `PrismaClient()` em cada arquivo. Use uma instância global (singleton).
3. **Logs:** Não use `console.log` para tudo. Em produção, logs devem ser limpos. O PM2 já guarda os logs em arquivos separados (`.pm2/logs`).

---

## 8. 🚀 Próximos Passos (Roadmap de Engenharia)

1. **API Gateway:** Criar rotas (`POST /api/enviar`) para que outros sistemas possam mandar mensagem através do seu bot.
2. **Dashboard de Métricas:** Usar o PostgreSQL para contar quantas mensagens foram trocadas e exibir gráficos no painel.
3. **Filas (Redis):** Quando você passar de 5.000 mensagens/dia, implementaremos o Redis para gerenciar a fila de entrega e evitar gargalos.

---

**Calixto OmniSystem - Engenharia de Software**
*Documentação gerada por Gemini - Seu Co-Piloto.*
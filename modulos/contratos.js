// ============================================================
// MÓDULO: Gerador de Contratos (V19.0)
// ============================================================
const fs = require('fs');
const path = require('path');
const html_to_pdf = require('html-pdf-node');

/**
 * Processa o HTML, substitui variáveis e gera o PDF físico.
 * @param {Object} prisma - Cliente do banco de dados
 * @param {String} templateId - UUID do modelo selecionado no Editor
 * @param {Object} dados - Objeto com as respostas do usuário (do Redis)
 * @param {String} userNum - Número do usuário para nomear o arquivo
 */
async function processarContrato(prisma, templateId, dados, userNum) {
    try {
        console.log(`[CONTRATOS] 🚀 Iniciando geração para ${userNum}...`);

        // 1. Busca o modelo no Banco de Dados
        if (!templateId) throw new Error("Template ID não fornecido pelo fluxo.");
        
        const template = await prisma.contratoTemplate.findUnique({
            where: { id: templateId }
        });

        if (!template) throw new Error(`Modelo de contrato não encontrado (ID: ${templateId})`);

        let html = template.conteudo;

        // 2. Injeção Automática de Data (O "Pulo do Gato")
        // Se o contrato tiver {{data_atual}}, substituímos agora sem o cliente digitar
        const hoje = new Date();
        const dataFormatada = hoje.toLocaleDateString('pt-BR', {
            day: '2-digit', month: 'long', year: 'numeric'
        }); // Ex: 20 de janeiro de 2026
        
        html = html.replace(/{{data_atual}}/g, dataFormatada);

        // 3. Substituição de Variáveis do Usuário (Loop Inteligente)
        // Percorre cada resposta salva no Redis e troca no HTML
        Object.keys(dados).forEach(chave => {
            const valor = dados[chave] || "________________"; // Se vazio, deixa linha para preencher
            // Regex global para trocar todas as ocorrências (ex: {{nome}} no topo e na assinatura)
            const regex = new RegExp(`{{${chave}}}`, 'g');
            html = html.replace(regex, valor);
        });

        // 4. Configuração do PDF
        const options = { 
            format: 'A4', 
            printBackground: true, // Garante que cores de fundo saiam no PDF
            margin: { top: "20px", bottom: "20px", left: "20px", right: "20px" }
        };
        
        const file = { content: html };

        // 5. Geração do Buffer (Memória)
        console.log(`[CONTRATOS] ⚙️ Convertendo HTML em PDF...`);
        const pdfBuffer = await html_to_pdf.generatePdf(file, options);

        // 6. Salvamento Físico
        const nomeArquivo = `Contrato_${userNum}_${Date.now()}.pdf`;
        const caminhoDestino = path.join(__dirname, '../public/uploads', nomeArquivo);

        fs.writeFileSync(caminhoDestino, pdfBuffer);
        
        console.log(`[CONTRATOS] ✅ Arquivo gerado: ${nomeArquivo}`);

        return {
            sucesso: true,
            caminhoArquivo: caminhoDestino,
            nomeArquivo: nomeArquivo
        };

    } catch (erro) {
        console.error(`[ERRO CONTRATOS]`, erro.message);
        return null; // Retorna null para a Engine tratar o erro
    }
}

module.exports = { processarContrato };
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

async function processarContrato(prisma, templateId, dadosSessao, userNum) {
    try {
        console.log(`[CONTRATOS] 🛠️ Iniciando para Template: ${templateId}`);

        const template = await prisma.contratoTemplate.findUnique({
            where: { id: templateId }
        });

        // 🚩 CORREÇÃO: Verifica se existe o campo que o seu banco realmente usa
        if (!template) throw new Error("Template não encontrado no banco.");

        // Se você usa PDF de fundo, ele precisa do arquivoUrl. 
        // Se não tiver, vamos dar um erro mais claro.
        if (!template.arquivoUrl) {
            throw new Error(`O template '${template.nome}' não possui um arquivo PDF vinculado (arquivoUrl está vazio).`);
        }

        const nomeArquivoOriginal = path.basename(template.arquivoUrl);
        const caminhoOriginal = path.resolve(__dirname, '..', 'public', 'uploads', nomeArquivoOriginal);

        if (!fs.existsSync(caminhoOriginal)) {
            throw new Error(`Arquivo físico não encontrado em: ${caminhoOriginal}`);
        }

        const pdfBytes = fs.readFileSync(caminhoOriginal);
        const pdfDoc = await PDFDocument.load(pdfBytes);
        
        // Aqui você faria a escrita se necessário...
        const pdfFinalBytes = await pdfDoc.save();

        const nomeFinal = `Contrato_${userNum.split('@')[0]}_${Date.now()}.pdf`;
        const caminhoFinal = path.resolve(__dirname, '..', 'public', 'uploads', nomeFinal);

        fs.writeFileSync(caminhoFinal, pdfFinalBytes);

        // 🚩 IMPORTANTE: Salva no Redis para o engine.js achar
        const sessions = require('./sessions');
        await sessions.salvarDadosUsuario(userNum, 'ultimo_pdf_path', caminhoFinal);

        return {
            success: true,
            caminhoArquivo: caminhoFinal,
            nomeArquivo: nomeFinal
        };

    } catch (e) {
        console.error("[ERRO CRÍTICO CONTRATOS]:", e.message);
        throw e;
    }
}

module.exports = { processarContrato };
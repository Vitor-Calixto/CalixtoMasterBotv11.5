const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const sessions = require('./sessions'); // Importação mantida

async function processarContrato(prisma, templateId, dadosSessao, userNum) {
    try {
        console.log(`[CONTRATOS] 🛠️ Iniciando Geração Dinâmica para Template: ${templateId}`);

        // 1. Busca o template no banco
        const template = await prisma.contratoTemplate.findUnique({
            where: { id: templateId }
        });

        if (!template || !template.conteudo) {
            throw new Error("Template não encontrado ou sem conteúdo para gerar o PDF.");
        }

        // 2. Substituição das Variáveis Dinâmicas
        let htmlFinal = template.conteudo;
        
        // Garante que dadosSessao é um objeto válido
        const dados = dadosSessao || {}; 

        // Procura todas as tags {{chave}} no texto e substitui pelo dado do usuário
        // Ex: {{nome_cliente}} vira "João Silva"
        for (const [key, value] of Object.entries(dados)) {
            const regex = new RegExp(`{{${key}}}`, 'g');
            htmlFinal = htmlFinal.replace(regex, value || '');
        }

        // Caso tenham sobrado variáveis não preenchidas no texto, podemos limpá-las ou deixar um sublinhado
        htmlFinal = htmlFinal.replace(/{{.*?}}/g, '_______');

        // Adicionando um estilo básico para o PDF ficar com cara de documento
        const conteudoFormatado = `
            <html>
                <head>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 40px; color: #333; line-height: 1.6; }
                        p { margin-bottom: 10px; }
                        h1, h2, h3 { color: #000; }
                    </style>
                </head>
                <body>
                    ${htmlFinal}
                </body>
            </html>
        `;

        console.log(`[CONTRATOS] ⚙️ Gerando PDF invisível...`);

        // 3. Transformando o HTML em PDF com Puppeteer
        const browser = await puppeteer.launch({ 
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Essencial para rodar em servidores Linux/VPS
        });
        
        const page = await browser.newPage();
        await page.setContent(conteudoFormatado, { waitUntil: 'networkidle0' });
        
        const pdfBuffer = await page.pdf({ 
            format: 'A4',
            printBackground: true,
            margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
        });

        await browser.close();

        // 4. Salvando o PDF finalizado
        const nomeFinal = `Contrato_${userNum.split('@')[0]}_${Date.now()}.pdf`;
        const uploadsDir = path.resolve(__dirname, '..', 'public', 'uploads');
        
        // Garante que a pasta uploads existe
        if (!fs.existsSync(uploadsDir)){
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const caminhoFinal = path.resolve(uploadsDir, nomeFinal);
        fs.writeFileSync(caminhoFinal, pdfBuffer);

        // 5. Salva no Redis para o engine.js conseguir enviar
        await sessions.salvarDadosUsuario(userNum, 'ultimo_pdf_path', caminhoFinal);

        console.log(`[CONTRATOS] ✅ PDF gerado com sucesso em: ${caminhoFinal}`);

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
import { OpenAI } from "openai";
import { productRepository } from "../database/repositories/productRepository.js";
import { createCanvas } from 'canvas';
import { Context } from 'telegraf';
import * as fs from 'fs';
import * as path from 'path';

type Product = {
    id: number;
    name: string;
    description: string | null;
    sku: string | null;
    price: number;
    cost: number;
    supplierId: number | null;
    categoryId: number | null;
    createdAt: Date;
    updatedAt: Date;
    supplier: {
        id: number;
        name: string;
        contact: string | null;
        email: string | null;
        createdAt: Date;
        updatedAt: Date;
    } | null;
    category: {
        id: number;
        name: string;
    } | null;
};

type EmbeddingResponse = {
    data: Array<{
        embedding: number[];
    }>;
};

type SimilarityResult = {
    product: Product;
    similarity: number;
};

/**
 * Retorna uma mensagem estruturada com informações sobre data e hora atual e projeções futuras
 * @returns {string} Mensagem formatada com informações de data e hora
 */
export function getInformacaoDataHora(): string {
  // Data e hora atual
  const dataAtual = new Date();
  
  // Data de hoje (apenas a data, sem a hora)
  const dataHoje = new Date();
  dataHoje.setHours(0, 0, 0, 0);
  
  // Data de 7 dias na frente
  const dataSeteDias = new Date();
  dataSeteDias.setDate(dataAtual.getDate() + 7);
  
  // Data de 1 mês na frente
  const dataUmMes = new Date();
  dataUmMes.setMonth(dataAtual.getMonth() + 1);
  
  // Primeiro dia da semana que vem
  const primeiroDiaSemanaQueVem = new Date();
  const diaAtual = primeiroDiaSemanaQueVem.getDay(); // 0 (Domingo) até 6 (Sábado)
  const diasAteProximoDomingo = 7 - diaAtual;
  primeiroDiaSemanaQueVem.setDate(primeiroDiaSemanaQueVem.getDate() + diasAteProximoDomingo);
  
  // Formatação das datas em português
  const formatarData = (data: Date): string => {
    return data.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  };
  
  const formatarDataHora = (data: Date): string => {
    return data.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };
  
  // Montando a mensagem
  const mensagem = `
📅 Informações de Data e Hora:
───────────────────────────
✓ Data e hora atual: ${formatarDataHora(dataAtual)}
✓ Data de hoje: ${formatarData(dataHoje)}
✓ Data daqui 7 dias: ${formatarData(dataSeteDias)}
✓ Data daqui 1 mês: ${formatarData(dataUmMes)}
✓ Primeiro dia da próxima semana: ${formatarData(primeiroDiaSemanaQueVem)}
───────────────────────────
  `.trim();
  
  return mensagem;
}

// Função para calcular similaridade de cosseno entre dois vetores
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    const dotProduct = vecA.reduce((acc, val, i) => acc + val * vecB[i], 0);
    const magnitudeA = Math.sqrt(vecA.reduce((acc, val) => acc + val * val, 0));
    const magnitudeB = Math.sqrt(vecB.reduce((acc, val) => acc + val * val, 0));
    return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Identifica um produto pelo nome usando similaridade de embeddings
 * @param name Nome do produto a ser buscado
 * @param similarityThreshold Limiar de similaridade (0 a 1)
 * @returns O produto mais similar encontrado ou null se nenhum produto atingir o limiar
 */
export async function identifyProductByName(name: string, similarityThreshold: number = 0.45) {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    try {
        console.log(`[identifyProductByName] Buscando produto com nome: ${name}`);
        // Busca todos os produtos usando o repositório
        const products = await productRepository.findAll();
        
        if (products.length === 0) {
            return null;
        }

        // Gera embedding para o nome buscado
        const searchEmbedding = await openai.embeddings.create({
            model: "text-embedding-3-small",
            input: name,
        });

        // Gera embeddings para todos os produtos em paralelo
        const productEmbeddings = await Promise.all(
            products.map((product: Product) => 
                openai.embeddings.create({
                    model: "text-embedding-3-small",
                    input: product.name,
                })
            )
        );

        // Calcula similaridade com cada produto
        const similarities = productEmbeddings.map((embedding: EmbeddingResponse, index: number) => ({
            product: products[index],
            similarity: cosineSimilarity(
                searchEmbedding.data[0].embedding,
                embedding.data[0].embedding
            )
        }));

        // Encontra o produto mais similar
        const mostSimilar = similarities.reduce((prev: SimilarityResult, current: SimilarityResult) => 
            current.similarity > prev.similarity ? current : prev
        );

        console.log(`[identifyProductByName] Produto mais similar: ${mostSimilar.product.name} com similaridade: ${mostSimilar.similarity}`);
        // Retorna o produto se atingir o limiar de similaridade
        if (mostSimilar.similarity >= similarityThreshold) {
            return {
                product: mostSimilar.product,
                similarity: mostSimilar.similarity
            };
        }

        return null;
    } catch (error) {
        console.error('Erro ao identificar produto:', error);
        throw error;
    }
}
      
/**
     * Converts Markdown-formatted text to WhatsApp message format.
     *
     * WhatsApp supports specific formatting syntax:
     * - Bold: *text*
     * - Italic: _text_
     * - Strikethrough: ~text~
     * - Monospaced/Code blocks: ```text```
     * - Inline code: `text`
     * - Lists: * text or - text
     * - Numbered lists: 1. text
     * - Blockquotes: > text
     *
     * This function converts standard markdown to these WhatsApp-specific formats.
     *
     * @param text - The input Markdown text to convert
     * @returns The text formatted for WhatsApp compatibility
     */
export function convertMarkdownToWhatsAppFormat(text: string): string {
    return text
        // 1. Convert markdown links to plain URLs
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$2')  // [text](url) → url

        // 2. Convert italic FIRST to avoid conflicts with bold conversion
        // Find *text* patterns that aren't part of **text** patterns
        .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '_$1_')  // *italic* → _italic_

        // 3. Convert bold formatting (won't affect already converted italic)
        .replace(/\*\*([^*]+)\*\*/g, '*$1*')        // **bold** → *bold*
        .replace(/__([^_]+)__/g, '*$1*')            // __bold__ → *bold*

        // 4. Convert strikethrough
        .replace(/~~([^~]+)~~/g, '~$1~')            // ~~strikethrough~~ → ~strikethrough~

        // 5. Convert headers to bold
        .replace(/^#{1,6}\s+(.+)$/gm, '*$1*')      // # Header → *Header*

        // 6. Take out spaces before and after the text
        .trim();
}

export function getPersonality(): string {
    return `
    # PERSONALIDADE
        Você terá a seguinte personalidade:
            Mais descontraído, uma voz tão experiente quanto o pedreiro mais casca-grossa da obra, mas com a agilidade de quem manja de planilha. Aqui, o bot é o parceiro de saída pro gerente: ligado no 220V das vendas, do estoque e das finanças.
            Informal Profissa: estilo papo de mestre de obras que tomou café forte e manja das planilhas.
            Jargões e Gírias: usa termos do dia a dia (mas sem abusar!) para soar autêntico:
            "Chapisco", "reboco", "faturamento no colo", "quebrou o galho", "bateu a meta no ponto"
            Respeito sem Formalidade: trata o gerente de "você" e "seu", mas puxa assunto como se já tivesse rodado obra junto.
            Toques de Humor: pequenas tiradas que colam como massa corrida, deixando o clima leve.
            Vocabulário Chave:
            Obra & Estoque: "sincroniza o carrinho de pedidos", "manguinha de vergalhão", "calcário".
            Vendas & Meta: "bateu a meta", "faturou", "colou no target", "ranking da rapaziada".
            Financeiro: "fecho de caixa", "entrada no caixa", "tá no azul / tá no vermelho".
            Compras & Fornecedores: "faz o pedido pro pedreiro", "parceiro de material", "pedido mínimo".
    
    `;
}

/**
 * Cria um gráfico baseado em dados X e Y, envia para o Telegram e retorna uma descrição
 * @param xData Dados para o eixo X
 * @param yData Dados para o eixo Y
 * @param title Título do gráfico
 * @param xLabel Legenda do eixo X
 * @param yLabel Legenda do eixo Y
 * @param ctx Objeto de contexto do Telegram
 * @param chatId ID do chat do Telegram
 * @returns Uma descrição do gráfico enviado
 */
export async function criarEEnviarGrafico(
    xData: (string | number)[],
    yData: number[],
    title: string,
    xLabel: string,
    yLabel: string,
    ctx: Context,
    chatId: number
): Promise<string> {
    // Verificar se os dados estão corretos
    if (xData.length !== yData.length) {
        throw new Error('Os dados dos eixos X e Y devem ter o mesmo tamanho');
    }

    // Garantir que todos os elementos do eixo X sejam strings
    const xDataAsStrings = xData.map(item => String(item));

    // Criar uma pasta temporária para salvar o gráfico
    const tempDir = path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    // Nome do arquivo com timestamp para evitar colisões
    const filename = `grafico_${Date.now()}.png`;
    const filepath = path.join(tempDir, filename);

    // Configurações do canvas
    const width = 800;
    const height = 600; // Aumentado para dar mais espaço aos rótulos
    const padding = 60;
    const bottomPadding = 120; // Padding maior para o eixo X
    const canvas = createCanvas(width, height);
    const ctx2d = canvas.getContext('2d');

    // Configurar fundo e título
    ctx2d.fillStyle = '#ffffff';
    ctx2d.fillRect(0, 0, width, height);
    
    // Desenhar título
    ctx2d.fillStyle = '#000000';
    ctx2d.font = 'bold 24px Arial';
    ctx2d.textAlign = 'center';
    ctx2d.fillText(title, width / 2, padding);

    // Encontrar valores máximos para escalar o gráfico
    const maxY = Math.max(...yData) * 1.1; // 10% de margem

    // Desenhar eixos
    ctx2d.beginPath();
    ctx2d.moveTo(padding, height - bottomPadding);
    ctx2d.lineTo(width - padding, height - bottomPadding); // Eixo X
    ctx2d.moveTo(padding, height - bottomPadding);
    ctx2d.lineTo(padding, padding); // Eixo Y
    ctx2d.strokeStyle = '#000000';
    ctx2d.lineWidth = 2;
    ctx2d.stroke();

    // Desenhar legendas dos eixos
    ctx2d.font = '16px Arial';
    ctx2d.textAlign = 'center';
    ctx2d.fillText(xLabel, width / 2, height - 20); // Título do eixo X mais abaixo
    
    ctx2d.save();
    ctx2d.translate(15, height / 2);
    ctx2d.rotate(-Math.PI / 2);
    ctx2d.fillText(yLabel, 0, 0);
    ctx2d.restore();

    // Desenhar barras ou pontos
    const barWidth = (width - padding * 2) / xDataAsStrings.length * 0.8;
    const barSpacing = (width - padding * 2) / xDataAsStrings.length * 0.2;
    const barColor = '#3498db';

    for (let i = 0; i < xDataAsStrings.length; i++) {
        const x = padding + i * (barWidth + barSpacing) + barSpacing / 2;
        const barHeight = (yData[i] / maxY) * (height - padding - bottomPadding);
        const y = height - bottomPadding - barHeight;

        // Desenhar barra
        ctx2d.fillStyle = barColor;
        ctx2d.fillRect(x, y, barWidth, barHeight);

        // Valor acima da barra
        ctx2d.fillStyle = '#000000';
        ctx2d.textAlign = 'center';
        ctx2d.font = '12px Arial';
        ctx2d.fillText(yData[i].toString(), x + barWidth / 2, y - 5);

        // Rótulo do eixo X (rotacionado em 45 graus)
        ctx2d.save();
        ctx2d.translate(x + barWidth / 2, height - bottomPadding + 20);
        ctx2d.rotate(Math.PI / 4); // 45 graus em radianos
        ctx2d.textAlign = 'left';
        ctx2d.fillText(xDataAsStrings[i], 0, 0);
        ctx2d.restore();
    }

    // Salvar a imagem
    const buffer = canvas.toBuffer('image/png');
    fs.writeFileSync(filepath, buffer);

    // Enviar a imagem para o Telegram
    await ctx.telegram.sendPhoto(chatId, { source: filepath });

    // Remover o arquivo após o envio
    try {
        fs.unlinkSync(filepath);
    } catch (error) {
        console.error('Erro ao remover arquivo temporário:', error);
    }

    // Retornar uma descrição dummy do gráfico
    const descricao = `
📊 Análise do Gráfico: "${title}"

Este gráfico mostra a relação entre ${xLabel} e ${yLabel}.
Valores mais altos são observados em: ${xData[yData.indexOf(Math.max(...yData))]}.
Valores mais baixos são observados em: ${xData[yData.indexOf(Math.min(...yData))]}.

Valor médio: ${(yData.reduce((acc, val) => acc + val, 0) / yData.length).toFixed(2)}
Total: ${yData.reduce((acc, val) => acc + val, 0)}

Esta é uma descrição básica gerada automaticamente.
`;

    return descricao;
}

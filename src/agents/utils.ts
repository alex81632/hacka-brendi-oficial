import { OpenAI } from "openai";
import { productRepository } from "../database/repositories/productRepository.js";

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
      

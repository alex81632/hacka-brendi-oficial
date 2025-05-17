/**
 * Concrete HistoryAgent implementation.
 */
/* eslint-disable camelcase */
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ChatCompletionMessageParam } from 'openai/resources';
import { z } from 'zod';
import { getInformacaoDataHora, identifyProductByName } from './utils.js';
import { productRepository } from '../database/repositories/productRepository.js';
import { purchaseItemRepository } from '../database/repositories/purchaseItemRepository.js';
import { purchaseRepository } from '../database/repositories/purchaseRepository.js';
import { saleItemRepository } from '../database/repositories/saleItemRepository.js';
import { saleRepository } from '../database/repositories/saleRepository.js';

interface Product {
    id: number;
    name: string;
    inventory?: {
        quantity: number;
    };
    purchases?: Array<{
        costPrice: number;
    }>;
    sales?: Array<{
        unitPrice: number;
    }>;
}

// Funções auxiliares para métricas
async function getStockQuantity(productId?: number) {
    const products = await productRepository.findAll() as unknown as Product[];
    if (productId) {
        const product = products.find(p => p.id === productId);
        return product?.inventory?.quantity || 0;
    }
    return products.map(p => ({
        productId: p.id,
        name: p.name,
        quantity: p.inventory?.quantity || 0
    }));
}

async function getDailySales(productId?: number, startDate?: Date, endDate: Date = new Date()) {
    const sales = await saleRepository.getSalesSummaryByPeriod('daily', startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000), endDate);
    if (productId) {
        const productSales = await saleItemRepository.getProductSaleStats(productId, startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000), endDate);
        return productSales.averageQuantityPerSale;
    }
    return sales;
}

async function getStockValue() {
    const products = await productRepository.findAll() as unknown as Product[];
    return products.reduce((total, product) => {
        const quantity = product.inventory?.quantity || 0;
        const lastPurchase = product.purchases?.[0];
        const costPrice = lastPurchase?.costPrice || 0;
        return total + (quantity * costPrice);
    }, 0);
}

async function getStockLifetime(productId?: number) {
    const sales = await saleRepository.findAll();
    const purchases = await purchaseRepository.findAll();
    
    const lifetimes: number[] = [];
    
    for (const sale of sales) {
        for (const item of sale.items) {
            if (productId && item.productId !== productId) continue;
            
            const purchase = purchases.find(p => 
                p.items.some(pi => pi.productId === item.productId)
            );
            
            if (purchase) {
                const lifetime = sale.date.getTime() - purchase.date.getTime();
                lifetimes.push(lifetime / (24 * 60 * 60 * 1000)); // Converter para dias
            }
        }
    }
    
    return lifetimes.length ? lifetimes.reduce((a, b) => a + b) / lifetimes.length : 0;
}

async function getStockOutCount(productId?: number, startDate?: Date, endDate: Date = new Date()) {
    const start = startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const products = productId ? [await productRepository.findById(productId)] : await productRepository.findAll() as unknown as Product[];
    
    let stockOuts = 0;
    for (const product of products) {
        if (!product) continue;
        const inventoryItems = Array.isArray(product.inventory) ? product.inventory : [product.inventory];
        const totalQuantity = inventoryItems.reduce((sum, inv) => sum + (inv?.quantity || 0), 0);
        if (totalQuantity <= 0) {
            stockOuts++;
        }
    }
    
    return stockOuts;
}

async function getRequiredRestock(productId?: number) {
    const products = productId ? [await productRepository.findById(productId)] : await productRepository.findAll() as unknown as Product[];
    
    return products.map(product => {
        if (!product) return null;
        const inventoryItems = Array.isArray(product.inventory) ? product.inventory : [product.inventory];
        const currentStock = inventoryItems.reduce((sum, inv) => sum + (inv?.quantity || 0), 0);
        const averageDailySales = 0; // Implementar cálculo baseado no histórico
        const idealStock = averageDailySales * 30; // 30 dias de estoque
        return {
            productId: product.id,
            name: product.name,
            requiredQuantity: Math.max(0, idealStock - currentStock)
        };
    }).filter(Boolean);
}

async function getPurchaseExpenses(startDate?: Date, endDate: Date = new Date()) {
    const start = startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const purchases = await purchaseRepository.findByDateRange(start, endDate);
    
    return purchases.reduce((total, purchase) => total + purchase.totalCost, 0);
}

async function getProductRevenue(productId?: number, startDate?: Date, endDate: Date = new Date()) {
    const start = startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sales = await saleRepository.getSalesByProduct(start, endDate);
    
    if (productId) {
        return sales.find(s => s.productId === productId)?.totalValue || 0;
    }
    return sales;
}

async function getProductMargin(productId?: number) {
    const products = productId ? [await productRepository.findById(productId)] : await productRepository.findAll() as unknown as Product[];
    
    const results = [];
    for (const product of products) {
        if (!product) continue;
        
        // Buscar última venda
        const lastSale = await saleItemRepository.findByProductId(product.id);
        const lastSalePrice = lastSale?.[0]?.unitPrice;
        
        // Buscar última compra
        const lastPurchase = await purchaseItemRepository.findByProductId(product.id);
        const lastPurchasePrice = lastPurchase?.[0]?.costPrice;
        
        if (!lastSalePrice || !lastPurchasePrice) continue;
        
        results.push({
            productId: product.id,
            name: product.name,
            margin: lastSalePrice - lastPurchasePrice
        });
    }
    
    return results;
}

export class HistoryAgent {

    private openai: OpenAI;
    private model: string;
    private temperature: number;
    private config = {
        model: 'gpt-4.1-2025-04-14',
        temperature: 0,
    };
    private schema = z.object({
        reasoning: z.string(),
        response: z.string(),
    });
    private responseFormat = zodResponseFormat(this.schema, 'HistoryAgentResponse');
    private prompt = '';

    private buildPrompt() {
        this.prompt = `
        # AGENTE DE HISTÓRICO

        Você faz parte de um sistema de agentes que responde perguntas sobre o histórico de dados de uma empresa.

        # Objetivo
        - Responder perguntas sobre o histórico de dados de uma empresa.
        - Analisar os dados e fornecer respostas detalhadas sobre métricas de estoque e vendas.
        - Chame a função identifyProductByName para buscar o produto mais similar ao nome fornecido.

        # Métricas Disponíveis
        1. Quantidade em Estoque
           - Total de unidades disponíveis de cada produto
           - Use getStockQuantity()

        2. Vendas por Dia
           - Média de peças vendidas por dia para cada item
           - Use getDailySales()

        3. Valor em Dinheiro no Estoque
           - Soma do custo de todas as unidades em estoque
           - Use getStockValue()

        4. Tempo de Vida no Estoque
           - Média de dias que um produto fica guardado até ser vendido
           - Use getStockLifetime()

        5. Faltas no Estoque
           - Quantas vezes houve falta de produtos no mês
           - Use getStockOutCount()

        6. Reabastecimento Necessário
           - Quantidade necessária para voltar ao nível ideal
           - Use getRequiredRestock()

        7. Gasto com Compras
           - Total gasto em compras de mercadorias por período
           - Use getPurchaseExpenses()

        8. Receita por Produto
           - Valor arrecadado em vendas por item/período
           - Use getProductRevenue()

        9. Margem por Peça
           - Diferença entre preço de venda e custo por unidade
           - Use getProductMargin()

        # Exemplos de perguntas
        - "Qual o estoque atual do produto X?"
        - "Quantas unidades vendemos por dia do produto Y?"
        - "Qual o valor total em estoque?"
        - "Quanto tempo o produto Z fica em média no estoque?"
        - "Quantas vezes ficamos sem estoque este mês?"
        - "Preciso comprar mais unidades do produto W?"
        - "Quanto gastamos com compras no último mês?"
        - "Qual a receita do produto K no período?"
        - "Qual a margem de lucro por unidade do produto J?"

        # Dia de hoje
        - ${getInformacaoDataHora()}

        # Regras
        - Sempre identifique o produto usando identifyProductByName antes de buscar métricas específicas
        - Forneça contexto e explicações junto com os números
        - Use as funções apropriadas para cada tipo de métrica
        - Considere períodos padrão de 7 dias quando não especificado
        - De a resposta de maneira humanizada, com informações detalhadas e fáceis de entender. De o máximo de detalhes, como nome do produto, quantidade, valor, etc.
        `;
    }
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.model = this.config.model;
        this.temperature = this.config.temperature;
    }

    public async process(messages: ChatCompletionMessageParam[]): Promise<{
        reasoning: string;
        response: string;
    } | undefined> {
        try {
            this.buildPrompt();

            console.log(this.prompt);

            let filteredTools = tools;

            const maxIterations = 12;
            let currentMessages = [...messages];
            let lastResponse = null;
            const aiThoughts = [];

            for (let iteration = 1; iteration <= maxIterations; iteration++) {
                console.log(currentMessages);
                // eslint-disable-next-line no-await-in-loop
                const response = await this.openai.chat.completions.create({
                    model: this.model,
                    response_format: this.responseFormat,
                    temperature: this.temperature,
                    messages: [
                        {
                            role: 'system',
                            content: this.prompt,
                        },
                        ...currentMessages,
                    ],
                    tools: filteredTools,
                });

                lastResponse = response;
                const message = response.choices[0]?.message;

                if (!message) {
                    throw new Error('Nenhuma resposta do modelo encontrada');
                }

                if (message.tool_calls && message.tool_calls.length > 0) {
                    const toolCall = message.tool_calls[0];
                    if (!toolCall) {
                        throw new Error('Nenhuma tool call encontrada');
                    }

                    const toolName = toolCall.function.name;
                    let toolArgs;

                    try {
                        toolArgs = JSON.parse(toolCall.function.arguments || '{}');
                    } catch (error) {
                        throw new Error(`Erro ao analisar argumentos da ferramenta: ${error}`);
                    }

                    let toolCallResponse;
                    switch (toolName) {
                        case 'identifyProductByName':
                            toolCallResponse = await identifyProduct(toolArgs.name);
                            filteredTools = filteredTools.filter(tool => tool.function.name !== toolName);
                            break;
                        case 'getStockQuantity':
                            const productIdForStock = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                            const stockQuantity = await getStockQuantity(productIdForStock);
                            let stockResponse = '';
                            
                            if (Array.isArray(stockQuantity)) {
                                if (stockQuantity.length === 0) {
                                    stockResponse = 'Não há produtos em estoque.';
                                } else {
                                    stockResponse = stockQuantity.map(p => 
                                        `${p.name}: ${p.quantity} unidades`
                                    ).join('\n');
                                }
                            } else {
                                stockResponse = `${stockQuantity} unidades`;
                            }
                            
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Consultando quantidade em estoque',
                                    response: stockResponse
                                }
                            };
                            break;
                        case 'getDailySales':
                            const productIdForSales = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                            const startDateForSales = toolArgs.startDate && toolArgs.startDate !== "" ? new Date(toolArgs.startDate) : undefined;
                            const endDateForSales = toolArgs.endDate && toolArgs.endDate !== "" ? new Date(toolArgs.endDate) : new Date();
                            
                            const dailySales = await getDailySales(
                                productIdForSales,
                                startDateForSales,
                                endDateForSales
                            );
                            
                            let salesResponse = '';
                            if (typeof dailySales === 'number') {
                                salesResponse = `Média de ${dailySales.toFixed(2)} unidades vendidas por dia`;
                            } else if (Array.isArray(dailySales)) {
                                if (dailySales.length === 0) {
                                    salesResponse = 'Não há dados de vendas disponíveis para o período.';
                                } else {
                                    salesResponse = `Resumo de vendas por dia:\n${JSON.stringify(dailySales, null, 2)}`;
                                }
                            } else {
                                salesResponse = 'Dados de vendas indisponíveis.';
                            }
                            
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Analisando vendas diárias',
                                    response: salesResponse
                                }
                            };
                            break;
                        case 'getStockValue':
                            const stockValue = await getStockValue();
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Calculando valor total em estoque',
                                    response: `O valor total em estoque é de R$ ${stockValue.toFixed(2)}`
                                }
                            };
                            break;
                        case 'getStockLifetime':
                            const productIdForLifetime = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                            const lifetime = await getStockLifetime(productIdForLifetime);
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Calculando tempo médio em estoque',
                                    response: `Tempo médio em estoque: ${lifetime.toFixed(1)} dias`
                                }
                            };
                            break;
                        case 'getStockOutCount':
                            const productIdForStockOut = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                            const startDateForStockOut = toolArgs.startDate && toolArgs.startDate !== "" ? new Date(toolArgs.startDate) : undefined;
                            const endDateForStockOut = toolArgs.endDate && toolArgs.endDate !== "" ? new Date(toolArgs.endDate) : new Date();
                            
                            const stockOuts = await getStockOutCount(
                                productIdForStockOut,
                                startDateForStockOut,
                                endDateForStockOut
                            );
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Verificando faltas no estoque',
                                    response: `Houve ${stockOuts} ocorrência(s) de falta no estoque no período analisado`
                                }
                            };
                            break;
                        case 'getRequiredRestock':
                            const productIdForRestock = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                            const restock = await getRequiredRestock(productIdForRestock);
                            let restockResponse = '';
                            
                            if (Array.isArray(restock)) {
                                if (restock.length === 0) {
                                    restockResponse = 'Não há necessidade de reposição de estoque.';
                                } else {
                                    restockResponse = restock
                                        .filter(p => p !== null)
                                        .map(p => `${p.name}: ${p.requiredQuantity} unidades necessárias`)
                                        .join('\n');
                                }
                            } else {
                                restockResponse = 'Dados de reposição indisponíveis.';
                            }
                            
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Calculando necessidade de reposição',
                                    response: restockResponse
                                }
                            };
                            break;
                        case 'getPurchaseExpenses':
                            const startDateForExpenses = toolArgs.startDate && toolArgs.startDate !== "" ? new Date(toolArgs.startDate) : undefined;
                            const endDateForExpenses = toolArgs.endDate && toolArgs.endDate !== "" ? new Date(toolArgs.endDate) : new Date();
                            
                            const expenses = await getPurchaseExpenses(
                                startDateForExpenses,
                                endDateForExpenses
                            );
                            
                            const startDateStr = startDateForExpenses 
                                ? startDateForExpenses.toLocaleDateString('pt-BR') 
                                : new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR');
                            const endDateStr = endDateForExpenses 
                                ? endDateForExpenses.toLocaleDateString('pt-BR') 
                                : new Date().toLocaleDateString('pt-BR');
                            
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Calculando gastos com compras',
                                    response: `Total gasto com compras entre ${startDateStr} e ${endDateStr}: R$ ${expenses.toFixed(2)}`
                                }
                            };
                            break;
                        case 'getProductRevenue':
                            const productIdForRevenue = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                            const startDateForRevenue = toolArgs.startDate && toolArgs.startDate !== "" ? new Date(toolArgs.startDate) : undefined;
                            const endDateForRevenue = toolArgs.endDate && toolArgs.endDate !== "" ? new Date(toolArgs.endDate) : new Date();
                            
                            const revenue = await getProductRevenue(
                                productIdForRevenue,
                                startDateForRevenue,
                                endDateForRevenue
                            );
                            
                            let revenueResponse = '';
                            
                            const revStartDateStr = startDateForRevenue 
                                ? startDateForRevenue.toLocaleDateString('pt-BR') 
                                : new Date(new Date().getTime() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR');
                            const revEndDateStr = endDateForRevenue 
                                ? endDateForRevenue.toLocaleDateString('pt-BR') 
                                : new Date().toLocaleDateString('pt-BR');
                            
                            if (typeof revenue === 'number') {
                                revenueResponse = `Receita no período de ${revStartDateStr} a ${revEndDateStr}: R$ ${revenue.toFixed(2)}`;
                            } else if (Array.isArray(revenue)) {
                                if (revenue.length === 0) {
                                    revenueResponse = 'Não há dados de receita disponíveis para o período.';
                                } else {
                                    revenueResponse = `Receita por produto entre ${revStartDateStr} e ${revEndDateStr}:\n${JSON.stringify(
                                        revenue.map(r => ({
                                            ...r,
                                            totalValue: `R$ ${r.totalValue.toFixed(2)}`
                                        })), null, 2
                                    )}`;
                                }
                            } else {
                                revenueResponse = 'Dados de receita indisponíveis.';
                            }
                            
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Calculando receita de vendas',
                                    response: revenueResponse
                                }
                            };
                            break;
                        case 'getProductMargin':
                            const productIdForMargin = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                            const margin = await getProductMargin(productIdForMargin);
                            let responseText = '';
                            
                            if (Array.isArray(margin)) {
                                if (margin.length === 0) {
                                    responseText = 'Não foram encontradas informações de margem para este produto.';
                                } else if (margin.length === 1) {
                                    responseText = `Margem de lucro: R$ ${margin[0].margin.toFixed(2)} por unidade do produto ${margin[0].name}`;
                                } else {
                                    responseText = JSON.stringify(margin.map(m => ({
                                        ...m,
                                        margin: `R$ ${m.margin.toFixed(2)}`
                                    })));
                                }
                            } else {
                                responseText = 'Dados de margem indisponíveis.';
                            }
                            
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Calculando margem de lucro por unidade',
                                    response: responseText
                                }
                            };
                            break;
                        default:
                            throw new Error(`Ferramenta desconhecida: ${toolName}`);
                    }

                    if (!toolCallResponse) {
                        throw new Error('Nenhuma resposta da função encontrada');
                    }

                    console.log(`[HistoryAgent] Tool call (${toolName}: ${JSON.stringify(toolArgs)}) response: ${toolCallResponse.response.response}`);

                    if (toolCallResponse.final) {
                        return this.schema.parse(toolCallResponse.response);
                    }
                    // Atualizar as mensagens mantendo o contexto das chamadas de ferramentas
                    currentMessages = [
                        ...currentMessages,
                        {
                            role: 'assistant',
                            content: null,
                            tool_calls: [toolCall],
                        },
                        {
                            role: 'tool',
                            content: JSON.stringify(toolCallResponse.response.response),
                            tool_call_id: toolCall.id,
                        },
                    ];
                } else {
                    const content = message.content;
                    if (!content) {
                        throw new Error('Nenhuma resposta do modelo');
                    }
                    try {
                        const parsedContent = JSON.parse(content);
                        aiThoughts.push(parsedContent.aiThoughts);
                        return this.schema.parse({
                            ...parsedContent,
                            aiThoughts: aiThoughts.join('\n'),
                        });
                    } catch (error) {
                        throw new Error(`Erro ao analisar resposta do modelo: ${error}`);
                    }
                }
            }

            // Se chegou aqui, processa a última resposta
            if (!lastResponse) {
                throw new Error('Nenhuma resposta válida após todas as iterações');
            }
        } catch (error) {
            throw new Error(`Error in HistoryAgent: ${error}`);
        }
    }
}


/**
 * Array de ferramentas disponíveis para o agente
 */
export const tools = [
    {
        type: 'function' as const,
        function: {
            name: 'identifyProductByName',
            description: 'Retorna o produto mais similar ao nome fornecido',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    name: { type: 'string', description: 'Nome do produto a ser buscado' },
                },
                required: ['name'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getStockQuantity',
            description: 'Retorna a quantidade em estoque de um produto ou todos os produtos',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional)' },
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getDailySales',
            description: 'Retorna a média de vendas diárias de um produto ou todos os produtos',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional)' },
                    startDate: { type: 'string', description: 'Data inicial no formato YYYY-MM-DD (opcional)' },
                    endDate: { type: 'string', description: 'Data final no formato YYYY-MM-DD (opcional)' },
                },
                required: ['productId', 'startDate', 'endDate'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getStockValue',
            description: 'Retorna o valor total em dinheiro do estoque atual',
            strict: true,
            parameters: {
                type: 'object',
                properties: {},
                required: [],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getStockLifetime',
            description: 'Retorna o tempo médio que um produto fica em estoque até ser vendido',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional)' },
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getStockOutCount',
            description: 'Retorna quantas vezes ficou sem estoque no período',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional)' },
                    startDate: { type: 'string', description: 'Data inicial no formato YYYY-MM-DD (opcional)' },
                    endDate: { type: 'string', description: 'Data final no formato YYYY-MM-DD (opcional)' },
                },
                required: ['productId', 'startDate', 'endDate'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getRequiredRestock',
            description: 'Retorna a quantidade necessária para reposição do estoque',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional)' },
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getPurchaseExpenses',
            description: 'Retorna o total gasto com compras no período',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    startDate: { type: 'string', description: 'Data inicial no formato YYYY-MM-DD (opcional)' },
                    endDate: { type: 'string', description: 'Data final no formato YYYY-MM-DD (opcional)' },
                },
                required: ['startDate', 'endDate'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getProductRevenue',
            description: 'Retorna a receita de vendas por produto no período',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional)' },
                    startDate: { type: 'string', description: 'Data inicial no formato YYYY-MM-DD (opcional)' },
                    endDate: { type: 'string', description: 'Data final no formato YYYY-MM-DD (opcional)' },
                },
                required: ['productId', 'startDate', 'endDate'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getProductMargin',
            description: 'Retorna a margem de lucro por unidade do produto',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional)' },
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
];

export const identifyProduct = async (name: string): Promise<{
    final: boolean;
    response: {
        reasoning: string;
        response: string;
    }
}> => {
    const product = await identifyProductByName(name);
    return {
        final: false,
        response: {
            reasoning: 'Resposta de exemplo',
            response: `Produto encontrado: ${product?.product.name} com ID: ${product?.product.id}`,
        },
    };
};
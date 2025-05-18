/**
 * Concrete HistoryAgent implementation.
 */
/* eslint-disable camelcase */
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ChatCompletionMessageParam } from 'openai/resources';
import { z } from 'zod';
import { getInformacaoDataHora, identifyProductByName, getPersonality, criarEEnviarGrafico } from './utils.js';
import { productRepository } from '../database/repositories/productRepository.js';
import { purchaseItemRepository } from '../database/repositories/purchaseItemRepository.js';
import { purchaseRepository } from '../database/repositories/purchaseRepository.js';
import { saleItemRepository } from '../database/repositories/saleItemRepository.js';
import { saleRepository } from '../database/repositories/saleRepository.js';
import { inventoryRepository } from '../database/repositories/inventoryRepository.js';
import { warehouseRepository } from '../database/repositories/warehouseRepository.js';
import { sellerRepository } from '../database/repositories/sellerRepository.js';
import { customerRepository } from '../database/repositories/customerRepository.js';
import { categoryRepository } from '../database/repositories/categoryRepository.js';
import { supplierRepository } from '../database/repositories/supplierRepository.js';
import { prisma } from '../database/prisma.js';
import { Context } from 'telegraf';

// Adicionar interface no início do arquivo, após os imports
interface WarehouseDistribution {
    warehouseName: string;
    warehouseId: number;
    quantity: number;
}

// Função auxiliar para formatar valores numéricos com segurança
function formatCurrency(value: any): string {
    if (typeof value === 'number') {
        return value.toFixed(2);
    }
    return '0.00';
}

// Funções auxiliares para métricas
async function getStockQuantity(productId?: number) {
    if (productId) {
        const inventoryItems = await inventoryRepository.findByProduct(productId);
        if (!inventoryItems || inventoryItems.length === 0) {
            return {
                total: 0,
                warehouseDistribution: []
            };
        }
        
        // Agrupa por armazém e ordena por quantidade
        const warehouseDistribution = inventoryItems
            .map(item => ({
                warehouseName: item.warehouse.name,
                warehouseId: item.warehouseId,
                quantity: item.quantity
            }))
            .sort((a, b) => b.quantity - a.quantity);
        
        // Soma total
        const total = warehouseDistribution.reduce((sum, item) => sum + item.quantity, 0);
        
        return {
            total,
            productName: inventoryItems[0].product.name,
            warehouseDistribution
        };
    }
    
    // Caso não seja fornecido um ID específico, agrupa o estoque por produto e armazém
    const allInventory = await inventoryRepository.findAll();
    
    // Agrupa e soma as quantidades por produto
    const productQuantities = allInventory.reduce((result, item) => {
        const productId = item.productId;
        
        if (!result[productId]) {
            result[productId] = {
                productId,
                name: item.product.name,
                total: 0,
                warehouseDistribution: []
            };
        }
        
        result[productId].total += item.quantity;
        result[productId].warehouseDistribution.push({
            warehouseName: item.warehouse.name,
            warehouseId: item.warehouseId,
            quantity: item.quantity
        });
        
        return result;
    }, {} as Record<number, any>);
    
    // Converte para array e ordena por quantidade total
    return Object.values(productQuantities)
        .map(product => ({
            ...product,
            warehouseDistribution: product.warehouseDistribution.sort((a: WarehouseDistribution, b: WarehouseDistribution) => b.quantity - a.quantity)
        }))
        .sort((a, b) => b.total - a.total);
}

async function getDailySales(productId?: number, startDate?: Date, endDate: Date = new Date()) {
    const start = startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    if (productId && productId !== 0) {
        // Buscar estatísticas específicas do produto
        const productSales = await saleItemRepository.getProductSaleStats(productId, start, endDate);
        
        // Adicionar informações sobre quais vendedores venderam este produto
        const productSellerStats = await getProductSellerStats(productId, start, endDate);
        
        // Buscar todas as vendas que contém este produto no período
        const sales = await saleRepository.findByDateRange(start, endDate);
        
        // Filtrar apenas vendas que incluem o produto específico
        const relevantSales = sales.filter(sale => 
            sale.items.some(item => item.productId === productId)
        );
        
        // Agrupar vendas por dia
        const salesByDay: Record<string, { date: string, quantity: number, value: number }> = {};
        
        relevantSales.forEach(sale => {
            const saleDate = sale.date.toISOString().split('T')[0]; // YYYY-MM-DD
            
            if (!salesByDay[saleDate]) {
                salesByDay[saleDate] = {
                    date: saleDate,
                    quantity: 0,
                    value: 0
                };
            }
            
            // Somar apenas os itens deste produto
            const productItems = sale.items.filter(item => item.productId === productId);
            salesByDay[saleDate].quantity += productItems.reduce((sum, item) => sum + item.quantity, 0);
            salesByDay[saleDate].value += productItems.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
        });
        
        return {
            averageQuantityPerSale: productSales.averageQuantityPerSale,
            totalQuantity: productSales.totalQuantity,
            salesCount: productSales.salesCount,
            sellerStats: productSellerStats,
            dailySales: Object.values(salesByDay).sort((a, b) => a.date.localeCompare(b.date))
        };
    }
    
    // Obter resumo de vendas diárias
    const dailySales = await saleRepository.getSalesSummaryByPeriod('daily', start, endDate);
    
    // Adicionar vendas por categoria
    const salesByCategory = await categoryRepository.getSalesByCategory(start, endDate);
    
    // Adicionar desempenho dos vendedores
    const sellerPerformance = await sellerRepository.getSalesPerformance(start, endDate);
    
    return {
        dailySummary: dailySales,
        categoryBreakdown: salesByCategory,
        sellerPerformance: sellerPerformance
    };
}

// Função auxiliar para obter estatísticas de vendas por vendedor para um produto específico
async function getProductSellerStats(productId: number, startDate: Date, endDate: Date) {
    const sellers = await sellerRepository.findAll();
    const stats = [];
    
    for (const seller of sellers) {
        const sales = await sellerRepository.findSalesByPeriod(seller.id, startDate, endDate);
        
        // Filtrar apenas vendas que incluem o produto específico
        const relevantSales = sales.filter(sale => 
            sale.items.some(item => item.productId === productId)
        );
        
        if (relevantSales.length > 0) {
            const totalQuantity = relevantSales.reduce((sum, sale) => {
                const items = sale.items.filter(item => item.productId === productId);
                return sum + items.reduce((itemSum, item) => itemSum + item.quantity, 0);
            }, 0);
            
            stats.push({
                sellerId: seller.id,
                sellerName: seller.name,
                salesCount: relevantSales.length,
                totalQuantity
            });
        }
    }
    
    return stats.sort((a, b) => b.totalQuantity - a.totalQuantity);
}

async function getStockValue() {
    const inventory = await inventoryRepository.findAll();
    let totalValue = 0;
    
    // Mapa para armazenar o valor por categoria
    const categoryValues: Record<number, { categoryId: number, categoryName: string, value: number }> = {};
    
    // Mapa para armazenar o valor por armazém
    const warehouseValues: Record<number, { warehouseId: number, warehouseName: string, value: number }> = {};
    
    for (const item of inventory) {
        const product = item.product;
        const quantity = item.quantity;
        const costPrice = product.cost || 0;
        const itemValue = quantity * costPrice;
        
        totalValue += itemValue;
        
        // Agregar valor por categoria
        if (product.categoryId) {
            // Buscar categoria se necessário
            const categoryName = product.categoryId ? 
                (await categoryRepository.findById(product.categoryId))?.name || 'Sem categoria' : 
                'Sem categoria';
                
            if (!categoryValues[product.categoryId]) {
                categoryValues[product.categoryId] = {
                    categoryId: product.categoryId,
                    categoryName: categoryName,
                    value: 0
                };
            }
            categoryValues[product.categoryId].value += itemValue;
        }
        
        // Agregar valor por armazém
        if (!warehouseValues[item.warehouseId]) {
            warehouseValues[item.warehouseId] = {
                warehouseId: item.warehouseId,
                warehouseName: item.warehouse.name,
                value: 0
            };
        }
        warehouseValues[item.warehouseId].value += itemValue;
    }
    
    return {
        totalValue,
        byCategory: Object.values(categoryValues).sort((a, b) => b.value - a.value),
        byWarehouse: Object.values(warehouseValues).sort((a, b) => b.value - a.value)
    };
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
    // Usando o inventoryRepository.findLowStock com threshold 0
    const lowStockItems = await inventoryRepository.findLowStock(0);
    
    // Se um productId específico for fornecido
    if (productId) {
        return lowStockItems.filter(item => item.productId === productId).length;
    }
    
    // Agrupar por produto para contar stockouts únicos por produto
    const productStockOuts = lowStockItems.reduce((acc, item) => {
        if (!acc[item.productId]) {
            acc[item.productId] = {
                productId: item.productId,
                productName: item.product.name,
                warehousesWithStockOut: []
            };
        }
        acc[item.productId].warehousesWithStockOut.push({
            warehouseId: item.warehouseId,
            warehouseName: item.warehouse.name
        });
        return acc;
    }, {} as Record<number, any>);
    
    // Também podemos aproveitar a funcionalidade do categoryRepository
    const categoriesWithLowStock = await categoryRepository.getCategoriesWithLowStock(0);
    
    return {
        totalStockOuts: Object.keys(productStockOuts).length,
        productStockOuts: Object.values(productStockOuts),
        categoriesWithStockOut: categoriesWithLowStock
    };
}

async function getPurchaseExpenses(startDate?: Date, endDate: Date = new Date()) {
    const start = startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    const purchases = await purchaseRepository.findByDateRange(start, endDate);
    
    // Calcular total geral
    const totalExpenses = purchases.reduce((total, purchase) => total + purchase.totalCost, 0);
    
    // Agrupar por fornecedor
    const supplierExpenses = new Map<number, { 
        supplierId: number;
        supplierName: string;
        totalValue: number;
        purchaseCount: number;
    }>();
    
    // Agrupar por categoria
    const categoryExpenses = new Map<number, {
        categoryId: number;
        categoryName: string;
        totalValue: number;
        itemCount: number;
    }>();
    
    // Processar cada compra
    for (const purchase of purchases) {
        // Processar fornecedor
        if (purchase.supplierId) {
            const supplier = await supplierRepository.findById(purchase.supplierId);
            if (supplier) {
                const current = supplierExpenses.get(supplier.id) || {
                    supplierId: supplier.id,
                    supplierName: supplier.name,
                    totalValue: 0,
                    purchaseCount: 0
                };
                current.totalValue += purchase.totalCost;
                current.purchaseCount++;
                supplierExpenses.set(supplier.id, current);
            }
        }
        
        // Processar categorias dos itens
        for (const item of purchase.items) {
            if (item.product?.categoryId) {
                const category = await categoryRepository.findById(item.product.categoryId);
                if (category) {
                    const current = categoryExpenses.get(category.id) || {
                        categoryId: category.id,
                        categoryName: category.name,
                        totalValue: 0,
                        itemCount: 0
                    };
                    current.totalValue += item.quantity * item.costPrice;
                    current.itemCount += item.quantity;
                    categoryExpenses.set(category.id, current);
                }
            }
        }
    }
    
    return {
        totalExpenses,
        bySupplier: Array.from(supplierExpenses.values())
            .sort((a, b) => b.totalValue - a.totalValue),
        byCategory: Array.from(categoryExpenses.values())
            .sort((a, b) => b.totalValue - a.totalValue)
    };
}

async function getProductRevenue(productId?: number, startDate?: Date, endDate: Date = new Date()) {
    const start = startDate || new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    if (productId) {
        // Se um produto específico for solicitado, buscar informações detalhadas
        const productSales = await saleItemRepository.getProductSaleStats(productId, start, endDate);
        
        // Adicionar info de vendas por vendedor para este produto
        const sellerData = await getProductSellerStats(productId, start, endDate);
        
        // Adicionar info de clientes que compraram o produto
        const customerData = await getProductCustomerStats(productId, start, endDate);
        
        return {
            productId,
            totalRevenue: productSales.totalRevenue,
            totalQuantity: productSales.totalQuantity,
            salesCount: productSales.salesCount,
            averagePricePerUnit: productSales.averagePricePerUnit,
            sellerData,
            customerData
        };
    }
    
    // Buscar dados gerais de vendas por produto
    const salesByProduct = await saleRepository.getSalesByProduct(start, endDate);
    
    // Adicionar informações de vendas por categoria
    const salesByCategory = await categoryRepository.getSalesByCategory(start, endDate);
    
    return {
        byProduct: salesByProduct,
        byCategory: salesByCategory
    };
}

// Função auxiliar para obter estatísticas de clientes para um produto específico
async function getProductCustomerStats(productId: number, startDate: Date, endDate: Date) {
    const customers = await customerRepository.findAll();
    const stats = [];
    
    for (const customer of customers) {
        const purchaseHistory = await customerRepository.getPurchaseHistory(customer.id);
        
        // Filtrar apenas compras no período e que incluem o produto
        const relevantPurchases = purchaseHistory.filter(purchase => {
            const purchaseDate = new Date(purchase.date);
            return (
                purchaseDate >= startDate && 
                purchaseDate <= endDate &&
                purchase.items.some(item => item.productId === productId)
            );
        });
        
        if (relevantPurchases.length > 0) {
            const totalQuantity = relevantPurchases.reduce((sum, purchase) => {
                const items = purchase.items.filter(item => item.productId === productId);
                return sum + items.reduce((itemSum, item) => itemSum + item.quantity, 0);
            }, 0);
            
            const totalSpent = relevantPurchases.reduce((sum, purchase) => {
                const items = purchase.items.filter(item => item.productId === productId);
                return sum + items.reduce((itemSum, item) => itemSum + (item.quantity * item.unitPrice), 0);
            }, 0);
            
            stats.push({
                customerId: customer.id,
                customerName: customer.name,
                purchaseCount: relevantPurchases.length,
                totalQuantity,
                totalSpent
            });
        }
    }
    
    return stats.sort((a, b) => b.totalQuantity - a.totalQuantity);
}

async function getProductMargin(productId?: number) {
    if (productId) {
        // Buscar informações detalhadas do produto
        const product = await productRepository.findById(productId);
        if (!product) {
            return [];
        }
        
        // Buscar última venda
        const lastSale = await saleItemRepository.findByProductId(product.id);
        const lastSalePrice = lastSale?.[0]?.unitPrice;
        
        // Buscar última compra
        const lastPurchase = await purchaseItemRepository.findByProductId(product.id);
        const lastPurchasePrice = lastPurchase?.[0]?.costPrice;
        
        if (!lastSalePrice || !lastPurchasePrice) {
            return [];
        }
        
        const margin = lastSalePrice - lastPurchasePrice;
        const marginPercentage = (margin / lastPurchasePrice) * 100;
        
        // Obter fornecedor do produto
        const supplier = product.supplierId ? 
            await supplierRepository.findById(product.supplierId) : null;
        
        return [{
            productId: product.id,
            name: product.name,
            costPrice: lastPurchasePrice,
            salePrice: lastSalePrice,
            margin,
            marginPercentage,
            supplier: supplier ? {
                id: supplier.id,
                name: supplier.name
            } : null
        }];
    }
    
    // Buscar todos os produtos
    const products = await productRepository.findAll();
    const result = [];
    
    // Calcular margem para cada produto
    for (const product of products) {
        // Buscar última venda
        const lastSale = await saleItemRepository.findByProductId(product.id);
        const lastSalePrice = lastSale?.[0]?.unitPrice;
        
        // Buscar última compra
        const lastPurchase = await purchaseItemRepository.findByProductId(product.id);
        const lastPurchasePrice = lastPurchase?.[0]?.costPrice;
        
        if (!lastSalePrice || !lastPurchasePrice) continue;
        
        const margin = lastSalePrice - lastPurchasePrice;
        const marginPercentage = (margin / lastPurchasePrice) * 100;
        
        // Obter fornecedor do produto
        const supplier = product.supplierId ? 
            await supplierRepository.findById(product.supplierId) : null;
            
        // Obter categoria
        const category = product.categoryId ?
            await categoryRepository.findById(product.categoryId) : null;
        
        result.push({
            productId: product.id,
            name: product.name,
            costPrice: lastPurchasePrice,
            salePrice: lastSalePrice,
            margin,
            marginPercentage,
            supplier: supplier ? {
                id: supplier.id,
                name: supplier.name
            } : null,
            category: category ? {
                id: category.id,
                name: category.name
            } : null
        });
    }
    
    // Ordenar por margem (valor absoluto)
    return result.sort((a, b) => b.margin - a.margin);
}

/**
 * Retorna os 10 melhores produtos ranqueados por diferentes métricas
 * em um período específico.
 */
async function getTopProducts(startDate?: Date, endDate: Date = new Date(), limit: number = 10) {
    // Validar datas
    if (!startDate || isNaN(startDate.getTime())) {
        console.error("[getTopProducts] Data inicial inválida, usando data padrão");
        startDate = new Date();
        startDate.setDate(startDate.getDate() - 30);
    }
    
    if (!endDate || isNaN(endDate.getTime())) {
        console.error("[getTopProducts] Data final inválida, usando data atual");
        endDate = new Date();
    }
    
    console.log(`[getTopProducts] Período: ${startDate.toISOString()} - ${endDate.toISOString()}`);
    
    // 1. Ranking por quantidade vendida
    const topByQuantity = await saleItemRepository.getTopSellingProducts(startDate, endDate, limit);
    
    // 2. Buscar todas as vendas no período
    const sales = await saleRepository.findByDateRange(startDate, endDate);
    
    // Mapeamento para calcular valor total de vendas e lucro
    const productSaleMap: Record<number, {
        productId: number;
        productName: string;
        totalRevenue: number;
        totalQuantity: number;
        costPrice: number | null;
        profit: number;
    }> = {};
    
    // Processar todas as vendas e seus itens
    for (const sale of sales) {
        for (const item of sale.items) {
            const productId = item.productId;
            
            if (!productSaleMap[productId]) {
                // Buscar último custo do produto para calcular lucro
                const lastPurchase = await purchaseItemRepository.findByProductId(productId);
                const costPrice = lastPurchase?.[0]?.costPrice || null;
                
                // Buscar produto para obter nome
                const product = await productRepository.findById(productId);
                
                productSaleMap[productId] = {
                    productId,
                    productName: product?.name || `Produto #${productId}`,
                    totalRevenue: 0,
                    totalQuantity: 0,
                    costPrice,
                    profit: 0
                };
            }
            
            productSaleMap[productId].totalRevenue += item.quantity * item.unitPrice;
            productSaleMap[productId].totalQuantity += item.quantity;
            
            // Calcular lucro se tiver preço de custo
            if (productSaleMap[productId].costPrice) {
                productSaleMap[productId].profit += 
                    item.quantity * (item.unitPrice - productSaleMap[productId].costPrice);
            }
        }
    }
    
    const products = Object.values(productSaleMap);
    
    // 2. Ranking por valor (receita)
    const topByRevenue = [...products]
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .slice(0, limit)
        .map(product => ({
            productId: product.productId,
            productName: product.productName,
            totalRevenue: product.totalRevenue,
            totalQuantity: product.totalQuantity
        }));
    
    // 3. Ranking por lucro 
    const topByProfit = [...products]
        .filter(product => product.costPrice !== null)  // Filtra apenas produtos com custo conhecido
        .sort((a, b) => b.profit - a.profit)
        .slice(0, limit)
        .map(product => ({
            productId: product.productId,
            productName: product.productName,
            profit: product.profit,
            totalQuantity: product.totalQuantity,
            costPrice: product.costPrice
        }));
    
    return {
        byQuantity: topByQuantity,
        byRevenue: topByRevenue,
        byProfit: topByProfit
    };
}

/**
 * Função auxiliar para validar e corrigir datas
 * Garante que retorne uma data válida, mesmo que a entrada seja inválida
 */
function validateAndFixDate(date: Date | string | undefined, defaultOffset: number = 0): Date {
    let validDate: Date;
    
    if (!date) {
        // Se não foi fornecida uma data, usar a data atual com o offset
        validDate = new Date();
        if (defaultOffset !== 0) {
            validDate.setDate(validDate.getDate() + defaultOffset);
        }
        return validDate;
    }
    
    // Se for uma string, tentar converter para Date
    if (typeof date === 'string') {
        // Verificar se é um formato DD/MM/YYYY
        if (date.includes('/')) {
            const parts = date.split('/');
            if (parts.length === 3) {
                // Convertendo de DD/MM/YYYY para YYYY-MM-DD
                try {
                    validDate = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
                    if (!isNaN(validDate.getTime())) {
                        return validDate;
                    }
                } catch (e) {
                    console.error(`Erro ao converter data (${date})`, e);
                }
            }
        }
        
        // Tentar parse normal
        validDate = new Date(date);
    } else {
        // Já é um objeto Date
        validDate = date;
    }
    
    // Verificar se a data é válida
    if (isNaN(validDate.getTime())) {
        console.error(`Data inválida: ${date}, usando data padrão`);
        validDate = new Date();
        if (defaultOffset !== 0) {
            validDate.setDate(validDate.getDate() + defaultOffset);
        }
    }
    
    return validDate;
}

export class HistoryAgent {

    private openai: OpenAI;
    private model: string;
    private temperature: number;
    private telegramContext: Context | null = null;
    private chatId: number | null = null;
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
        - Analisar os dados e fornecer respostas detalhadas sobre métricas de estoque, vendas, fornecedores, clientes e categorias.
        - Chame a função identifyProductByName para buscar o produto mais similar ao nome fornecido.

        ${getPersonality()}

        # Métricas Disponíveis
        1. Quantidade em Estoque
           - Total de unidades disponíveis de cada produto
           - Distribuição por armazém 
           - Use getStockQuantity()

        2. Vendas por Dia
           - Média de peças vendidas por dia para cada item
           - Análise por vendedor e categoria
           - Use getDailySales()

        3. Valor em Dinheiro no Estoque
           - Soma do custo de todas as unidades em estoque
           - Análise por categoria e armazém
           - Use getStockValue()

        4. Tempo de Vida no Estoque
           - Média de dias que um produto fica guardado até ser vendido
           - Use getStockLifetime()

        5. Faltas no Estoque
           - Quantas vezes houve falta de produtos
           - Análise por categoria e armazém
           - Use getStockOutCount()

        6. Gasto com Compras
           - Total gasto em compras de mercadorias por período
           - Análise por fornecedor e categoria
           - Use getPurchaseExpenses()

        7. Receita por Produto
           - Valor arrecadado em vendas por item/período
           - Análise por vendedor e cliente
           - Use getProductRevenue()

        8. Margem por Peça
           - Diferença entre preço de venda e custo por unidade
           - Análise por fornecedor e categoria
           - Use getProductMargin()
        
        9. Visualização Gráfica
           - Cria um gráfico com os dados fornecidos
           - Envia o gráfico para o usuário via Telegram
           - Use createChart() para visualizar dados de forma gráfica
           - Você pode criar gráficos para vendas, estoque, margem, receita, etc.

        10. Top 10 Produtos
           - Rankings dos 10 melhores produtos por diferentes métricas
           - Por quantidade vendida, valor de vendas e lucro
           - Use getTopProducts()
           - Ideal para análise de desempenho de produtos

        # Sobre os Gráficos
        - Os gráficos são uma excelente forma de visualizar dados e tendências
        - Use createChart() quando o usuário pedir para visualizar dados ou quando for útil mostrar tendências
        - Para o eixo X, você pode usar: datas, nomes de produtos, categorias, fornecedores, etc.
        - Para o eixo Y, você pode usar: quantidades, valores monetários, percentuais, etc.
        - Escolha um título claro que represente os dados mostrados
        - Use legendas adequadas para os eixos X e Y

        # Dia de hoje
        - ${getInformacaoDataHora()}

        # Regras
        - Formate as respostas de maneira clara e legível, com títulos e subtítulos, emojis e quebras de linha.
        - Sempre identifique o produto usando identifyProductByName antes de buscar métricas específicas
        - Nunca sugira métricas que não estão disponíveis nas funções
        - Apenas use as funções que estão disponíveis
        - Forneça contexto e explicações junto com os números
        - Use as funções apropriadas para cada tipo de métrica
        - Considere períodos padrão de 7 dias quando não especificado
        - De a resposta de maneira humanizada, com informações detalhadas e fáceis de entender. De o máximo de detalhes, como nome do produto, quantidade, valor, fornecedor, categoria, etc.
        - Utilize todas as informações disponíveis nas funções para oferecer análises completas.
        - Quando o usuário pedir um gráfico ou quando for útil mostrar tendências visualmente, use a função createChart()
        `;
    }
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.model = this.config.model;
        this.temperature = this.config.temperature;
    }

    public setTelegramContext(ctx: Context, chatId: number) {
        this.telegramContext = ctx;
        this.chatId = chatId;
    }

    public async process(messages: ChatCompletionMessageParam[]): Promise<{
        reasoning: string;
        response: string;
    } | undefined> {
        try {
            this.buildPrompt();

            let filteredTools = tools;

            const maxIterations = 12;
            let currentMessages = [...messages];
            let lastResponse = null;
            const aiThoughts = [];

            for (let iteration = 1; iteration <= maxIterations; iteration++) {
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
                        case 'createChart':
                            if (!this.telegramContext || !this.chatId) {
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Não foi possível criar o gráfico',
                                        response: 'Não foi possível criar o gráfico devido à falta de contexto do Telegram'
                                    }
                                };
                                break;
                            }
                            
                            try {
                                // Verificar se todos os campos necessários estão presentes
                                if (!toolArgs.xData || !toolArgs.yData) {
                                    throw new Error('Os dados dos eixos X e Y são obrigatórios');
                                }
                                
                                // Usar valores padrão para campos opcionais
                                const title = toolArgs.title || 'Gráfico';
                                const xLabel = toolArgs.xLabel || 'Eixo X';
                                const yLabel = toolArgs.yLabel || 'Eixo Y';
                                
                                const descricao = await criarEEnviarGrafico(
                                    toolArgs.xData,
                                    toolArgs.yData,
                                    title,
                                    xLabel,
                                    yLabel,
                                    this.telegramContext,
                                    this.chatId
                                );
                                
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Gráfico criado e enviado com sucesso',
                                        response: descricao
                                    }
                                };
                            } catch (error: any) {
                                console.error('[createChart] Erro:', error);
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Erro ao criar o gráfico',
                                        response: `Não foi possível criar o gráfico: ${error.message}`
                                    }
                                };
                            }
                            break;
                        case 'getStockQuantity':
                            const productIdForStock = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                            const stockQuantity = await getStockQuantity(productIdForStock);
                            let stockResponse = '';
                            
                            if (Array.isArray(stockQuantity)) {
                                if (stockQuantity.length === 0) {
                                    stockResponse = '📦 Não há produtos em estoque.';
                                } else {
                                    stockResponse = '📊 Resumo do Estoque por Produto:\n\n' +
                                        stockQuantity.map(p => 
                                            `🏷️ ${p.name}\n` +
                                            `   Total: ${p.total} unidades\n` +
                                            `   Distribuição por Armazém:\n` +
                                            p.warehouseDistribution.map((w: WarehouseDistribution) => 
                                                `   • ${w.warehouseName}: ${w.quantity} unidades`
                                            ).join('\n')
                                        ).join('\n\n');
                                }
                            } else {
                                stockResponse = `📦 ${stockQuantity.productName}\n` +
                                    `Total em Estoque: ${stockQuantity.total} unidades\n\n` +
                                    `Distribuição por Armazém:\n` +
                                    stockQuantity.warehouseDistribution.map((w: WarehouseDistribution) => 
                                        `• ${w.warehouseName}: ${w.quantity} unidades`
                                    ).join('\n');
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
                            // Validar e corrigir datas de entrada
                            const startDateForSales = validateAndFixDate(
                                toolArgs.startDate && toolArgs.startDate !== "" ? toolArgs.startDate : undefined, 
                                -30
                            );
                            const endDateForSales = validateAndFixDate(
                                toolArgs.endDate && toolArgs.endDate !== "" ? toolArgs.endDate : undefined
                            );
                            
                            // Garantir que a data inicial é anterior à final
                            if (startDateForSales > endDateForSales) {
                                console.warn("[getDailySales] Data inicial posterior à final, trocando datas");
                                const temp = startDateForSales;
                                startDateForSales.setTime(endDateForSales.getTime());
                                endDateForSales.setTime(temp.getTime());
                            }
                            
                            const productIdForSales = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                            
                            console.log(`[getDailySales] Buscando vendas ${productIdForSales ? `do produto #${productIdForSales}` : 'gerais'} de ${startDateForSales.toISOString()} até ${endDateForSales.toISOString()}`);
                            
                            const dailySales = await getDailySales(
                                productIdForSales,
                                startDateForSales,
                                endDateForSales
                            );
                            
                            let salesResponse = '';
                            
                            if (productIdForSales) {
                                // Formatação para produto específico
                                salesResponse = `📊 Análise de Vendas do Produto\n\n` +
                                    `Média por venda: ${dailySales.averageQuantityPerSale?.toFixed(2) || 0} unidades\n` +
                                    `Total vendido: ${dailySales.totalQuantity || 0} unidades\n` +
                                    `Número de vendas: ${dailySales.salesCount || 0}\n\n` +
                                    `👥 Performance por Vendedor:\n` +
                                    (dailySales.sellerStats?.length ? 
                                        dailySales.sellerStats.map(seller => 
                                            `- ${seller.sellerName}: ${seller.totalQuantity} unidades em ${seller.salesCount} vendas`
                                        ).join('\n') : 
                                        'Nenhuma venda por vendedor registrada');
                                        
                                // Adicionar informações de vendas diárias se disponíveis
                                if (dailySales.dailySales?.length) {
                                    salesResponse += `\n\n📅 Vendas por Dia:\n`;
                                    
                                    dailySales.dailySales.forEach(day => {
                                        salesResponse += `- ${new Date(day.date).toLocaleDateString('pt-BR')}: ${day.quantity} unidades (R$ ${formatCurrency(day.value)})\n`;
                                    });
                                }
                            } else {
                                // Formatação para resumo geral
                                salesResponse = `📈 Resumo Geral de Vendas\n\n` +
                                    `🗓️ Vendas Diárias:\n` +
                                    (dailySales.dailySummary?.length ? 
                                        dailySales.dailySummary.map(day => 
                                            `- ${new Date(day.period).toLocaleDateString('pt-BR')}: ${day.itemsSold} unidades (R$ ${formatCurrency(day.totalValue)})`
                                        ).join('\n') : 
                                        'Nenhuma venda registrada no período\n') +
                                    `\n📦 Vendas por Categoria:\n` +
                                    (dailySales.categoryBreakdown?.length ? 
                                        dailySales.categoryBreakdown.map(cat => 
                                            `- ${cat.categoryName}: ${cat.totalQuantity} unidades (R$ ${formatCurrency(cat.totalValue)})`
                                        ).join('\n') : 
                                        'Nenhuma venda por categoria registrada\n') +
                                    `\n🏆 Performance dos Vendedores:\n` +
                                    (dailySales.sellerPerformance?.length ? 
                                        dailySales.sellerPerformance.map(seller => 
                                            `- ${seller.sellerName}: ${seller.totalSales} vendas (R$ ${formatCurrency(seller.totalValue)})`
                                        ).join('\n') : 
                                        'Nenhum dado de performance de vendedores disponível');
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
                            
                            let stockValueResponse = `💰 Valor Total em Estoque: R$ ${formatCurrency(stockValue.totalValue)}\n\n`;
                            
                            if (stockValue.byCategory?.length) {
                                stockValueResponse += `📊 Valor por Categoria:\n` +
                                    stockValue.byCategory.map(cat => 
                                        `• ${cat.categoryName}: R$ ${formatCurrency(cat.value)}`
                                    ).join('\n') + '\n\n';
                            }
                            
                            if (stockValue.byWarehouse?.length) {
                                stockValueResponse += `🏭 Valor por Armazém:\n` +
                                    stockValue.byWarehouse.map(wh => 
                                        `• ${wh.warehouseName}: R$ ${formatCurrency(wh.value)}`
                                    ).join('\n');
                            }
                            
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Calculando valor total em estoque',
                                    response: stockValueResponse
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
                            
                            // Validar e corrigir datas
                            const startDateForStockOut = validateAndFixDate(toolArgs.startDate, -30);
                            const endDateForStockOut = validateAndFixDate(toolArgs.endDate);
                            
                            console.log(`[getStockOutCount] Buscando faltas ${productIdForStockOut ? `do produto #${productIdForStockOut}` : 'gerais'} de ${startDateForStockOut.toISOString()} até ${endDateForStockOut.toISOString()}`);
                            
                            const stockOuts = await getStockOutCount(
                                productIdForStockOut,
                                startDateForStockOut,
                                endDateForStockOut
                            );
                            
                            let stockOutResponse;
                            if (typeof stockOuts === 'number') {
                                stockOutResponse = `Houve ${stockOuts} ocorrência(s) de falta no estoque no período analisado`;
                            } else {
                                stockOutResponse = `Total de produtos sem estoque: ${stockOuts.totalStockOuts}. ` +
                                    `${stockOuts.categoriesWithStockOut.length} categorias possuem produtos sem estoque.`;
                            }
                            
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Verificando faltas no estoque',
                                    response: stockOutResponse
                                }
                            };
                            break;
                        case 'getPurchaseExpenses':
                            // Validar e corrigir datas
                            const startDateForExpenses = validateAndFixDate(toolArgs.startDate, -30);
                            const endDateForExpenses = validateAndFixDate(toolArgs.endDate);
                            
                            console.log(`[getPurchaseExpenses] Buscando gastos de ${startDateForExpenses.toISOString()} até ${endDateForExpenses.toISOString()}`);
                            
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
                            
                            let expensesResponse = `💰 Gastos com Compras (${startDateStr} a ${endDateStr})\n` +
                                `Total: R$ ${formatCurrency(expenses.totalExpenses)}\n\n`;
                            
                            if (expenses.bySupplier?.length) {
                                expensesResponse += `👥 Por Fornecedor:\n` +
                                    expenses.bySupplier.map(sup => 
                                        `• ${sup.supplierName}:\n` +
                                        `  - Valor: R$ ${formatCurrency(sup.totalValue)}\n` +
                                        `  - Compras: ${sup.purchaseCount}`
                                    ).join('\n\n') + '\n\n';
                            }
                            
                            if (expenses.byCategory?.length) {
                                expensesResponse += `📦 Por Categoria:\n` +
                                    expenses.byCategory.map(cat => 
                                        `• ${cat.categoryName}:\n` +
                                        `  - Valor: R$ ${formatCurrency(cat.totalValue)}\n` +
                                        `  - Itens: ${cat.itemCount}`
                                    ).join('\n\n');
                            }
                            
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Calculando gastos com compras',
                                    response: expensesResponse
                                }
                            };
                            break;
                        case 'getProductRevenue':
                            const productIdForRevenue = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                            
                            // Validar e corrigir datas
                            const startDateForRevenue = validateAndFixDate(toolArgs.startDate, -30);
                            const endDateForRevenue = validateAndFixDate(toolArgs.endDate);
                            
                            console.log(`[getProductRevenue] Buscando receita ${productIdForRevenue ? `do produto #${productIdForRevenue}` : 'geral'} de ${startDateForRevenue.toISOString()} até ${endDateForRevenue.toISOString()}`);
                            
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
                                revenueResponse = `Receita no período de ${revStartDateStr} a ${revEndDateStr}: R$ ${formatCurrency(revenue)}`;
                            } else if ('totalRevenue' in revenue) {
                                // Caso de produto específico (nova estrutura)
                                revenueResponse = `Receita para produto #${revenue.productId} no período de ${revStartDateStr} a ${revEndDateStr}: R$ ${formatCurrency(revenue.totalRevenue)}. Quantidade vendida: ${revenue.totalQuantity}`;
                            } else if (Array.isArray(revenue)) {
                                if (revenue.length === 0) {
                                    revenueResponse = 'Não há dados de receita disponíveis para o período.';
                                } else {
                                    revenueResponse = `Receita por produto entre ${revStartDateStr} e ${revEndDateStr}:\n${JSON.stringify(
                                        revenue.map(r => ({
                                            ...r,
                                            totalValue: `R$ ${formatCurrency(r.totalValue)}`
                                        })), null, 2
                                    )}`;
                                }
                            } else if ('byProduct' in revenue) {
                                // Nova estrutura com informações por categoria
                                revenueResponse = `Relatório de receitas (${revStartDateStr} a ${revEndDateStr}):\n\n` +
                                    `Total de produtos vendidos: ${revenue.byProduct.length}\n` +
                                    `Total por categoria: ${revenue.byCategory.length} categorias`;
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
                                    responseText = `Margem de lucro: R$ ${formatCurrency(margin[0].margin)} por unidade do produto ${margin[0].name}`;
                                } else {
                                    responseText = JSON.stringify(margin.map(m => ({
                                        ...m,
                                        margin: `R$ ${formatCurrency(m.margin)}`
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
                        case 'getTopProducts':
                            // Validar e corrigir datas de entrada
                            const startDateForTopProducts = validateAndFixDate(toolArgs.startDate, -30);
                            const endDateForTopProducts = validateAndFixDate(toolArgs.endDate);
                            
                            // Garantir que a data inicial é anterior à final
                            if (startDateForTopProducts > endDateForTopProducts) {
                                console.warn("[getTopProducts] Data inicial posterior à final, trocando datas");
                                const temp = startDateForTopProducts.getTime();
                                startDateForTopProducts.setTime(endDateForTopProducts.getTime());
                                endDateForTopProducts.setTime(temp);
                            }
                            
                            const limitForTopProducts = toolArgs.limit && toolArgs.limit > 0 ? toolArgs.limit : 10;
                            
                            console.log(`[getTopProducts] Buscando produtos de ${startDateForTopProducts.toISOString()} até ${endDateForTopProducts.toISOString()}`);
                            
                            const topProducts = await getTopProducts(startDateForTopProducts, endDateForTopProducts, limitForTopProducts);
                            
                            let topProductsResponse = `🏆 Rankings dos Melhores Produtos (${startDateForTopProducts.toLocaleDateString('pt-BR')} a ${endDateForTopProducts.toLocaleDateString('pt-BR')})\n\n`;
                            
                            // 1. Top por quantidade
                            topProductsResponse += `📈 Top ${limitForTopProducts} Produtos por Quantidade Vendida:\n`;
                            if (topProducts.byQuantity.length > 0) {
                                topProducts.byQuantity.forEach((product, index) => {
                                    topProductsResponse += `${index + 1}. ${product.productName}: ${product.totalQuantity} unidades (R$ ${formatCurrency(product.totalRevenue)})\n`;
                                });
                            } else {
                                topProductsResponse += `Nenhum produto vendido no período.\n`;
                            }
                            
                            // 2. Top por valor
                            topProductsResponse += `\n💰 Top ${limitForTopProducts} Produtos por Valor de Vendas:\n`;
                            if (topProducts.byRevenue.length > 0) {
                                topProducts.byRevenue.forEach((product, index) => {
                                    topProductsResponse += `${index + 1}. ${product.productName}: R$ ${formatCurrency(product.totalRevenue)} (${product.totalQuantity} unidades)\n`;
                                });
                            } else {
                                topProductsResponse += `Nenhum produto vendido no período.\n`;
                            }
                            
                            // 3. Top por lucro
                            topProductsResponse += `\n💸 Top ${limitForTopProducts} Produtos por Lucro:\n`;
                            if (topProducts.byProfit.length > 0) {
                                topProducts.byProfit.forEach((product, index) => {
                                    topProductsResponse += `${index + 1}. ${product.productName}: R$ ${formatCurrency(product.profit)} (${product.totalQuantity} unidades)\n`;
                                });
                            } else {
                                topProductsResponse += `Não há dados de lucro disponíveis para o período.\n`;
                            }
                            
                            toolCallResponse = {
                                final: false,
                                response: {
                                    reasoning: 'Calculando rankings dos produtos',
                                    response: topProductsResponse
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
            name: 'createChart',
            description: 'Cria e envia um gráfico baseado nos dados fornecidos e retorna uma descrição',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    xData: { 
                        type: 'array', 
                        description: 'Dados para o eixo X (podem ser datas, nomes de produtos, categorias, etc. - strings ou números)',
                        items: {
                            type: 'string'
                        }
                    },
                    yData: { 
                        type: 'array', 
                        description: 'Dados para o eixo Y (valores numéricos como quantidades, valores monetários, etc.)',
                        items: { type: 'number' }
                    },
                    title: { type: 'string', description: 'Título do gráfico' },
                    xLabel: { type: 'string', description: 'Legenda para o eixo X' },
                    yLabel: { type: 'string', description: 'Legenda para o eixo Y' },
                },
                required: ['xData', 'yData', 'title', 'xLabel', 'yLabel'],
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
    {
        type: 'function' as const,
        function: {
            name: 'getTopProducts',
            description: 'Retorna rankings dos 10 melhores produtos por quantidade, valor e lucro',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    startDate: { type: 'string', description: 'Data inicial no formato YYYY-MM-DD (opcional)' },
                    endDate: { type: 'string', description: 'Data final no formato YYYY-MM-DD (opcional)' },
                    limit: { type: 'number', description: 'Quantidade de produtos para retornar (padrão: 10)' }
                },
                required: ['startDate', 'endDate', 'limit'],
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
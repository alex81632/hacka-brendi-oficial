/**
 * Concrete ForecastAgent implementation.
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
import { Context } from 'telegraf';

// Função auxiliar para gerar previsão mock
function mockForecast(seriesTemporal: number[], horizonte: number): number[] {
    // Gera valores aleatórios baseados na média e variância da série temporal
    const media = seriesTemporal.reduce((a, b) => a + b, 0) / seriesTemporal.length;
    const variancia = seriesTemporal.reduce((a, b) => a + Math.pow(b - media, 2), 0) / seriesTemporal.length;
    const desvio = Math.sqrt(variancia);
    
    // Tendência - usamos os últimos valores para determinar se está crescendo ou diminuindo
    let tendencia = 0;
    if (seriesTemporal.length >= 2) {
        const ultimos = seriesTemporal.slice(-5);
        const mediaUltimos = ultimos.reduce((a, b) => a + b, 0) / ultimos.length;
        tendencia = (mediaUltimos - media) / 5; // Ajuste da tendência
    }
    
    // Gera previsão para os próximos dias
    return Array.from({ length: horizonte }, (_, i) => {
        // Valor base + tendência + ruído aleatório
        const previsao = media + tendencia * (i + 1) + (Math.random() - 0.5) * desvio;
        return Math.max(0, Math.round(previsao * 10) / 10); // Arredonda para 1 casa decimal e evita negativos
    });
}

// Função para obter projeção de ruptura de estoque
async function getStockOutProjection(productId?: number) {
    // Período padrão para análise é de 7 dias
    const diasPrevisao = 7;
    
    if (productId) {
        // Obter estoque atual do produto
        const inventoryItems = await inventoryRepository.findByProduct(productId);
        if (!inventoryItems || inventoryItems.length === 0) {
            return {
                produtoNaoEncontrado: true,
                message: 'Produto não encontrado no estoque'
            };
        }
        
        // Calcular estoque total atual
        const estoqueAtual = inventoryItems.reduce((total, item) => total + item.quantity, 0);
        
        // Obter histórico de vendas deste produto nos últimos 30 dias
        const hoje = new Date();
        const inicioHistorico = new Date(hoje);
        inicioHistorico.setDate(hoje.getDate() - 30);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(productId, inicioHistorico, hoje);
        
        // Criar uma série temporal simples para o mockup (valores diários nos últimos 30 dias)
        // Na implementação real, seria baseado nas vendas diárias reais
        const mediaVendaDiaria = historicoVendas.totalQuantity / 30;
        const serieVendas = Array.from({ length: 30 }, () => 
            Math.max(0, mediaVendaDiaria + (Math.random() - 0.5) * mediaVendaDiaria / 2)
        );
        
        // Gerar previsão para os próximos 7 dias
        const previsaoVendas = mockForecast(serieVendas, diasPrevisao);
        
        // Calcular estoque projetado para cada dia
        let estoqueRestante = estoqueAtual;
        const projecaoEstoque = previsaoVendas.map((vendaPrevista, index) => {
            estoqueRestante -= vendaPrevista;
            return {
                dia: index + 1,
                data: new Date(hoje.getTime() + (index + 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                vendaPrevista,
                estoqueProjetado: Math.max(0, estoqueRestante)
            };
        });
        
        // Verificar se haverá ruptura no período analisado
        const diaRuptura = projecaoEstoque.findIndex(dia => dia.estoqueProjetado <= 0);
        const riscoDeFalta = diaRuptura !== -1 ? diaRuptura + 1 : -1;
        
        // Calcula porcentagem de risco com base na previsão
        let porcentagemRisco = 0;
        if (riscoDeFalta !== -1) {
            porcentagemRisco = 100; // Certeza de ruptura
        } else {
            const consumoTotal = previsaoVendas.reduce((a, b) => a + b, 0);
            porcentagemRisco = Math.min(100, Math.round((consumoTotal / estoqueAtual) * 100));
        }
        
        return {
            produtoId: productId,
            produtoNome: inventoryItems[0].product.name,
            estoqueAtual,
            mediaVendaDiaria: mediaVendaDiaria,
            previsaoRuptura: {
                riscoDeFalta: riscoDeFalta !== -1,
                diasAteRuptura: riscoDeFalta !== -1 ? riscoDeFalta : null,
                dataEstimadaRuptura: riscoDeFalta !== -1 ? projecaoEstoque[diaRuptura].data : null,
                porcentagemRisco
            },
            projecaoDiaria: projecaoEstoque
        };
    }
    
    // Caso não seja especificado um produto, analisa todos os produtos em estoque
    const inventarioCompleto = await inventoryRepository.findAll();
    
    // Agrupar por produto
    const produtosAgrupados = inventarioCompleto.reduce((grupos, item) => {
        if (!grupos[item.productId]) {
            grupos[item.productId] = {
                produtoId: item.productId,
                produtoNome: item.product.name,
                estoqueTotal: 0,
                itens: []
            };
        }
        grupos[item.productId].estoqueTotal += item.quantity;
        grupos[item.productId].itens.push(item);
        return grupos;
    }, {} as Record<number, any>);
    
    // Análise de cada produto
    const resultados = [];
    for (const produtoId in produtosAgrupados) {
        // Obter histórico de vendas deste produto
        const hoje = new Date();
        const inicioHistorico = new Date(hoje);
        inicioHistorico.setDate(hoje.getDate() - 30);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(
            parseInt(produtoId), 
            inicioHistorico, 
            hoje
        );
        
        // Calcular média diária de vendas
        const mediaVendaDiaria = historicoVendas.totalQuantity / 30;
        
        // Criar série temporal simples para mockup
        const serieVendas = Array.from({ length: 30 }, () => 
            Math.max(0, mediaVendaDiaria + (Math.random() - 0.5) * mediaVendaDiaria / 2)
        );
        
        // Gerar previsão
        const previsaoVendas = mockForecast(serieVendas, diasPrevisao);
        
        // Estoque atual
        const estoqueAtual = produtosAgrupados[produtoId].estoqueTotal;
        
        // Calcular projeção diária
        let estoqueRestante = estoqueAtual;
        const projecaoEstoque = previsaoVendas.map((vendaPrevista, index) => {
            estoqueRestante -= vendaPrevista;
            return {
                dia: index + 1,
                data: new Date(hoje.getTime() + (index + 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
                vendaPrevista,
                estoqueProjetado: Math.max(0, estoqueRestante)
            };
        });
        
        // Verificar se haverá ruptura
        const diaRuptura = projecaoEstoque.findIndex(dia => dia.estoqueProjetado <= 0);
        const riscoDeFalta = diaRuptura !== -1 ? diaRuptura + 1 : -1;
        
        // Calcular porcentagem de risco
        let porcentagemRisco = 0;
        if (riscoDeFalta !== -1) {
            porcentagemRisco = 100; // Certeza de ruptura
        } else {
            const consumoTotal = previsaoVendas.reduce((a, b) => a + b, 0);
            porcentagemRisco = Math.min(100, Math.round((consumoTotal / estoqueAtual) * 100));
        }
        
        // Adicionar ao resultado apenas se tiver risco significativo (>30%)
        if (porcentagemRisco > 30) {
            resultados.push({
                produtoId: parseInt(produtoId),
                produtoNome: produtosAgrupados[produtoId].produtoNome,
                estoqueAtual,
                mediaVendaDiaria,
                previsaoRuptura: {
                    riscoDeFalta: riscoDeFalta !== -1,
                    diasAteRuptura: riscoDeFalta !== -1 ? riscoDeFalta : null,
                    dataEstimadaRuptura: riscoDeFalta !== -1 ? projecaoEstoque[diaRuptura].data : null,
                    porcentagemRisco
                }
            });
        }
    }
    
    // Ordenar por maior risco (produtos que vão faltar primeiro)
    return resultados.sort((a, b) => {
        // Primeiro os que têm risco de falta
        if (a.previsaoRuptura.riscoDeFalta && !b.previsaoRuptura.riscoDeFalta) return -1;
        if (!a.previsaoRuptura.riscoDeFalta && b.previsaoRuptura.riscoDeFalta) return 1;
        
        // Se ambos têm risco, ordenar por dias até ruptura
        if (a.previsaoRuptura.riscoDeFalta && b.previsaoRuptura.riscoDeFalta) {
            return (a.previsaoRuptura.diasAteRuptura || 0) - (b.previsaoRuptura.diasAteRuptura || 0);
        }
        
        // Se nenhum tem risco, ordenar por porcentagem de risco
        return b.previsaoRuptura.porcentagemRisco - a.previsaoRuptura.porcentagemRisco;
    });
}

// Função para calcular alertas de reposição de estoque
async function getRestockAlert(productId?: number) {
    // Dias para análise de consumo
    const diasAnalise = 30; // Analisa os últimos 30 dias para calcular média
    const diasProjecao = 14; // Projeta consumo para os próximos 14 dias
    
    // Dias de segurança para determinar quando um produto deve ser reposto
    // (tempo médio entre pedido e entrega + margem de segurança)
    const leadTimeMedio = 5; // dias entre pedido e entrega
    const margemSeguranca = 2; // dias adicionais de segurança
    const diasSeguranca = leadTimeMedio + margemSeguranca;
    
    if (productId) {
        // Obter estoque atual do produto
        const inventoryItems = await inventoryRepository.findByProduct(productId);
        if (!inventoryItems || inventoryItems.length === 0) {
            return {
                produtoNaoEncontrado: true,
                message: 'Produto não encontrado no estoque'
            };
        }
        
        // Calcular estoque total atual
        const estoqueAtual = inventoryItems.reduce((total, item) => total + item.quantity, 0);
        
        // Obter histórico de vendas deste produto nos últimos dias de análise
        const hoje = new Date();
        const inicioHistorico = new Date(hoje);
        inicioHistorico.setDate(hoje.getDate() - diasAnalise);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(productId, inicioHistorico, hoje);
        
        // Calcular média diária de consumo
        const mediaConsumoDiario = historicoVendas.totalQuantity / diasAnalise;
        
        // Calcular estoque de segurança
        const estoqueSeguranca = Math.ceil(mediaConsumoDiario * diasSeguranca);
        
        // Estimar quando o estoque chegará ao nível mínimo
        const diasAteMinimo = estoqueAtual > estoqueSeguranca 
            ? Math.floor((estoqueAtual - estoqueSeguranca) / mediaConsumoDiario)
            : 0;
        
        // Calcular quantidade ideal para reposição
        // Considera o consumo projetado durante o período de lead time + segurança
        const consumoProjetadoLeadTime = Math.ceil(mediaConsumoDiario * diasProjecao);
        const quantidadeIdealReposicao = Math.max(0, consumoProjetadoLeadTime - estoqueAtual + estoqueSeguranca);
        
        // Produto com dados completos para o supplier
        const produto = await productRepository.findById(productId);
        let fornecedor = null;
        
        if (produto && produto.supplierId) {
            fornecedor = await supplierRepository.findById(produto.supplierId);
        }
        
        // Calcular data estimada para reposição
        const dataReposicao = new Date(hoje);
        dataReposicao.setDate(hoje.getDate() + diasAteMinimo);
        
        // Determinar status de urgência
        let statusUrgencia = 'NORMAL';
        let corStatus = 'green';
        
        if (diasAteMinimo <= 0) {
            statusUrgencia = 'CRÍTICO';
            corStatus = 'red';
        } else if (diasAteMinimo <= 7) {
            statusUrgencia = 'URGENTE';
            corStatus = 'orange';
        } else if (diasAteMinimo <= 14) {
            statusUrgencia = 'ATENÇÃO';
            corStatus = 'yellow';
        }
        
        return {
            produtoId: productId,
            produtoNome: produto ? produto.name : inventoryItems[0].product.name,
            estoqueAtual,
            mediaConsumoDiario,
            estoqueSeguranca,
            diasAteMinimo,
            dataReposicao: dataReposicao.toISOString().split('T')[0],
            quantidadeReposicao: quantidadeIdealReposicao,
            statusUrgencia,
            corStatus,
            fornecedor: fornecedor ? {
                id: fornecedor.id,
                nome: fornecedor.name,
                contato: fornecedor.contact,
                email: fornecedor.email
            } : null
        };
    }
    
    // Caso não seja especificado um produto, analisa todos os produtos em estoque
    const inventarioCompleto = await inventoryRepository.findAll();
    
    // Agrupar por produto
    const produtosAgrupados = inventarioCompleto.reduce((grupos, item) => {
        if (!grupos[item.productId]) {
            grupos[item.productId] = {
                produtoId: item.productId,
                produtoNome: item.product.name,
                estoqueTotal: 0,
                itens: []
            };
        }
        grupos[item.productId].estoqueTotal += item.quantity;
        grupos[item.productId].itens.push(item);
        return grupos;
    }, {} as Record<number, any>);
    
    // Análise de cada produto
    const resultados = [];
    for (const produtoId in produtosAgrupados) {
        // Obter histórico de vendas deste produto
        const hoje = new Date();
        const inicioHistorico = new Date(hoje);
        inicioHistorico.setDate(hoje.getDate() - diasAnalise);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(
            parseInt(produtoId), 
            inicioHistorico, 
            hoje
        );
        
        // Calcular média diária de consumo
        const mediaConsumoDiario = historicoVendas.totalQuantity / diasAnalise;
        
        // Estoque atual
        const estoqueAtual = produtosAgrupados[produtoId].estoqueTotal;
        
        // Calcular estoque de segurança
        const estoqueSeguranca = Math.ceil(mediaConsumoDiario * diasSeguranca);
        
        // Calcular quando chegará ao nível mínimo
        const diasAteMinimo = estoqueAtual > estoqueSeguranca 
            ? Math.floor((estoqueAtual - estoqueSeguranca) / mediaConsumoDiario)
            : 0;
        
        // Calcular quantidade ideal para reposição
        const consumoProjetadoLeadTime = Math.ceil(mediaConsumoDiario * diasProjecao);
        const quantidadeIdealReposicao = Math.max(0, consumoProjetadoLeadTime - estoqueAtual + estoqueSeguranca);
        
        // Buscar fornecedor recomendado
        const produto = await productRepository.findById(parseInt(produtoId));
        let fornecedor = null;
        
        if (produto && produto.supplierId) {
            fornecedor = await supplierRepository.findById(produto.supplierId);
        }
        
        // Determinar status de urgência
        let statusUrgencia = 'NORMAL';
        let corStatus = 'green';
        
        if (diasAteMinimo <= 0) {
            statusUrgencia = 'CRÍTICO';
            corStatus = 'red';
        } else if (diasAteMinimo <= 7) {
            statusUrgencia = 'URGENTE';
            corStatus = 'orange';
        } else if (diasAteMinimo <= 14) {
            statusUrgencia = 'ATENÇÃO';
            corStatus = 'yellow';
        }
        
        // Calcular data estimada para reposição
        const dataReposicao = new Date(hoje);
        dataReposicao.setDate(hoje.getDate() + diasAteMinimo);
        
        // Adicionar ao resultado apenas produtos que precisam de reposição em até 30 dias
        // ou que já estão abaixo do estoque de segurança
        if (diasAteMinimo <= 30 || estoqueAtual < estoqueSeguranca) {
            resultados.push({
                produtoId: parseInt(produtoId),
                produtoNome: produtosAgrupados[produtoId].produtoNome,
                estoqueAtual,
                mediaConsumoDiario,
                estoqueSeguranca,
                diasAteMinimo,
                dataReposicao: dataReposicao.toISOString().split('T')[0],
                quantidadeReposicao: quantidadeIdealReposicao,
                statusUrgencia,
                corStatus,
                fornecedor: fornecedor ? {
                    id: fornecedor.id,
                    nome: fornecedor.name,
                    contato: fornecedor.contact,
                    email: fornecedor.email
                } : null
            });
        }
    }
    
    // Ordenar por urgência (do mais urgente para o menos urgente)
    return resultados.sort((a, b) => {
        // Primeiro ordenar por status de urgência
        if (a.diasAteMinimo !== b.diasAteMinimo) {
            return a.diasAteMinimo - b.diasAteMinimo;
        }
        
        // Em seguida, ordenar pela quantidade que precisa ser reposta
        return b.quantidadeReposicao - a.quantidadeReposicao;
    });
}

// Função para calcular a previsão de vendas
async function getSalesForecast(productId?: number) {
    // Parâmetros para análise
    const diasPrevisao = 7; // Prevê os próximos 7 dias
    const diasHistorico = 30; // Usa os últimos 30 dias como base
    const pesoMediaRecente = 0.7; // Peso para a média recente (70%)
    const pesoSemanaAnterior = 0.3; // Peso para a mesma semana anterior (30%)
    
    if (productId) {
        // Obter dados do produto
        const produto = await productRepository.findById(productId);
        if (!produto) {
            return {
                produtoNaoEncontrado: true,
                message: 'Produto não encontrado'
            };
        }
        
        // Obter histórico de vendas recente
        const hoje = new Date();
        const inicioHistorico = new Date(hoje);
        inicioHistorico.setDate(hoje.getDate() - diasHistorico);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(productId, inicioHistorico, hoje);
        
        // Obter vendas da mesma semana do mês anterior
        const inicioSemanaAnterior = new Date(hoje);
        inicioSemanaAnterior.setDate(hoje.getDate() - 30); // Um mês atrás
        const fimSemanaAnterior = new Date(inicioSemanaAnterior);
        fimSemanaAnterior.setDate(inicioSemanaAnterior.getDate() + 7);
        
        const vendasSemanaAnterior = await saleItemRepository.getProductSaleStats(
            productId,
            inicioSemanaAnterior,
            fimSemanaAnterior
        );
        
        // Calcular média diária recente
        const mediaRecente = historicoVendas.totalQuantity / diasHistorico;
        
        // Calcular média diária da semana anterior
        const mediaSemanaAnterior = vendasSemanaAnterior.totalQuantity / 7;
        
        // Criar série temporal para previsão
        const serieVendas = Array.from({ length: 30 }, () => 
            Math.max(0, mediaRecente + (Math.random() - 0.5) * mediaRecente / 2)
        );
        
        // Gerar previsão base usando o mockForecast
        const previsaoBase = mockForecast(serieVendas, diasPrevisao);
        
        // Ajustar previsão considerando a média ponderada
        const previsaoAjustada = previsaoBase.map(valor => {
            const previsaoPonderada = (valor * pesoMediaRecente) + (mediaSemanaAnterior * pesoSemanaAnterior);
            return Math.max(0, Math.round(previsaoPonderada * 10) / 10);
        });
        
        // Calcular métricas adicionais
        const totalPrevistoSemana = previsaoAjustada.reduce((a, b) => a + b, 0);
        const mediaPrevisaoSemanal = totalPrevistoSemana / diasPrevisao;
        const variacaoPercentual = ((mediaPrevisaoSemanal - mediaRecente) / mediaRecente) * 100;
        
        // Gerar datas para cada dia da previsão
        const previsaoDiaria = previsaoAjustada.map((quantidade, index) => {
            const data = new Date(hoje);
            data.setDate(data.getDate() + index + 1);
            return {
                dia: index + 1,
                data: data.toISOString().split('T')[0],
                quantidadePrevista: quantidade,
                valorPrevisto: quantidade * produto.price
            };
        });
        
        // Buscar categoria do produto
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        return {
            produtoId: productId,
            produtoNome: produto.name,
            categoria: categoria ? {
                id: categoria.id,
                nome: categoria.name
            } : null,
            previsaoVendas: {
                totalPrevistoSemana,
                mediaPrevisaoSemanal,
                variacaoPercentual,
                previsaoDiaria
            },
            metricas: {
                mediaVendasRecente: mediaRecente,
                mediaSemanaAnterior: mediaSemanaAnterior,
                precoUnitario: produto.price
            }
        };
    }
    
    // Caso não seja especificado um produto, analisa todos os produtos
    const produtos = await productRepository.findAll();
    const resultados = [];
    
    for (const produto of produtos) {
        // Obter histórico de vendas recente
        const hoje = new Date();
        const inicioHistorico = new Date(hoje);
        inicioHistorico.setDate(hoje.getDate() - diasHistorico);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(
            produto.id,
            inicioHistorico,
            hoje
        );
        
        // Obter vendas da mesma semana do mês anterior
        const inicioSemanaAnterior = new Date(hoje);
        inicioSemanaAnterior.setDate(hoje.getDate() - 30);
        const fimSemanaAnterior = new Date(inicioSemanaAnterior);
        fimSemanaAnterior.setDate(inicioSemanaAnterior.getDate() + 7);
        
        const vendasSemanaAnterior = await saleItemRepository.getProductSaleStats(
            produto.id,
            inicioSemanaAnterior,
            fimSemanaAnterior
        );
        
        // Calcular médias
        const mediaRecente = historicoVendas.totalQuantity / diasHistorico;
        const mediaSemanaAnterior = vendasSemanaAnterior.totalQuantity / 7;
        
        // Criar série temporal e gerar previsão
        const serieVendas = Array.from({ length: 30 }, () => 
            Math.max(0, mediaRecente + (Math.random() - 0.5) * mediaRecente / 2)
        );
        
        const previsaoBase = mockForecast(serieVendas, diasPrevisao);
        
        // Ajustar previsão
        const previsaoAjustada = previsaoBase.map(valor => {
            const previsaoPonderada = (valor * pesoMediaRecente) + (mediaSemanaAnterior * pesoSemanaAnterior);
            return Math.max(0, Math.round(previsaoPonderada * 10) / 10);
        });
        
        // Calcular métricas
        const totalPrevistoSemana = previsaoAjustada.reduce((a, b) => a + b, 0);
        const mediaPrevisaoSemanal = totalPrevistoSemana / diasPrevisao;
        const variacaoPercentual = ((mediaPrevisaoSemanal - mediaRecente) / mediaRecente) * 100;
        
        // Buscar categoria
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        // Adicionar ao resultado apenas se houver previsão de vendas significativa
        if (totalPrevistoSemana > 0) {
            resultados.push({
                produtoId: produto.id,
                produtoNome: produto.name,
                categoria: categoria ? {
                    id: categoria.id,
                    nome: categoria.name
                } : null,
                previsaoVendas: {
                    totalPrevistoSemana,
                    mediaPrevisaoSemanal,
                    variacaoPercentual
                },
                metricas: {
                    mediaVendasRecente: mediaRecente,
                    mediaSemanaAnterior: mediaSemanaAnterior,
                    precoUnitario: produto.price
                }
            });
        }
    }
    
    // Ordenar por volume previsto de vendas (do maior para o menor)
    return resultados.sort((a, b) => 
        b.previsaoVendas.totalPrevistoSemana - a.previsaoVendas.totalPrevistoSemana
    );
}

// Função para identificar produtos com baixo giro ou parados
async function getIdleStockPrediction(productId?: number, diasAnalise: number = 30) {
    // Parâmetros para análise
    const limiteGiroBaixo = 0.1; // 10% do estoque médio por mês
    const diasSemVenda = 15; // Considera crítico se não houver vendas em 15 dias
    
    if (productId) {
        // Obter dados do produto
        const produto = await productRepository.findById(productId);
        if (!produto) {
            return {
                produtoNaoEncontrado: true,
                message: 'Produto não encontrado'
            };
        }
        
        // Obter estoque atual
        const inventoryItems = await inventoryRepository.findByProduct(productId);
        if (!inventoryItems || inventoryItems.length === 0) {
            return {
                semEstoque: true,
                message: 'Produto sem estoque cadastrado'
            };
        }
        
        const estoqueAtual = inventoryItems.reduce((total, item) => total + item.quantity, 0);
        
        // Obter histórico de vendas
        const hoje = new Date();
        const inicioAnalise = new Date(hoje);
        inicioAnalise.setDate(hoje.getDate() - diasAnalise);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(productId, inicioAnalise, hoje);
        
        // Calcular métricas
        const mediaVendasDiaria = historicoVendas.totalQuantity / diasAnalise;
        const giroMensal = (mediaVendasDiaria * 30) / estoqueAtual; // Giro mensal em relação ao estoque
        
        // Calcular dias desde a última venda
        const ultimasVendas = await saleItemRepository.findByProductId(productId);
        const ultimaVenda = ultimasVendas
            .sort((a, b) => new Date(b.sale.createdAt).getTime() - new Date(a.sale.createdAt).getTime())
            .find(venda => venda.quantity > 0);
            
        const diasDesdeUltimaVenda = ultimaVenda ? 
            Math.floor((hoje.getTime() - new Date(ultimaVenda.sale.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 
            diasAnalise;
        
        // Calcular valor do estoque parado
        const valorEstoquePrado = estoqueAtual * produto.price;
        
        // Buscar categoria do produto
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        // Determinar status do produto
        let status = 'NORMAL';
        let corStatus = 'green';
        
        if (diasDesdeUltimaVenda >= diasSemVenda) {
            status = 'CRÍTICO';
            corStatus = 'red';
        } else if (giroMensal <= limiteGiroBaixo) {
            status = 'ATENÇÃO';
            corStatus = 'yellow';
        }
        
        return {
            produtoId: productId,
            produtoNome: produto.name,
            categoria: categoria ? {
                id: categoria.id,
                nome: categoria.name
            } : null,
            metricas: {
                estoqueAtual,
                valorEstoquePrado,
                mediaVendasDiaria,
                giroMensal,
                diasDesdeUltimaVenda
            },
            status,
            corStatus,
            recomendacoes: [
                diasDesdeUltimaVenda >= diasSemVenda ? 'Considerar promoção para liquidação' : null,
                giroMensal <= limiteGiroBaixo ? 'Avaliar redução do estoque mínimo' : null,
                'Analisar sazonalidade do produto',
                'Verificar posicionamento no PDV'
            ].filter(Boolean)
        };
    }
    
    // Caso não seja especificado um produto, analisa todos os produtos
    const produtos = await productRepository.findAll();
    const resultados = [];
    
    for (const produto of produtos) {
        // Obter estoque atual
        const inventoryItems = await inventoryRepository.findByProduct(produto.id);
        if (!inventoryItems || inventoryItems.length === 0) continue;
        
        const estoqueAtual = inventoryItems.reduce((total, item) => total + item.quantity, 0);
        
        // Obter histórico de vendas
        const hoje = new Date();
        const inicioAnalise = new Date(hoje);
        inicioAnalise.setDate(hoje.getDate() - diasAnalise);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(
            produto.id,
            inicioAnalise,
            hoje
        );
        
        // Calcular métricas
        const mediaVendasDiaria = historicoVendas.totalQuantity / diasAnalise;
        const giroMensal = (mediaVendasDiaria * 30) / estoqueAtual;
        
        // Calcular dias desde a última venda
        const ultimasVendas = await saleItemRepository.findByProductId(produto.id);
        const ultimaVenda = ultimasVendas
            .sort((a, b) => new Date(b.sale.createdAt).getTime() - new Date(a.sale.createdAt).getTime())
            .find(venda => venda.quantity > 0);
            
        const diasDesdeUltimaVenda = ultimaVenda ? 
            Math.floor((hoje.getTime() - new Date(ultimaVenda.sale.createdAt).getTime()) / (1000 * 60 * 60 * 24)) : 
            diasAnalise;
        
        // Calcular valor do estoque parado
        const valorEstoquePrado = estoqueAtual * produto.price;
        
        // Buscar categoria
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        // Determinar status do produto
        let status = 'NORMAL';
        let corStatus = 'green';
        
        if (diasDesdeUltimaVenda >= diasSemVenda) {
            status = 'CRÍTICO';
            corStatus = 'red';
        } else if (giroMensal <= limiteGiroBaixo) {
            status = 'ATENÇÃO';
            corStatus = 'yellow';
        }
        
        // Adicionar ao resultado apenas produtos com problemas
        if (status !== 'NORMAL') {
            resultados.push({
                produtoId: produto.id,
                produtoNome: produto.name,
                categoria: categoria ? {
                    id: categoria.id,
                    nome: categoria.name
                } : null,
                metricas: {
                    estoqueAtual,
                    valorEstoquePrado,
                    mediaVendasDiaria,
                    giroMensal,
                    diasDesdeUltimaVenda
                },
                status,
                corStatus,
                recomendacoes: [
                    diasDesdeUltimaVenda >= diasSemVenda ? 'Considerar promoção para liquidação' : null,
                    giroMensal <= limiteGiroBaixo ? 'Avaliar redução do estoque mínimo' : null,
                    'Analisar sazonalidade do produto',
                    'Verificar posicionamento no PDV'
                ].filter(Boolean)
            });
        }
    }
    
    // Ordenar por dias sem venda (mais críticos primeiro)
    return resultados.sort((a, b) => 
        b.metricas.diasDesdeUltimaVenda - a.metricas.diasDesdeUltimaVenda
    );
}

// Função para calcular receita projetada
async function getProjectedRevenue(productId?: number) {
    // Parâmetros para análise
    const diasPrevisao = 7; // Próximos 7 dias
    const diasHistorico = 30; // Últimos 30 dias para base
    
    if (productId) {
        // Obter dados do produto
        const produto = await productRepository.findById(productId);
        if (!produto) {
            return {
                produtoNaoEncontrado: true,
                message: 'Produto não encontrado'
            };
        }
        
        // Obter histórico de vendas recente
        const hoje = new Date();
        const inicioHistorico = new Date(hoje);
        inicioHistorico.setDate(hoje.getDate() - diasHistorico);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(productId, inicioHistorico, hoje);
        
        // Calcular média diária e tendência
        const mediaVendasDiaria = historicoVendas.totalQuantity / diasHistorico;
        const receitaMediaDiaria = historicoVendas.totalRevenue / diasHistorico;
        const precoMedio = historicoVendas.totalRevenue / historicoVendas.totalQuantity;
        
        // Criar série temporal para previsão
        const serieVendas = Array.from({ length: 30 }, () => 
            Math.max(0, mediaVendasDiaria + (Math.random() - 0.5) * mediaVendasDiaria / 2)
        );
        
        // Gerar previsão de quantidade
        const previsaoQuantidade = mockForecast(serieVendas, diasPrevisao);
        
        // Calcular previsão de receita diária
        const previsaoDiaria = previsaoQuantidade.map((quantidade, index) => {
            const data = new Date(hoje);
            data.setDate(data.getDate() + index + 1);
            const receita = quantidade * produto.price;
            return {
                dia: index + 1,
                data: data.toISOString().split('T')[0],
                quantidadePrevista: quantidade,
                receitaPrevista: receita
            };
        });
        
        // Calcular totais e médias
        const totalQuantidade = previsaoQuantidade.reduce((a, b) => a + b, 0);
        const totalReceita = previsaoDiaria.reduce((a, b) => a + b.receitaPrevista, 0);
        const mediaQuantidadeDiaria = totalQuantidade / diasPrevisao;
        const mediaReceitaDiaria = totalReceita / diasPrevisao;
        
        // Calcular variações percentuais
        const variacaoQuantidade = ((mediaQuantidadeDiaria - mediaVendasDiaria) / mediaVendasDiaria) * 100;
        const variacaoReceita = ((mediaReceitaDiaria - receitaMediaDiaria) / receitaMediaDiaria) * 100;
        
        // Buscar categoria do produto
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        return {
            produtoId: productId,
            produtoNome: produto.name,
            categoria: categoria ? {
                id: categoria.id,
                nome: categoria.name
            } : null,
            previsao: {
                totalQuantidade,
                totalReceita,
                mediaQuantidadeDiaria,
                mediaReceitaDiaria,
                variacaoQuantidade,
                variacaoReceita,
                previsaoDiaria
            },
            metricas: {
                precoAtual: produto.price,
                precoMedio,
                mediaVendasDiaria,
                receitaMediaDiaria
            }
        };
    }
    
    // Caso não seja especificado um produto, analisa todos os produtos
    const produtos = await productRepository.findAll();
    const resultados = [];
    
    for (const produto of produtos) {
        // Obter histórico de vendas
        const hoje = new Date();
        const inicioHistorico = new Date(hoje);
        inicioHistorico.setDate(hoje.getDate() - diasHistorico);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(
            produto.id,
            inicioHistorico,
            hoje
        );
        
        // Pular produtos sem histórico de vendas
        if (historicoVendas.totalQuantity === 0) continue;
        
        // Calcular médias e tendências
        const mediaVendasDiaria = historicoVendas.totalQuantity / diasHistorico;
        const receitaMediaDiaria = historicoVendas.totalRevenue / diasHistorico;
        const precoMedio = historicoVendas.totalRevenue / historicoVendas.totalQuantity;
        
        // Criar série temporal e gerar previsão
        const serieVendas = Array.from({ length: 30 }, () => 
            Math.max(0, mediaVendasDiaria + (Math.random() - 0.5) * mediaVendasDiaria / 2)
        );
        
        const previsaoQuantidade = mockForecast(serieVendas, diasPrevisao);
        
        // Calcular totais previstos
        const totalQuantidade = previsaoQuantidade.reduce((a, b) => a + b, 0);
        const totalReceita = totalQuantidade * produto.price;
        const mediaQuantidadeDiaria = totalQuantidade / diasPrevisao;
        const mediaReceitaDiaria = totalReceita / diasPrevisao;
        
        // Calcular variações
        const variacaoQuantidade = ((mediaQuantidadeDiaria - mediaVendasDiaria) / mediaVendasDiaria) * 100;
        const variacaoReceita = ((mediaReceitaDiaria - receitaMediaDiaria) / receitaMediaDiaria) * 100;
        
        // Buscar categoria
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        resultados.push({
            produtoId: produto.id,
            produtoNome: produto.name,
            categoria: categoria ? {
                id: categoria.id,
                nome: categoria.name
            } : null,
            previsao: {
                totalQuantidade,
                totalReceita,
                mediaQuantidadeDiaria,
                mediaReceitaDiaria,
                variacaoQuantidade,
                variacaoReceita
            },
            metricas: {
                precoAtual: produto.price,
                precoMedio,
                mediaVendasDiaria,
                receitaMediaDiaria
            }
        });
    }
    
    // Ordenar por receita total prevista (do maior para o menor)
    return resultados.sort((a, b) => 
        b.previsao.totalReceita - a.previsao.totalReceita
    );
}

// Função para calcular lucro projetado
async function getProjectedProfit(productId?: number) {
    // Parâmetros para análise
    const diasPrevisao = 7; // Próximos 7 dias
    const diasHistorico = 30; // Últimos 30 dias para base
    
    if (productId) {
        // Obter dados do produto
        const produto = await productRepository.findById(productId);
        if (!produto) {
            return {
                produtoNaoEncontrado: true,
                message: 'Produto não encontrado'
            };
        }
        
        // Obter histórico de vendas recente
        const hoje = new Date();
        const inicioHistorico = new Date(hoje);
        inicioHistorico.setDate(hoje.getDate() - diasHistorico);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(productId, inicioHistorico, hoje);
        
        // Calcular média diária e tendência
        const mediaVendasDiaria = historicoVendas.totalQuantity / diasHistorico;
        const receitaMediaDiaria = historicoVendas.totalRevenue / diasHistorico;
        const custoMedio = produto.cost || 0; // Custo do produto
        const margemBruta = produto.price - custoMedio;
        const margemPercentual = (margemBruta / produto.price) * 100;
        
        // Criar série temporal para previsão
        const serieVendas = Array.from({ length: 30 }, () => 
            Math.max(0, mediaVendasDiaria + (Math.random() - 0.5) * mediaVendasDiaria / 2)
        );
        
        // Gerar previsão de quantidade
        const previsaoQuantidade = mockForecast(serieVendas, diasPrevisao);
        
        // Calcular previsão de lucro diária
        const previsaoDiaria = previsaoQuantidade.map((quantidade, index) => {
            const data = new Date(hoje);
            data.setDate(data.getDate() + index + 1);
            const receita = quantidade * produto.price;
            const custo = quantidade * custoMedio;
            const lucro = receita - custo;
            return {
                dia: index + 1,
                data: data.toISOString().split('T')[0],
                quantidadePrevista: quantidade,
                receitaPrevista: receita,
                custoPrevisto: custo,
                lucroPrevisto: lucro
            };
        });
        
        // Calcular totais e médias
        const totalQuantidade = previsaoQuantidade.reduce((a, b) => a + b, 0);
        const totalReceita = previsaoDiaria.reduce((a, b) => a + b.receitaPrevista, 0);
        const totalCusto = previsaoDiaria.reduce((a, b) => a + b.custoPrevisto, 0);
        const totalLucro = previsaoDiaria.reduce((a, b) => a + b.lucroPrevisto, 0);
        
        const mediaQuantidadeDiaria = totalQuantidade / diasPrevisao;
        const mediaReceitaDiaria = totalReceita / diasPrevisao;
        const mediaCustoDiaria = totalCusto / diasPrevisao;
        const mediaLucroDiaria = totalLucro / diasPrevisao;
        
        // Calcular variações percentuais
        const variacaoQuantidade = ((mediaQuantidadeDiaria - mediaVendasDiaria) / mediaVendasDiaria) * 100;
        const variacaoReceita = ((mediaReceitaDiaria - receitaMediaDiaria) / receitaMediaDiaria) * 100;
        
        // Buscar categoria do produto
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        return {
            produtoId: productId,
            produtoNome: produto.name,
            categoria: categoria ? {
                id: categoria.id,
                nome: categoria.name
            } : null,
            previsao: {
                totalQuantidade,
                totalReceita,
                totalCusto,
                totalLucro,
                mediaQuantidadeDiaria,
                mediaReceitaDiaria,
                mediaCustoDiaria,
                mediaLucroDiaria,
                variacaoQuantidade,
                variacaoReceita,
                previsaoDiaria
            },
            metricas: {
                precoVenda: produto.price,
                custoUnitario: custoMedio,
                margemBruta,
                margemPercentual,
                mediaVendasDiaria,
                receitaMediaDiaria
            }
        };
    }
    
    // Caso não seja especificado um produto, analisa todos os produtos
    const produtos = await productRepository.findAll();
    const resultados = [];
    
    for (const produto of produtos) {
        // Obter histórico de vendas
        const hoje = new Date();
        const inicioHistorico = new Date(hoje);
        inicioHistorico.setDate(hoje.getDate() - diasHistorico);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(
            produto.id,
            inicioHistorico,
            hoje
        );
        
        // Pular produtos sem histórico de vendas
        if (historicoVendas.totalQuantity === 0) continue;
        
        // Calcular médias e tendências
        const mediaVendasDiaria = historicoVendas.totalQuantity / diasHistorico;
        const receitaMediaDiaria = historicoVendas.totalRevenue / diasHistorico;
        const custoMedio = produto.cost || 0;
        const margemBruta = produto.price - custoMedio;
        const margemPercentual = (margemBruta / produto.price) * 100;
        
        // Criar série temporal e gerar previsão
        const serieVendas = Array.from({ length: 30 }, () => 
            Math.max(0, mediaVendasDiaria + (Math.random() - 0.5) * mediaVendasDiaria / 2)
        );
        
        const previsaoQuantidade = mockForecast(serieVendas, diasPrevisao);
        
        // Calcular totais previstos
        const totalQuantidade = previsaoQuantidade.reduce((a, b) => a + b, 0);
        const totalReceita = totalQuantidade * produto.price;
        const totalCusto = totalQuantidade * custoMedio;
        const totalLucro = totalReceita - totalCusto;
        
        const mediaQuantidadeDiaria = totalQuantidade / diasPrevisao;
        const mediaReceitaDiaria = totalReceita / diasPrevisao;
        const mediaCustoDiaria = totalCusto / diasPrevisao;
        const mediaLucroDiaria = totalLucro / diasPrevisao;
        
        // Calcular variações
        const variacaoQuantidade = ((mediaQuantidadeDiaria - mediaVendasDiaria) / mediaVendasDiaria) * 100;
        const variacaoReceita = ((mediaReceitaDiaria - receitaMediaDiaria) / receitaMediaDiaria) * 100;
        
        // Buscar categoria
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        resultados.push({
            produtoId: produto.id,
            produtoNome: produto.name,
            categoria: categoria ? {
                id: categoria.id,
                nome: categoria.name
            } : null,
            previsao: {
                totalQuantidade,
                totalReceita,
                totalCusto,
                totalLucro,
                mediaQuantidadeDiaria,
                mediaReceitaDiaria,
                mediaCustoDiaria,
                mediaLucroDiaria,
                variacaoQuantidade,
                variacaoReceita
            },
            metricas: {
                precoVenda: produto.price,
                custoUnitario: custoMedio,
                margemBruta,
                margemPercentual,
                mediaVendasDiaria,
                receitaMediaDiaria
            }
        });
    }
    
    // Ordenar por lucro total previsto (do maior para o menor)
    return resultados.sort((a, b) => 
        b.previsao.totalLucro - a.previsao.totalLucro
    );
}

// Função para calcular aceleração nas vendas
async function getSalesAcceleration(productId?: number) {
    // Parâmetros para análise
    const diasAnaliseRecente = 7; // Últimos 7 dias
    const diasAnaliseAnterior = 14; // 7 dias anteriores para comparação
    const limiarAceleracao = 20; // % mínima de aumento para considerar aceleração significativa
    
    if (productId) {
        // Obter dados do produto
        const produto = await productRepository.findById(productId);
        if (!produto) {
            return {
                produtoNaoEncontrado: true,
                message: 'Produto não encontrado'
            };
        }
        
        // Obter vendas do período mais recente
        const hoje = new Date();
        const inicioRecente = new Date(hoje);
        inicioRecente.setDate(hoje.getDate() - diasAnaliseRecente);
        
        const vendasRecentes = await saleItemRepository.getProductSaleStats(
            productId,
            inicioRecente,
            hoje
        );
        
        // Obter vendas do período anterior para comparação
        const inicioAnterior = new Date(inicioRecente);
        const fimAnterior = new Date(inicioRecente);
        inicioAnterior.setDate(inicioAnterior.getDate() - diasAnaliseRecente);
        
        const vendasAnteriores = await saleItemRepository.getProductSaleStats(
            productId,
            inicioAnterior,
            fimAnterior
        );
        
        // Calcular médias diárias
        const mediaRecente = vendasRecentes.totalQuantity / diasAnaliseRecente;
        const mediaAnterior = vendasAnteriores.totalQuantity / diasAnaliseRecente;
        
        // Calcular variação percentual
        const variacaoPercentual = mediaAnterior > 0 ? 
            ((mediaRecente - mediaAnterior) / mediaAnterior) * 100 : 
            mediaRecente > 0 ? 100 : 0;
        
        // Calcular receita média diária
        const receitaMediaRecente = vendasRecentes.totalRevenue / diasAnaliseRecente;
        const receitaMediaAnterior = vendasAnteriores.totalRevenue / diasAnaliseRecente;
        
        // Calcular variação na receita
        const variacaoReceita = receitaMediaAnterior > 0 ?
            ((receitaMediaRecente - receitaMediaAnterior) / receitaMediaAnterior) * 100 :
            receitaMediaRecente > 0 ? 100 : 0;
        
        // Determinar status de aceleração
        let status = 'ESTÁVEL';
        let corStatus = 'blue';
        
        if (variacaoPercentual >= limiarAceleracao) {
            status = 'ACELERAÇÃO';
            corStatus = 'green';
        } else if (variacaoPercentual <= -limiarAceleracao) {
            status = 'DESACELERAÇÃO';
            corStatus = 'red';
        }
        
        // Buscar categoria do produto
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        return {
            produtoId: productId,
            produtoNome: produto.name,
            categoria: categoria ? {
                id: categoria.id,
                nome: categoria.name
            } : null,
            metricas: {
                mediaRecente,
                mediaAnterior,
                variacaoPercentual,
                receitaMediaRecente,
                receitaMediaAnterior,
                variacaoReceita
            },
            status,
            corStatus,
            recomendacoes: [
                variacaoPercentual >= limiarAceleracao ? 'Avaliar aumento do estoque de segurança' : null,
                variacaoPercentual >= limiarAceleracao ? 'Verificar capacidade de fornecimento' : null,
                variacaoPercentual <= -limiarAceleracao ? 'Investigar causa da queda nas vendas' : null,
                variacaoPercentual <= -limiarAceleracao ? 'Considerar ações promocionais' : null
            ].filter(Boolean)
        };
    }
    
    // Caso não seja especificado um produto, analisa todos os produtos
    const produtos = await productRepository.findAll();
    const resultados = [];
    
    for (const produto of produtos) {
        // Obter vendas do período mais recente
        const hoje = new Date();
        const inicioRecente = new Date(hoje);
        inicioRecente.setDate(hoje.getDate() - diasAnaliseRecente);
        
        const vendasRecentes = await saleItemRepository.getProductSaleStats(
            produto.id,
            inicioRecente,
            hoje
        );
        
        // Obter vendas do período anterior
        const inicioAnterior = new Date(inicioRecente);
        const fimAnterior = new Date(inicioRecente);
        inicioAnterior.setDate(inicioAnterior.getDate() - diasAnaliseRecente);
        
        const vendasAnteriores = await saleItemRepository.getProductSaleStats(
            produto.id,
            inicioAnterior,
            fimAnterior
        );
        
        // Calcular médias e variações
        const mediaRecente = vendasRecentes.totalQuantity / diasAnaliseRecente;
        const mediaAnterior = vendasAnteriores.totalQuantity / diasAnaliseRecente;
        
        const variacaoPercentual = mediaAnterior > 0 ? 
            ((mediaRecente - mediaAnterior) / mediaAnterior) * 100 : 
            mediaRecente > 0 ? 100 : 0;
        
        const receitaMediaRecente = vendasRecentes.totalRevenue / diasAnaliseRecente;
        const receitaMediaAnterior = vendasAnteriores.totalRevenue / diasAnaliseRecente;
        
        const variacaoReceita = receitaMediaAnterior > 0 ?
            ((receitaMediaRecente - receitaMediaAnterior) / receitaMediaAnterior) * 100 :
            receitaMediaRecente > 0 ? 100 : 0;
        
        // Determinar status
        let status = 'ESTÁVEL';
        let corStatus = 'blue';
        
        if (variacaoPercentual >= limiarAceleracao) {
            status = 'ACELERAÇÃO';
            corStatus = 'green';
        } else if (variacaoPercentual <= -limiarAceleracao) {
            status = 'DESACELERAÇÃO';
            corStatus = 'red';
        }
        
        // Buscar categoria
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        // Adicionar ao resultado apenas produtos com variação significativa
        if (Math.abs(variacaoPercentual) >= limiarAceleracao) {
            resultados.push({
                produtoId: produto.id,
                produtoNome: produto.name,
                categoria: categoria ? {
                    id: categoria.id,
                    nome: categoria.name
                } : null,
                metricas: {
                    mediaRecente,
                    mediaAnterior,
                    variacaoPercentual,
                    receitaMediaRecente,
                    receitaMediaAnterior,
                    variacaoReceita
                },
                status,
                corStatus,
                recomendacoes: [
                    variacaoPercentual >= limiarAceleracao ? 'Avaliar aumento do estoque de segurança' : null,
                    variacaoPercentual >= limiarAceleracao ? 'Verificar capacidade de fornecimento' : null,
                    variacaoPercentual <= -limiarAceleracao ? 'Investigar causa da queda nas vendas' : null,
                    variacaoPercentual <= -limiarAceleracao ? 'Considerar ações promocionais' : null
                ].filter(Boolean)
            });
        }
    }
    
    // Ordenar por variação percentual (maiores variações primeiro, seja positiva ou negativa)
    return resultados.sort((a, b) => 
        Math.abs(b.metricas.variacaoPercentual) - Math.abs(a.metricas.variacaoPercentual)
    );
}

// Função para calcular risco de estoque excessivo
async function getExcessStockRisk(productId?: number) {
    // Parâmetros para análise
    const diasAnalise = 30; // Últimos 30 dias
    const diasPrevisao = 14; // Próximos 14 dias
    const limiarExcesso = 2; // Multiplicador do consumo médio mensal para considerar excesso
    const limiarGiroBaixo = 0.3; // 30% do estoque como limite mínimo de giro mensal
    
    if (productId) {
        // Obter dados do produto
        const produto = await productRepository.findById(productId);
        if (!produto) {
            return {
                produtoNaoEncontrado: true,
                message: 'Produto não encontrado'
            };
        }
        
        // Obter estoque atual
        const inventoryItems = await inventoryRepository.findByProduct(productId);
        if (!inventoryItems || inventoryItems.length === 0) {
            return {
                semEstoque: true,
                message: 'Produto sem estoque cadastrado'
            };
        }
        
        const estoqueAtual = inventoryItems.reduce((total, item) => total + item.quantity, 0);
        
        // Obter histórico de vendas
        const hoje = new Date();
        const inicioAnalise = new Date(hoje);
        inicioAnalise.setDate(hoje.getDate() - diasAnalise);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(
            productId,
            inicioAnalise,
            hoje
        );
        
        // Calcular métricas
        const mediaVendasDiaria = historicoVendas.totalQuantity / diasAnalise;
        const consumoMensalEstimado = mediaVendasDiaria * 30;
        const giroMensal = consumoMensalEstimado / estoqueAtual;
        const mesesEstoque = estoqueAtual / consumoMensalEstimado;
        
        // Calcular valor do estoque
        const valorEstoque = estoqueAtual * produto.price;
        
        // Gerar previsão de vendas para os próximos dias
        const serieVendas = Array.from({ length: 30 }, () => 
            Math.max(0, mediaVendasDiaria + (Math.random() - 0.5) * mediaVendasDiaria / 2)
        );
        
        const previsaoVendas = mockForecast(serieVendas, diasPrevisao);
        const vendaEstimadaPeriodo = previsaoVendas.reduce((a, b) => a + b, 0);
        const estoqueAposPrevisao = Math.max(0, estoqueAtual - vendaEstimadaPeriodo);
        
        // Determinar status do estoque
        let status = 'NORMAL';
        let corStatus = 'green';
        let nivelRisco = 0;
        
        if (mesesEstoque > limiarExcesso && giroMensal < limiarGiroBaixo) {
            status = 'CRÍTICO';
            corStatus = 'red';
            nivelRisco = 3;
        } else if (mesesEstoque > limiarExcesso) {
            status = 'ALTO';
            corStatus = 'orange';
            nivelRisco = 2;
        } else if (giroMensal < limiarGiroBaixo) {
            status = 'MODERADO';
            corStatus = 'yellow';
            nivelRisco = 1;
        }
        
        // Buscar categoria do produto
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        // Calcular custos de armazenamento (exemplo simplificado)
        const custoArmazenamentoMensal = valorEstoque * 0.02; // 2% do valor do estoque
        
        return {
            produtoId: productId,
            produtoNome: produto.name,
            categoria: categoria ? {
                id: categoria.id,
                nome: categoria.name
            } : null,
            metricas: {
                estoqueAtual,
                valorEstoque,
                mediaVendasDiaria,
                consumoMensalEstimado,
                giroMensal,
                mesesEstoque,
                custoArmazenamentoMensal,
                previsaoProximosPeriodo: {
                    diasAnalisados: diasPrevisao,
                    vendaEstimada: vendaEstimadaPeriodo,
                    estoqueEstimadoFinal: estoqueAposPrevisao
                }
            },
            status,
            corStatus,
            nivelRisco,
            recomendacoes: [
                nivelRisco >= 2 ? 'Considerar promoção para redução de estoque' : null,
                nivelRisco >= 2 ? 'Avaliar transferência para outras unidades' : null,
                nivelRisco >= 1 ? 'Revisar política de compras' : null,
                nivelRisco >= 1 ? 'Analisar sazonalidade do produto' : null,
                'Monitorar custos de armazenamento'
            ].filter(Boolean)
        };
    }
    
    // Caso não seja especificado um produto, analisa todos os produtos
    const produtos = await productRepository.findAll();
    const resultados = [];
    
    for (const produto of produtos) {
        // Obter estoque atual
        const inventoryItems = await inventoryRepository.findByProduct(produto.id);
        if (!inventoryItems || inventoryItems.length === 0) continue;
        
        const estoqueAtual = inventoryItems.reduce((total, item) => total + item.quantity, 0);
        
        // Obter histórico de vendas
        const hoje = new Date();
        const inicioAnalise = new Date(hoje);
        inicioAnalise.setDate(hoje.getDate() - diasAnalise);
        
        const historicoVendas = await saleItemRepository.getProductSaleStats(
            produto.id,
            inicioAnalise,
            hoje
        );
        
        // Calcular métricas
        const mediaVendasDiaria = historicoVendas.totalQuantity / diasAnalise;
        const consumoMensalEstimado = mediaVendasDiaria * 30;
        const giroMensal = consumoMensalEstimado / estoqueAtual;
        const mesesEstoque = estoqueAtual / consumoMensalEstimado;
        
        // Calcular valor do estoque
        const valorEstoque = estoqueAtual * produto.price;
        
        // Gerar previsão de vendas
        const serieVendas = Array.from({ length: 30 }, () => 
            Math.max(0, mediaVendasDiaria + (Math.random() - 0.5) * mediaVendasDiaria / 2)
        );
        
        const previsaoVendas = mockForecast(serieVendas, diasPrevisao);
        const vendaEstimadaPeriodo = previsaoVendas.reduce((a, b) => a + b, 0);
        const estoqueAposPrevisao = Math.max(0, estoqueAtual - vendaEstimadaPeriodo);
        
        // Determinar status
        let status = 'NORMAL';
        let corStatus = 'green';
        let nivelRisco = 0;
        
        if (mesesEstoque > limiarExcesso && giroMensal < limiarGiroBaixo) {
            status = 'CRÍTICO';
            corStatus = 'red';
            nivelRisco = 3;
        } else if (mesesEstoque > limiarExcesso) {
            status = 'ALTO';
            corStatus = 'orange';
            nivelRisco = 2;
        } else if (giroMensal < limiarGiroBaixo) {
            status = 'MODERADO';
            corStatus = 'yellow';
            nivelRisco = 1;
        }
        
        // Buscar categoria
        const categoria = produto.categoryId ? 
            await categoryRepository.findById(produto.categoryId) : null;
        
        // Calcular custos de armazenamento
        const custoArmazenamentoMensal = valorEstoque * 0.02;
        
        // Adicionar ao resultado apenas produtos com risco
        if (nivelRisco > 0) {
            resultados.push({
                produtoId: produto.id,
                produtoNome: produto.name,
                categoria: categoria ? {
                    id: categoria.id,
                    nome: categoria.name
                } : null,
                metricas: {
                    estoqueAtual,
                    valorEstoque,
                    mediaVendasDiaria,
                    consumoMensalEstimado,
                    giroMensal,
                    mesesEstoque,
                    custoArmazenamentoMensal,
                    previsaoProximosPeriodo: {
                        diasAnalisados: diasPrevisao,
                        vendaEstimada: vendaEstimadaPeriodo,
                        estoqueEstimadoFinal: estoqueAposPrevisao
                    }
                },
                status,
                corStatus,
                nivelRisco,
                recomendacoes: [
                    nivelRisco >= 2 ? 'Considerar promoção para redução de estoque' : null,
                    nivelRisco >= 2 ? 'Avaliar transferência para outras unidades' : null,
                    nivelRisco >= 1 ? 'Revisar política de compras' : null,
                    nivelRisco >= 1 ? 'Analisar sazonalidade do produto' : null,
                    'Monitorar custos de armazenamento'
                ].filter(Boolean)
            });
        }
    }
    
    // Ordenar por nível de risco (mais críticos primeiro) e depois por valor em estoque
    return resultados.sort((a, b) => {
        if (b.nivelRisco !== a.nivelRisco) {
            return b.nivelRisco - a.nivelRisco;
        }
        return b.metricas.valorEstoque - a.metricas.valorEstoque;
    });
}

export class ForecastAgent {

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
        # AGENTE DE PREVISÃO

        Você faz parte de um sistema de agentes que responde perguntas sobre a previsão de dados de uma empresa.

        # Objetivo
        - Responder perguntas sobre a previsão de dados de uma empresa.
        - Analisar os dados e fornecer respostas detalhadas sobre métricas de estoque, vendas, fornecedores, clientes e categorias.
        - Chame a função identifyProductByName para buscar o produto mais similar ao nome fornecido.

        ${getPersonality()}

        # Métricas Disponíveis
        1. Projeção de Ruptura de Estoque
            - Identifica produtos com maior risco de acabar nos próximos 7 dias
            - Baseado na média de vendas diárias recentes e no estoque atual
            - Use getStockOutProjection()

        2. Estoque Projetado vs. Ponto de Reposição
            - Compara consumo estimado com o nível mínimo de segurança
            - Indica quais produtos devem ser reabastecidos nos próximos dias e diz qual é o seu fornecedor
            - Use getRestockAlert()

        3. Projeção de Vendas por Produto
            - Estimativa de vendas para os próximos 7 dias
            - Com base na média recente ou na mesma semana anterior
            - Use getSalesForecast()

        4. Venda Prevista Próxima de Zero
            - Identifica produtos parados ou com baixo giro previsto
            - Com base na ausência de vendas e tendências futuras
            - Use getIdleStockPrediction()

        5. Receita Projetada por Produto
            - Estimativa de receita na próxima semana por item
            - Calculada por quantidade estimada x preço unitário
            - Use getProjectedRevenue()

        6. Lucro Estimado para 7 Dias
            - Projeta o lucro por produto com base na margem e na demanda
            - Útil para priorizar itens de maior rentabilidade
            - Use getProjectedProfit()

        7. Aceleração de Vendas
            - Compara o ritmo de vendas recentes com o de dias anteriores
            - Indica aumento no interesse por determinados produtos
            - Use getSalesAcceleration()

        8. Estoque Excessivo com Baixa Projeção de Venda
            - Identifica excesso de itens com pouca previsão de giro
            - Ajuda a evitar acúmulo e planejar ações de desova
            - Use getExcessStockRisk()

        9. Visualização Gráfica
            - Cria um gráfico com os dados fornecidos
            - Envia o gráfico para o usuário via Telegram
            - Use createChart() para visualizar dados de forma gráfica
            - Você pode criar gráficos para vendas, estoque, margem, receita, etc.

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
                        case 'getStockOutProjection':
                            try {
                                const productIdForProjection = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                                const projecao = await getStockOutProjection(productIdForProjection);
                                
                                let responseText = '';
                                
                                // Verificar se é um objeto com a propriedade produtoNaoEncontrado
                                if (projecao && typeof projecao === 'object' && 'produtoNaoEncontrado' in projecao && projecao.produtoNaoEncontrado) {
                                    responseText = '❌ Produto não encontrado no estoque.';
                                } else if (Array.isArray(projecao)) {
                                    // Resposta para múltiplos produtos
                                    if (projecao.length === 0) {
                                        responseText = '✅ Nenhum produto com risco significativo de ruptura de estoque nos próximos 7 dias.';
                                    } else {
                                        responseText = `⚠️ **Alerta de Ruptura de Estoque** - ${projecao.length} produtos em risco\n\n`;
                                        
                                        // Listar os 5 produtos com maior risco
                                        const topProdutos = projecao.slice(0, 5);
                                        
                                        responseText += topProdutos.map(p => {
                                            let alertaTexto = `📦 **${p.produtoNome}**\n`;
                                            alertaTexto += `   • Estoque atual: ${p.estoqueAtual} unidades\n`;
                                            alertaTexto += `   • Consumo médio diário: ${p.mediaVendaDiaria.toFixed(1)} unidades\n`;
                                            
                                            if (p.previsaoRuptura.riscoDeFalta) {
                                                alertaTexto += `   • 🚨 **RUPTURA PREVISTA** em ${p.previsaoRuptura.diasAteRuptura} dias (${p.previsaoRuptura.dataEstimadaRuptura})\n`;
                                            } else {
                                                alertaTexto += `   • ⚠️ Risco de ruptura: ${p.previsaoRuptura.porcentagemRisco}%\n`;
                                            }
                                            
                                            return alertaTexto;
                                        }).join('\n');
                                        
                                        // Adicionar informação sobre outros produtos
                                        if (projecao.length > 5) {
                                            responseText += `\n\n...e mais ${projecao.length - 5} produtos com risco de ruptura.`;
                                        }
                                    }
                                } else if (projecao && typeof projecao === 'object') {
                                    // Verificar se é um objeto de produto único com as propriedades necessárias
                                    const produtoUnico = projecao as any;
                                    
                                    // Resposta para um produto específico
                                    responseText = `📊 **Análise de Ruptura de Estoque para ${produtoUnico.produtoNome}**\n\n`;
                                    responseText += `Estoque atual: ${produtoUnico.estoqueAtual} unidades\n`;
                                    
                                    if (produtoUnico.mediaVendaDiaria !== undefined) {
                                        responseText += `Consumo médio diário: ${produtoUnico.mediaVendaDiaria.toFixed(1)} unidades\n\n`;
                                    }
                                    
                                    if (produtoUnico.previsaoRuptura) {
                                        if (produtoUnico.previsaoRuptura.riscoDeFalta) {
                                            responseText += `🚨 **RUPTURA PREVISTA** em ${produtoUnico.previsaoRuptura.diasAteRuptura} dias (${produtoUnico.previsaoRuptura.dataEstimadaRuptura})\n\n`;
                                        } else {
                                            responseText += `⚠️ Risco de ruptura: ${produtoUnico.previsaoRuptura.porcentagemRisco}%\n\n`;
                                        }
                                    }
                                    
                                    if (produtoUnico.projecaoDiaria && Array.isArray(produtoUnico.projecaoDiaria)) {
                                        responseText += `**Projeção diária para os próximos 7 dias:**\n`;
                                        produtoUnico.projecaoDiaria.forEach((dia: {
                                            dia: number;
                                            data: string;
                                            vendaPrevista: number;
                                            estoqueProjetado: number;
                                        }) => {
                                            const emoji = dia.estoqueProjetado <= 0 ? '🚨' : dia.estoqueProjetado < 5 ? '⚠️' : '✅';
                                            responseText += `${emoji} Dia ${dia.dia} (${dia.data}): Vendas previstas: ${dia.vendaPrevista.toFixed(1)}, Estoque restante: ${dia.estoqueProjetado.toFixed(1)}\n`;
                                        });
                                    }
                                } else {
                                    responseText = 'Não foi possível analisar a projeção de estoque.';
                                }
                                
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Analisando projeção de ruptura de estoque',
                                        response: responseText
                                    }
                                };
                            } catch (error: any) {
                                console.error('[getStockOutProjection] Erro:', error);
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Erro ao analisar ruptura de estoque',
                                        response: `Não foi possível calcular a projeção de ruptura: ${error.message}`
                                    }
                                };
                            }
                            break;
                        case 'getRestockAlert':
                            try {
                                const productIdForAlert = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                                const alerta = await getRestockAlert(productIdForAlert);
                                
                                let responseText = '';
                                
                                // Verificar se é um objeto com a propriedade produtoNaoEncontrado
                                if (alerta && typeof alerta === 'object' && 'produtoNaoEncontrado' in alerta && alerta.produtoNaoEncontrado) {
                                    responseText = '❌ Produto não encontrado no estoque.';
                                } else if (Array.isArray(alerta)) {
                                    // Resposta para múltiplos produtos
                                    if (alerta.length === 0) {
                                        responseText = '✅ Nenhum produto com risco significativo de ruptura de estoque nos próximos 7 dias.';
                                    } else {
                                        responseText = `⚠️ **Alerta de Ruptura de Estoque** - ${alerta.length} produtos em risco\n\n`;
                                        
                                        // Listar os 5 produtos com maior risco
                                        const topProdutos = alerta.slice(0, 5);
                                        
                                        responseText += topProdutos.map(p => {
                                            let alertaTexto = `📦 **${p.produtoNome}**\n`;
                                            alertaTexto += `   • Estoque atual: ${p.estoqueAtual} unidades\n`;
                                            alertaTexto += `   • Consumo médio diário: ${p.mediaConsumoDiario.toFixed(1)} unidades\n`;
                                            
                                            if (p.statusUrgencia === 'CRÍTICO') {
                                                alertaTexto += `   • 🚨 **RUPTURA PREVISTA** em ${p.diasAteMinimo} dias (${p.dataReposicao})\n`;
                                            } else if (p.statusUrgencia === 'URGENTE') {
                                                alertaTexto += `   • 🚨 **RUPTURA PREVISTA** em ${p.diasAteMinimo} dias (${p.dataReposicao})\n`;
                                            } else if (p.statusUrgencia === 'ATENÇÃO') {
                                                alertaTexto += `   • 🚨 **RUPTURA PREVISTA** em ${p.diasAteMinimo} dias (${p.dataReposicao})\n`;
                                            }
                                            
                                            return alertaTexto;
                                        }).join('\n');
                                        
                                        // Adicionar informação sobre outros produtos
                                        if (alerta.length > 5) {
                                            responseText += `\n\n...e mais ${alerta.length - 5} produtos com risco de ruptura.`;
                                        }
                                    }
                                } else if (alerta && typeof alerta === 'object') {
                                    // Verificar se é um objeto de produto único com as propriedades necessárias
                                    const produtoUnico = alerta as any;
                                    
                                    // Resposta para um produto específico
                                    responseText = `📊 **Análise de Ruptura de Estoque para ${produtoUnico.produtoNome}**\n\n`;
                                    responseText += `Estoque atual: ${produtoUnico.estoqueAtual} unidades\n`;
                                    
                                    if (produtoUnico.mediaConsumoDiario !== undefined) {
                                        responseText += `Consumo médio diário: ${produtoUnico.mediaConsumoDiario.toFixed(1)} unidades\n\n`;
                                    }
                                    
                                    if (produtoUnico.statusUrgencia === 'CRÍTICO') {
                                        responseText += `🚨 **RUPTURA PREVISTA** em ${produtoUnico.diasAteMinimo} dias (${produtoUnico.dataReposicao})\n\n`;
                                    } else if (produtoUnico.statusUrgencia === 'URGENTE') {
                                        responseText += `🚨 **RUPTURA PREVISTA** em ${produtoUnico.diasAteMinimo} dias (${produtoUnico.dataReposicao})\n\n`;
                                    } else if (produtoUnico.statusUrgencia === 'ATENÇÃO') {
                                        responseText += `🚨 **RUPTURA PREVISTA** em ${produtoUnico.diasAteMinimo} dias (${produtoUnico.dataReposicao})\n\n`;
                                    }
                                    
                                    if (produtoUnico.quantidadeReposicao !== undefined) {
                                        responseText += `Quantidade ideal para reposição: ${produtoUnico.quantidadeReposicao.toFixed(1)} unidades\n\n`;
                                    }
                                    
                                    if (produtoUnico.fornecedor && typeof produtoUnico.fornecedor === 'object') {
                                        responseText += `Fornecedor: ${produtoUnico.fornecedor.nome}\n`;
                                        if (produtoUnico.fornecedor.contato) {
                                            responseText += `   • Contato: ${produtoUnico.fornecedor.contato}\n`;
                                        }
                                        if (produtoUnico.fornecedor.email) {
                                            responseText += `   • Email: ${produtoUnico.fornecedor.email}\n`;
                                        }
                                    }
                                } else {
                                    responseText = 'Não foi possível analisar o alerta de reposição de estoque.';
                                }
                                
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Analisando alerta de reposição de estoque',
                                        response: responseText
                                    }
                                };
                            } catch (error: any) {
                                console.error('[getRestockAlert] Erro:', error);
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Erro ao analisar alerta de reposição de estoque',
                                        response: `Não foi possível calcular o alerta de reposição: ${error.message}`
                                    }
                                };
                            }
                            break;
                        case 'getSalesForecast':
                            try {
                                const productIdForForecast = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                                const previsao = await getSalesForecast(productIdForForecast);
                                
                                let responseText = '';
                                
                                if (previsao && typeof previsao === 'object' && 'produtoNaoEncontrado' in previsao && previsao.produtoNaoEncontrado) {
                                    responseText = '❌ Produto não encontrado.';
                                } else if (Array.isArray(previsao)) {
                                    // Resposta para múltiplos produtos
                                    if (previsao.length === 0) {
                                        responseText = '📊 Nenhuma previsão de vendas significativa para os próximos 7 dias.';
                                    } else {
                                        responseText = `📈 **Previsão de Vendas - Próximos 7 dias**\n\n`;
                                        
                                        // Listar os 5 produtos com maior previsão de vendas
                                        const topProdutos = previsao.slice(0, 5);
                                        
                                        responseText += topProdutos.map(p => {
                                            let previsaoTexto = `📦 **${p.produtoNome}**\n`;
                                            if (p.categoria) {
                                                previsaoTexto += `   • Categoria: ${p.categoria.nome}\n`;
                                            }
                                            previsaoTexto += `   • Total previsto: ${p.previsaoVendas.totalPrevistoSemana.toFixed(1)} unidades\n`;
                                            previsaoTexto += `   • Média diária: ${p.previsaoVendas.mediaPrevisaoSemanal.toFixed(1)} unidades\n`;
                                            
                                            const variacaoTexto = p.previsaoVendas.variacaoPercentual >= 0 ? 
                                                `📈 +${p.previsaoVendas.variacaoPercentual.toFixed(1)}%` : 
                                                `📉 ${p.previsaoVendas.variacaoPercentual.toFixed(1)}%`;
                                            
                                            previsaoTexto += `   • Variação: ${variacaoTexto}\n`;
                                            previsaoTexto += `   • Receita estimada: R$ ${(p.previsaoVendas.totalPrevistoSemana * p.metricas.precoUnitario).toFixed(2)}\n`;
                                            
                                            return previsaoTexto;
                                        }).join('\n');
                                        
                                        if (previsao.length > 5) {
                                            responseText += `\n\n...e mais ${previsao.length - 5} produtos com previsão de vendas.`;
                                        }
                                    }
                                } else if (previsao && typeof previsao === 'object' && 'produtoNome' in previsao) {
                                    // Resposta para um produto específico
                                    responseText = `📊 **Previsão de Vendas para ${previsao.produtoNome}**\n\n`;
                                    
                                    if (previsao.categoria) {
                                        responseText += `Categoria: ${previsao.categoria.nome}\n\n`;
                                    }
                                    
                                    // Verificar se as propriedades necessárias existem
                                    if ('previsaoVendas' in previsao && previsao.previsaoVendas) {
                                        responseText += `📈 **Resumo da Semana**\n`;
                                        responseText += `• Total previsto: ${previsao.previsaoVendas.totalPrevistoSemana.toFixed(1)} unidades\n`;
                                        responseText += `• Média diária: ${previsao.previsaoVendas.mediaPrevisaoSemanal.toFixed(1)} unidades\n`;
                                        
                                        const variacaoTexto = previsao.previsaoVendas.variacaoPercentual >= 0 ? 
                                            `📈 +${previsao.previsaoVendas.variacaoPercentual.toFixed(1)}%` : 
                                            `📉 ${previsao.previsaoVendas.variacaoPercentual.toFixed(1)}%`;
                                        
                                        responseText += `• Variação em relação à média atual: ${variacaoTexto}\n\n`;
                                        
                                        if (previsao.previsaoVendas.previsaoDiaria) {
                                            responseText += `📅 **Previsão Diária**\n`;
                                            previsao.previsaoVendas.previsaoDiaria.forEach(dia => {
                                                responseText += `• ${dia.data}: ${dia.quantidadePrevista.toFixed(1)} unidades (R$ ${dia.valorPrevisto.toFixed(2)})\n`;
                                            });
                                        }
                                    }
                                    
                                    if ('metricas' in previsao && previsao.metricas) {
                                        responseText += `\n💰 **Métricas Adicionais**\n`;
                                        responseText += `• Média de vendas atual: ${previsao.metricas.mediaVendasRecente.toFixed(1)} unidades/dia\n`;
                                        responseText += `• Média semana anterior: ${previsao.metricas.mediaSemanaAnterior.toFixed(1)} unidades/dia\n`;
                                        responseText += `• Preço unitário: R$ ${previsao.metricas.precoUnitario.toFixed(2)}\n`;
                                        
                                        if (previsao.previsaoVendas) {
                                            responseText += `• Receita total estimada: R$ ${(previsao.previsaoVendas.totalPrevistoSemana * previsao.metricas.precoUnitario).toFixed(2)}`;
                                        }
                                    }
                                } else {
                                    responseText = 'Não foi possível gerar a previsão de vendas.';
                                }
                                
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Analisando previsão de vendas',
                                        response: responseText
                                    }
                                };
                            } catch (error: any) {
                                console.error('[getSalesForecast] Erro:', error);
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Erro ao gerar previsão de vendas',
                                        response: `Não foi possível calcular a previsão: ${error.message}`
                                    }
                                };
                            }
                            break;
                        case 'getIdleStockPrediction':
                            try {
                                const productIdForIdle = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                                const diasAnalise = toolArgs.diasAnalise || 30;
                                const analise = await getIdleStockPrediction(productIdForIdle, diasAnalise);
                                
                                let responseText = '';
                                
                                if (analise && typeof analise === 'object' && 'produtoNaoEncontrado' in analise && analise.produtoNaoEncontrado) {
                                    responseText = '❌ Produto não encontrado.';
                                } else if (analise && typeof analise === 'object' && 'semEstoque' in analise && analise.semEstoque) {
                                    responseText = '⚠️ Produto sem estoque cadastrado.';
                                } else if (Array.isArray(analise)) {
                                    // Resposta para múltiplos produtos
                                    if (analise.length === 0) {
                                        responseText = '✅ Nenhum produto com baixo giro identificado.';
                                    } else {
                                        responseText = `⚠️ **Análise de Estoque Parado** - ${analise.length} produtos identificados\n\n`;
                                        
                                        // Listar os 5 produtos mais críticos
                                        const produtosCriticos = analise.slice(0, 5);
                                        
                                        responseText += produtosCriticos.map(p => {
                                            const statusEmoji = p.status === 'CRÍTICO' ? '🚨' : '⚠️';
                                            let itemTexto = `${statusEmoji} **${p.produtoNome}**\n`;
                                            
                                            if (p.categoria) {
                                                itemTexto += `   • Categoria: ${p.categoria.nome}\n`;
                                            }
                                            
                                            itemTexto += `   • Dias sem venda: ${p.metricas.diasDesdeUltimaVenda}\n`;
                                            itemTexto += `   • Estoque atual: ${p.metricas.estoqueAtual} unidades\n`;
                                            itemTexto += `   • Valor parado: R$ ${p.metricas.valorEstoquePrado.toFixed(2)}\n`;
                                            itemTexto += `   • Giro mensal: ${(p.metricas.giroMensal * 100).toFixed(1)}%\n`;
                                            
                                            if (p.recomendacoes && p.recomendacoes.length > 0) {
                                                itemTexto += `   • 💡 Recomendações:\n`;
                                                p.recomendacoes.forEach(rec => {
                                                    itemTexto += `     - ${rec}\n`;
                                                });
                                            }
                                            
                                            return itemTexto;
                                        }).join('\n');
                                        
                                        if (analise.length > 5) {
                                            responseText += `\n\n...e mais ${analise.length - 5} produtos com baixo giro.`;
                                        }
                                        
                                        // Calcular valor total parado
                                        const valorTotalParado = analise.reduce((total, p) => total + p.metricas.valorEstoquePrado, 0);
                                        responseText += `\n\n💰 Valor total em estoque parado: R$ ${valorTotalParado.toFixed(2)}`;
                                    }
                                } else if (analise && typeof analise === 'object' && 'produtoId' in analise && 'metricas' in analise && analise.metricas) {
                                    // Resposta para um produto específico
                                    const statusEmoji = analise.status === 'CRÍTICO' ? '🚨' : analise.status === 'ATENÇÃO' ? '⚠️' : '✅';
                                    responseText = `${statusEmoji} **Análise de Giro de Estoque - ${analise.produtoNome}**\n\n`;
                                    
                                    if (analise.categoria) {
                                        responseText += `Categoria: ${analise.categoria.nome}\n\n`;
                                    }
                                    
                                    const { metricas } = analise;
                                    responseText += `📊 **Métricas Atuais**\n`;
                                    responseText += `• Estoque atual: ${metricas.estoqueAtual} unidades\n`;
                                    responseText += `• Valor em estoque: R$ ${metricas.valorEstoquePrado.toFixed(2)}\n`;
                                    responseText += `• Média de vendas: ${metricas.mediaVendasDiaria.toFixed(1)} unidades/dia\n`;
                                    responseText += `• Giro mensal: ${(metricas.giroMensal * 100).toFixed(1)}%\n`;
                                    responseText += `• Dias desde última venda: ${metricas.diasDesdeUltimaVenda}\n\n`;
                                    
                                    if (analise.status !== 'NORMAL') {
                                        responseText += `⚠️ **Status: ${analise.status}**\n\n`;
                                        
                                        if (analise.recomendacoes && analise.recomendacoes.length > 0) {
                                            responseText += `💡 **Recomendações:**\n`;
                                            analise.recomendacoes.forEach(rec => {
                                                responseText += `• ${rec}\n`;
                                            });
                                        }
                                    } else {
                                        responseText += `✅ **Status: Giro Normal**\n`;
                                    }
                                } else {
                                    responseText = 'Não foi possível analisar o giro de estoque.';
                                }
                                
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Analisando produtos com baixo giro',
                                        response: responseText
                                    }
                                };
                            } catch (error: any) {
                                console.error('[getIdleStockPrediction] Erro:', error);
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Erro ao analisar giro de estoque',
                                        response: `Não foi possível analisar o giro: ${error.message}`
                                    }
                                };
                            }
                            break;
                        case 'getProjectedRevenue':
                            try {
                                const productIdForRevenue = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                                const previsao = await getProjectedRevenue(productIdForRevenue);
                                
                                let responseText = '';
                                
                                if (previsao && typeof previsao === 'object' && 'produtoNaoEncontrado' in previsao && previsao.produtoNaoEncontrado) {
                                    responseText = '❌ Produto não encontrado.';
                                } else if (Array.isArray(previsao)) {
                                    // Resposta para múltiplos produtos
                                    if (previsao.length === 0) {
                                        responseText = '📊 Nenhuma previsão de receita disponível.';
                                    } else {
                                        responseText = `💰 **Previsão de Receita - Próximos 7 dias**\n\n`;
                                        
                                        // Listar os 5 produtos com maior receita prevista
                                        const topProdutos = previsao.slice(0, 5);
                                        
                                        responseText += topProdutos.map(p => {
                                            let previsaoTexto = `📦 **${p.produtoNome}**\n`;
                                            if (p.categoria) {
                                                previsaoTexto += `   • Categoria: ${p.categoria.nome}\n`;
                                            }
                                            
                                            const variacaoReceitaTexto = p.previsao.variacaoReceita >= 0 ? 
                                                `📈 +${p.previsao.variacaoReceita.toFixed(1)}%` : 
                                                `📉 ${p.previsao.variacaoReceita.toFixed(1)}%`;
                                            
                                            previsaoTexto += `   • Quantidade total: ${p.previsao.totalQuantidade.toFixed(1)} unidades\n`;                                            previsaoTexto += `   • Média diária: ${p.previsao.mediaQuantidadeDiaria.toFixed(1)} un/dia\n`;                                            previsaoTexto += `   • Receita prevista: R$ ${p.previsao.totalReceita.toFixed(2)}\n`;                                            previsaoTexto += `   • Média receita: R$ ${p.previsao.mediaReceitaDiaria.toFixed(2)}/dia\n`;                                            previsaoTexto += `   • Variação quantidade: ${p.previsao.variacaoQuantidade.toFixed(1)}%\n`;                                            previsaoTexto += `   • Variação receita: ${variacaoReceitaTexto}\n`;
                                            
                                            return previsaoTexto;
                                        }).join('\n');
                                        
                                        if (previsao.length > 5) {
                                            responseText += `\n\n...e mais ${previsao.length - 5} produtos com previsão de receita.`;
                                        }
                                        
                                        // Calcular receita total prevista
                                        const receitaTotalPrevista = previsao.reduce((total, p) => total + p.previsao.totalReceita, 0);
                                        responseText += `\n\n💰 Receita total prevista para o período: R$ ${receitaTotalPrevista.toFixed(2)}`;
                                    }
                                } else if (previsao && 
                                    typeof previsao === 'object' && 
                                    'produtoId' in previsao && 
                                    'previsao' in previsao && 
                                    previsao.previsao &&
                                    'metricas' in previsao &&
                                    previsao.metricas) {
                                    // Resposta para um produto específico
                                    responseText = `📊 **Previsão de Receita para ${previsao.produtoNome}**\n\n`;
                                    
                                    if (previsao.categoria) {
                                        responseText += `Categoria: ${previsao.categoria.nome}\n\n`;
                                    }
                                    
                                    const { previsao: previsaoData, metricas } = previsao;
                                    responseText += `💰 **Resumo da Semana**\n`;
                                    responseText += `• Receita total prevista: R$ ${previsaoData.totalReceita.toFixed(2)}\n`;
                                    responseText += `• Média diária: R$ ${previsaoData.mediaReceitaDiaria.toFixed(2)}\n`;
                                    responseText += `• Quantidade total: ${previsaoData.totalQuantidade.toFixed(1)} unidades\n`;
                                    
                                    const variacaoReceitaTexto = previsaoData.variacaoReceita >= 0 ? 
                                        `📈 +${previsaoData.variacaoReceita.toFixed(1)}%` : 
                                        `📉 ${previsaoData.variacaoReceita.toFixed(1)}%`;
                                    
                                    responseText += `• Variação receita: ${variacaoReceitaTexto}\n\n`;
                                    
                                    if (previsaoData.previsaoDiaria) {
                                        responseText += `📅 **Previsão Diária**\n`;
                                        previsaoData.previsaoDiaria.forEach(dia => {
                                            responseText += `• ${dia.data}: ${dia.quantidadePrevista.toFixed(1)} unidades (R$ ${dia.receitaPrevista.toFixed(2)})\n`;
                                        });
                                    }
                                    
                                    responseText += `\n📊 **Métricas Adicionais**\n`;
                                    responseText += `• Preço atual: R$ ${metricas.precoAtual.toFixed(2)}\n`;
                                    responseText += `• Preço médio histórico: R$ ${metricas.precoMedio.toFixed(2)}\n`;
                                    responseText += `• Média de vendas atual: ${metricas.mediaVendasDiaria.toFixed(1)} unidades/dia\n`;
                                    responseText += `• Receita média atual: R$ ${metricas.receitaMediaDiaria.toFixed(2)}/dia`;
                                } else {
                                    responseText = 'Não foi possível gerar a previsão de receita.';
                                }
                                
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Analisando previsão de receita',
                                        response: responseText
                                    }
                                };
                            } catch (error: any) {
                                console.error('[getProjectedRevenue] Erro:', error);
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Erro ao gerar previsão de receita',
                                        response: `Não foi possível calcular a previsão: ${error.message}`
                                    }
                                };
                            }
                            break;
                        case 'getProjectedProfit':
                            try {
                                const productIdForProfit = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                                const previsao = await getProjectedProfit(productIdForProfit);
                                
                                let responseText = '';
                                
                                if (previsao && typeof previsao === 'object' && 'produtoNaoEncontrado' in previsao && previsao.produtoNaoEncontrado) {
                                    responseText = '❌ Produto não encontrado.';
                                } else if (Array.isArray(previsao)) {
                                    // Resposta para múltiplos produtos
                                    if (previsao.length === 0) {
                                        responseText = '📊 Nenhuma previsão de lucro disponível.';
                                    } else {
                                        responseText = `💰 **Previsão de Lucro - Próximos 7 dias**\n\n`;
                                        
                                        // Listar os 5 produtos com maior lucro previsto
                                        const topProdutos = previsao.slice(0, 5);
                                        
                                        responseText += topProdutos.map(p => {
                                            let previsaoTexto = `📦 **${p.produtoNome}**\n`;
                                            if (p.categoria) {
                                                previsaoTexto += `   • Categoria: ${p.categoria.nome}\n`;
                                            }
                                            
                                            const variacaoReceitaTexto = p.previsao.variacaoReceita >= 0 ? 
                                                `📈 +${p.previsao.variacaoReceita.toFixed(1)}%` : 
                                                `📉 ${p.previsao.variacaoReceita.toFixed(1)}%`;
                                            
                                            previsaoTexto += `   • Lucro total previsto: R$ ${p.previsao.totalReceita.toFixed(2)}\n`;
                                            previsaoTexto += `   • Média diária: R$ ${p.previsao.mediaReceitaDiaria.toFixed(2)}\n`;
                                            previsaoTexto += `   • Quantidade prevista: ${p.previsao.totalQuantidade.toFixed(1)} unidades\n`;
                                            previsaoTexto += `   • Variação receita: ${variacaoReceitaTexto}\n`;
                                            previsaoTexto += `   • Preço de venda: R$ ${p.metricas.precoVenda.toFixed(2)}\n`;                                            previsaoTexto += `   • Custo unitário: R$ ${p.metricas.custoUnitario.toFixed(2)}\n`;                                            previsaoTexto += `   • Margem bruta: ${p.metricas.margemBruta.toFixed(2)}\n`;                                            previsaoTexto += `   • Margem percentual: ${p.metricas.margemPercentual.toFixed(1)}%\n`;
                                            
                                            return previsaoTexto;
                                        }).join('\n');
                                        
                                        if (previsao.length > 5) {
                                            responseText += `\n\n...e mais ${previsao.length - 5} produtos com previsão de lucro.`;
                                        }
                                        
                                        // Calcular lucro total previsto
                                        const lucroTotalPrevisto = previsao.reduce((total, p) => total + p.previsao.totalReceita, 0);
                                        responseText += `\n\n💰 Lucro total previsto para o período: R$ ${lucroTotalPrevisto.toFixed(2)}`;
                                    }
                                } else if (previsao && 
                                    typeof previsao === 'object' && 
                                    'produtoId' in previsao && 
                                    'previsao' in previsao && 
                                    previsao.previsao &&
                                    'metricas' in previsao &&
                                    previsao.metricas) {
                                    // Resposta para um produto específico
                                    responseText = `📊 **Previsão de Lucro para ${previsao.produtoNome}**\n\n`;
                                    
                                    if (previsao.categoria) {
                                        responseText += `Categoria: ${previsao.categoria.nome}\n\n`;
                                    }
                                    
                                    const { previsao: previsaoData, metricas } = previsao;
                                    responseText += `💰 **Resumo da Semana**\n`;
                                    responseText += `• Lucro total previsto: R$ ${previsaoData.totalReceita.toFixed(2)}\n`;
                                    responseText += `• Média diária: R$ ${previsaoData.mediaReceitaDiaria.toFixed(2)}\n`;
                                    responseText += `• Quantidade total: ${previsaoData.totalQuantidade.toFixed(1)} unidades\n`;
                                    
                                    const variacaoReceitaTexto = previsaoData.variacaoReceita >= 0 ? 
                                        `📈 +${previsaoData.variacaoReceita.toFixed(1)}%` : 
                                        `📉 ${previsaoData.variacaoReceita.toFixed(1)}%`;
                                    
                                    responseText += `• Variação receita: ${variacaoReceitaTexto}\n\n`;
                                    
                                    if (previsaoData.previsaoDiaria) {
                                        responseText += `📅 **Previsão Diária**\n`;
                                        previsaoData.previsaoDiaria.forEach(dia => {
                                            responseText += `• ${dia.data}: ${dia.quantidadePrevista.toFixed(1)} unidades (R$ ${dia.receitaPrevista.toFixed(2)})\n`;
                                        });
                                    }
                                    
                                    responseText += `\n📊 **Métricas Adicionais**\n`;
                                    responseText += `• Preço atual: R$ ${metricas.precoVenda.toFixed(2)}\n`;
                                    responseText += `• Preço médio histórico: R$ ${metricas.custoUnitario.toFixed(2)}\n`;
                                    responseText += `• Margem bruta: ${metricas.margemBruta.toFixed(1)}%\n`;
                                    responseText += `• Margem percentual: ${metricas.margemPercentual.toFixed(1)}%\n`;
                                    responseText += `• Média de vendas atual: ${metricas.mediaVendasDiaria.toFixed(1)} unidades/dia\n`;
                                    responseText += `• Receita média atual: R$ ${metricas.receitaMediaDiaria.toFixed(2)}/dia`;
                                } else {
                                    responseText = 'Não foi possível gerar a previsão de lucro.';
                                }
                                
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Analisando previsão de lucro',
                                        response: responseText
                                    }
                                };
                            } catch (error: any) {
                                console.error('[getProjectedProfit] Erro:', error);
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Erro ao gerar previsão de lucro',
                                        response: `Não foi possível calcular a previsão: ${error.message}`
                                    }
                                };
                            }
                            break;
                        case 'getSalesAcceleration':
                            try {
                                const productIdForAcceleration = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                                const acceleration = await getSalesAcceleration(productIdForAcceleration);
                                
                                let responseText = '';
                                
                                if (acceleration && typeof acceleration === 'object' && 'produtoNaoEncontrado' in acceleration && acceleration.produtoNaoEncontrado) {
                                    responseText = '❌ Produto não encontrado.';
                                } else if (acceleration && typeof acceleration === 'object' && 'status' in acceleration && acceleration.status) {
                                    responseText = `🔄 **Aceleração de Vendas** - ${acceleration.status}\n\n`;
                                    
                                    if (acceleration.categoria) {
                                        responseText += `Categoria: ${acceleration.categoria.nome}\n\n`;
                                    }
                                    
                                    responseText += `📈 **Métricas Adicionais**\n`;
                                    responseText += `• Média de vendas recente: ${acceleration.metricas.mediaRecente.toFixed(1)} unidades/dia\n`;
                                    responseText += `• Média de vendas anterior: ${acceleration.metricas.mediaAnterior.toFixed(1)} unidades/dia\n`;
                                    responseText += `• Variação percentual: ${acceleration.metricas.variacaoPercentual.toFixed(1)}%\n`;
                                    responseText += `• Receita média recente: R$ ${acceleration.metricas.receitaMediaRecente.toFixed(2)}/dia\n`;
                                    responseText += `• Receita média anterior: R$ ${acceleration.metricas.receitaMediaAnterior.toFixed(2)}/dia\n`;
                                    responseText += `• Variação na receita: ${acceleration.metricas.variacaoReceita.toFixed(1)}%\n`;
                                    
                                    if (acceleration.recomendacoes && acceleration.recomendacoes.length > 0) {
                                        responseText += `💡 **Recomendações:**\n`;
                                        acceleration.recomendacoes.forEach(rec => {
                                            responseText += `     - ${rec}\n`;
                                        });
                                    }
                                } else {
                                    responseText = 'Não foi possível analisar a aceleração de vendas.';
                                }
                                
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Analisando aceleração de vendas',
                                        response: responseText
                                    }
                                };
                            } catch (error: any) {
                                console.error('[getSalesAcceleration] Erro:', error);
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Erro ao analisar aceleração de vendas',
                                        response: `Não foi possível analisar a aceleração: ${error.message}`
                                    }
                                };
                            }
                            break;
                        case 'getExcessStockRisk':
                            try {
                                const productIdForRisk = toolArgs.productId && toolArgs.productId > 0 ? toolArgs.productId : undefined;
                                const risk = await getExcessStockRisk(productIdForRisk);
                                
                                let responseText = '';
                                
                                if (risk && typeof risk === 'object' && 'produtoNaoEncontrado' in risk && risk.produtoNaoEncontrado) {
                                    responseText = '❌ Produto não encontrado.';
                                } else if (Array.isArray(risk)) {
                                    // Resposta para múltiplos produtos
                                    if (risk.length === 0) {
                                        responseText = '✅ Nenhum produto com risco significativo de estoque excessivo.';
                                    } else {
                                        responseText = `⚠️ **Risco de Estoque Excessivo** - ${risk.length} produtos em risco\n\n`;
                                        
                                        // Listar os 5 produtos com maior risco
                                        const topProdutos = risk.slice(0, 5);
                                        
                                        responseText += topProdutos.map(p => {
                                            let riskTexto = `📦 **${p.produtoNome}**\n`;
                                            riskTexto += `   • Estoque atual: ${p.metricas.estoqueAtual} unidades\n`;
                                            riskTexto += `   • Valor em estoque: R$ ${p.metricas.valorEstoque.toFixed(2)}\n`;
                                            
                                            if (p.status === 'CRÍTICO') {
                                                riskTexto += `   • 🚨 **Risco Alto**\n`;
                                            } else if (p.status === 'ALTO') {
                                                riskTexto += `   • 🔥 **Risco Moderado**\n`;
                                            } else if (p.status === 'MODERADO') {
                                                riskTexto += `   • 🔥 **Risco Baixo**\n`;
                                            }
                                            
                                            riskTexto += `   • Consumo médio mensal estimado: ${p.metricas.consumoMensalEstimado.toFixed(1)} unidades\n`;
                                            riskTexto += `   • Giro mensal: ${(p.metricas.giroMensal * 100).toFixed(1)}%\n`;
                                            riskTexto += `   • Tempo de estoque: ${p.metricas.mesesEstoque.toFixed(1)} meses\n`;
                                            riskTexto += `   • Custo de armazenamento mensal: R$ ${p.metricas.custoArmazenamentoMensal.toFixed(2)}\n`;
                                            
                                            if (p.recomendacoes && p.recomendacoes.length > 0) {
                                                riskTexto += `   • 💡 Recomendações:\n`;
                                                p.recomendacoes.forEach(rec => {
                                                    riskTexto += `     - ${rec}\n`;
                                                });
                                            }
                                            
                                            return riskTexto;
                                        }).join('\n');
                                        
                                        if (risk.length > 5) {
                                            responseText += `\n\n...e mais ${risk.length - 5} produtos com risco de estoque excessivo.`;
                                        }
                                    }
                                } else if (risk && typeof risk === 'object' && 'produtoId' in risk && 'metricas' in risk && risk.metricas) {
                                    // Resposta para um produto específico
                                    const statusEmoji = risk.status === 'CRÍTICO' ? '🚨' : risk.status === 'ATENÇÃO' ? '⚠️' : '✅';
                                    responseText = `${statusEmoji} **Risco de Estoque Excessivo - ${risk.produtoNome}**\n\n`;
                                    
                                    if (risk.categoria) {
                                        responseText += `Categoria: ${risk.categoria.nome}\n\n`;
                                    }
                                    
                                    const { metricas } = risk;
                                    responseText += `📊 **Métricas Atuais**\n`;
                                    responseText += `• Estoque atual: ${metricas.estoqueAtual} unidades\n`;
                                    responseText += `• Valor em estoque: R$ ${metricas.valorEstoque.toFixed(2)}\n`;
                                    responseText += `• Média de vendas: ${metricas.mediaVendasDiaria.toFixed(1)} unidades/dia\n`;
                                    responseText += `• Giro mensal: ${(metricas.giroMensal * 100).toFixed(1)}%\n`;
                                    responseText += `• Meses de estoque: ${metricas.mesesEstoque.toFixed(1)}\n\n`;
                                    
                                    if (risk.status !== 'NORMAL') {
                                        responseText += `⚠️ **Status: ${risk.status}**\n\n`;
                                        
                                        if (risk.recomendacoes && risk.recomendacoes.length > 0) {
                                            responseText += `💡 **Recomendações:**\n`;
                                            risk.recomendacoes.forEach(rec => {
                                                responseText += `• ${rec}\n`;
                                            });
                                        }
                                    } else {
                                        responseText += `✅ **Status: Estoque Normal**\n`;
                                    }
                                } else {
                                    responseText = 'Não foi possível analisar o risco de estoque excessivo.';
                                }
                                
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Analisando risco de estoque excessivo',
                                        response: responseText
                                    }
                                };
                            } catch (error: any) {
                                console.error('[getExcessStockRisk] Erro:', error);
                                toolCallResponse = {
                                    final: false,
                                    response: {
                                        reasoning: 'Erro ao analisar risco de estoque excessivo',
                                        response: `Não foi possível calcular o risco: ${error.message}`
                                    }
                                };
                            }
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
            name: 'getStockOutProjection',
            description: 'Identifica produtos com maior risco de acabar nos próximos 7 dias, baseado na média de vendas diárias recentes e no estoque atual',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional). Se não fornecido, analisa todos os produtos.' },
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getRestockAlert',
            description: 'Identifica produtos com risco de ruptura de estoque e indica quando devem ser reabastecidos',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional). Se não fornecido, analisa todos os produtos.' },
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getSalesForecast',
            description: 'Gera previsão de vendas para os próximos 7 dias baseada no histórico recente e na mesma semana do mês anterior',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional). Se não fornecido, analisa todos os produtos.' },
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getIdleStockPrediction',
            description: 'Identifica produtos parados ou com baixo giro previsto, baseado na ausência de vendas e tendências futuras',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional). Se não fornecido, analisa todos os produtos.' }
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getProjectedRevenue',
            description: 'Calcula a receita projetada por produto para os próximos 7 dias, baseada no histórico de vendas e preços',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional). Se não fornecido, analisa todos os produtos.' }
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getProjectedProfit',
            description: 'Calcula a previsão de lucro para os próximos 7 dias, baseada no histórico de vendas e custos',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional). Se não fornecido, analisa todos os produtos.' }
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getSalesAcceleration',
            description: 'Compara o ritmo de vendas recentes com o de dias anteriores e indica aumento no interesse por determinados produtos',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional). Se não fornecido, analisa todos os produtos.' }
                },
                required: ['productId'],
                additionalProperties: false,
            },
        },
    },
    {
        type: 'function' as const,
        function: {
            name: 'getExcessStockRisk',
            description: 'Identifica produtos com risco de estoque excessivo, baseado no histórico de vendas e no estoque atual',
            strict: true,
            parameters: {
                type: 'object',
                properties: {
                    productId: { type: 'number', description: 'ID do produto (opcional). Se não fornecido, analisa todos os produtos.' },
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
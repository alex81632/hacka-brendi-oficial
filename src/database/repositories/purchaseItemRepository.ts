import { prisma } from '../prisma.js';
import { PrismaClient } from '@prisma/client';

type PurchaseItemWithRelations = {
  quantity: number;
  costPrice: number;
  productId: number;
  purchaseId: number;
  product: {
    name: string;
  };
  purchase?: {
    date: Date;
  };
};

type ItemWithPurchaseAndSupplier = {
  costPrice: number;
  quantity: number;
  purchase: {
    supplierId: number;
    date: Date;
    supplier: {
      name: string;
    };
  };
};

export const purchaseItemRepository = {
  // Buscar todos os itens de compras
  findAll: async () => {
    return prisma.purchaseItem.findMany({
      include: {
        purchase: true,
        product: true
      }
    });
  },
  
  // Buscar item de compra pelo ID
  findById: async (id: number) => {
    return prisma.purchaseItem.findUnique({
      where: { id },
      include: {
        purchase: true,
        product: true
      }
    });
  },
  
  // Buscar itens de uma compra específica
  findByPurchaseId: async (purchaseId: number) => {
    return prisma.purchaseItem.findMany({
      where: { purchaseId },
      include: {
        product: true
      }
    });
  },
  
  // Buscar itens por produto
  findByProductId: async (productId: number) => {
    return prisma.purchaseItem.findMany({
      where: { productId },
      include: {
        purchase: true
      }
    });
  },
  
  // Estatísticas de compras de produtos por período
  getProductPurchaseStats: async (productId: number, startDate: Date, endDate: Date) => {
    const items = await prisma.purchaseItem.findMany({
      where: {
        productId,
        purchase: {
          date: {
            gte: startDate,
            lte: endDate
          }
        }
      },
      include: {
        purchase: true
      }
    });
    
    type PurchaseItemBasic = {
      quantity: number;
      costPrice: number;
      purchaseId: number;
    };
    
    const totalQuantity = items.reduce((acc: number, item: PurchaseItemBasic) => acc + item.quantity, 0);
    const totalCost = items.reduce((acc: number, item: PurchaseItemBasic) => acc + (item.quantity * item.costPrice), 0);
    const purchasesCount = new Set(items.map((item: PurchaseItemBasic) => item.purchaseId)).size;
    
    return {
      productId,
      totalQuantity,
      totalCost,
      purchasesCount,
      averageCostPerUnit: totalCost / totalQuantity || 0,
      averageQuantityPerPurchase: totalQuantity / purchasesCount || 0
    };
  },
  
  // Produtos mais comprados em um período
  getTopPurchasedProducts: async (startDate: Date, endDate: Date, limit: number = 10) => {
    const items = await prisma.purchaseItem.findMany({
      where: {
        purchase: {
          date: {
            gte: startDate,
            lte: endDate
          }
        }
      },
      include: {
        product: true
      }
    });
    
    const productSummary: Record<number, {
      productId: number;
      productName: string;
      totalQuantity: number;
      totalCost: number;
      averageCost: number;
    }> = {};
    
    items.forEach((item: PurchaseItemWithRelations) => {
      const productId = item.productId;
      
      if (!productSummary[productId]) {
        productSummary[productId] = {
          productId,
          productName: item.product.name,
          totalQuantity: 0,
          totalCost: 0,
          averageCost: 0
        };
      }
      
      productSummary[productId].totalQuantity += item.quantity;
      productSummary[productId].totalCost += item.quantity * item.costPrice;
    });
    
    // Calcular custo médio por unidade
    Object.values(productSummary).forEach(product => {
      product.averageCost = product.totalCost / product.totalQuantity;
    });
    
    return Object.values(productSummary)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, limit);
  },
  
  // Evolução do preço de custo de um produto ao longo do tempo
  getProductCostHistory: async (productId: number, limit: number = 10) => {
    const items = await prisma.purchaseItem.findMany({
      where: { productId },
      include: {
        purchase: true
      },
      orderBy: {
        purchase: {
          date: 'asc'
        }
      }
    });
    
    return items.map((item: PurchaseItemWithRelations) => ({
      purchaseId: item.purchaseId,
      date: item.purchase?.date || new Date(),
      quantity: item.quantity,
      costPrice: item.costPrice
    }));
  },
  
  // Comparativo de preços entre fornecedores para um produto
  getSupplierPriceComparison: async (productId: number) => {
    const items = await prisma.purchaseItem.findMany({
      where: { productId },
      include: {
        purchase: {
          include: {
            supplier: true
          }
        }
      },
      orderBy: {
        purchase: {
          date: 'desc'
        }
      }
    });
    
    const supplierPrices: Record<number, {
      supplierId: number;
      supplierName: string;
      lastPrice: number;
      lastPurchaseDate: Date;
      priceHistory: Array<{
        date: Date;
        price: number;
        quantity: number;
      }>;
    }> = {};
    
    items.forEach((item: ItemWithPurchaseAndSupplier) => {
      const supplierId = item.purchase.supplierId;
      
      if (!supplierPrices[supplierId]) {
        supplierPrices[supplierId] = {
          supplierId,
          supplierName: item.purchase.supplier.name,
          lastPrice: item.costPrice,
          lastPurchaseDate: item.purchase.date,
          priceHistory: []
        };
      }
      
      supplierPrices[supplierId].priceHistory.push({
        date: item.purchase.date,
        price: item.costPrice,
        quantity: item.quantity
      });
    });
    
    return Object.values(supplierPrices);
  },
  
  // Criar um item de compra
  create: async (data: {
    purchaseId: number;
    productId: number;
    quantity: number;
    costPrice: number;
  }) => {
    return prisma.purchaseItem.create({
      data,
      include: {
        purchase: true,
        product: true
      }
    });
  },
  
  // Atualizar um item de compra
  update: async (id: number, data: {
    quantity?: number;
    costPrice?: number;
  }) => {
    return prisma.purchaseItem.update({
      where: { id },
      data,
      include: {
        purchase: true,
        product: true
      }
    });
  },
  
  // Atualizar estoque após alteração de um item de compra
  updateInventoryAfterItemChange: async (
    id: number, 
    oldQuantity: number, 
    newQuantity: number, 
    warehouseId: number = 1
  ) => {
    return prisma.$transaction(async (tx: PrismaClient) => {
      // Buscar o item de compra
      const purchaseItem = await tx.purchaseItem.findUnique({
        where: { id }
      });
      
      if (!purchaseItem) {
        throw new Error('Item de compra não encontrado');
      }
      
      // Buscar registro de estoque
      const inventory = await tx.inventory.findFirst({
        where: {
          productId: purchaseItem.productId,
          warehouseId
        }
      });
      
      if (!inventory) {
        throw new Error('Estoque não encontrado para este produto e armazém');
      }
      
      // Calcular diferença de quantidade
      const quantityDifference = newQuantity - oldQuantity;
      
      // Atualizar estoque
      await tx.inventory.update({
        where: { id: inventory.id },
        data: {
          quantity: inventory.quantity + quantityDifference
        }
      });
      
      // Atualizar o item
      return tx.purchaseItem.update({
        where: { id },
        data: {
          quantity: newQuantity
        }
      });
    });
  },
  
  // Excluir um item de compra
  delete: async (id: number) => {
    return prisma.purchaseItem.delete({
      where: { id }
    });
  },
  
  // Excluir todos os itens de uma compra
  deleteAllByPurchaseId: async (purchaseId: number) => {
    return prisma.purchaseItem.deleteMany({
      where: { purchaseId }
    });
  }
}; 
import { prisma } from '../prisma.js';
import { PrismaClient } from '@prisma/client';

type PurchaseItem = {
  quantity: number;
};

export const purchaseRepository = {
  // Buscar todas as compras com seus itens e fornecedor
  findAll: async () => {
    return prisma.purchase.findMany({
      include: {
        supplier: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });
  },
  
  // Buscar compra pelo ID
  findById: async (id: number) => {
    return prisma.purchase.findUnique({
      where: { id },
      include: {
        supplier: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });
  },
  
  // Buscar compras por período
  findByDateRange: async (startDate: Date, endDate: Date) => {
    return prisma.purchase.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        supplier: true,
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: {
        date: 'asc'
      }
    });
  },
  
  // Buscar compras por fornecedor
  findBySupplier: async (supplierId: number) => {
    return prisma.purchase.findMany({
      where: { supplierId },
      include: {
        supplier: true,
        items: true
      }
    });
  },
  
  // Resumo de compras por período (diário, semanal, mensal)
  getPurchaseSummaryByPeriod: async (period: 'daily' | 'weekly' | 'monthly', startDate: Date, endDate: Date) => {
    const purchases = await prisma.purchase.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        items: true
      }
    });
    
    type SummaryData = {
      totalPurchases: number;
      totalCost: number;
      itemsPurchased: number;
    };
    
    const summary: Record<string, SummaryData> = {};
    
    purchases.forEach((purchase: any) => {
      let key = '';
      const purchaseDate = new Date(purchase.date);
      
      if (period === 'daily') {
        key = purchaseDate.toISOString().split('T')[0]; // YYYY-MM-DD
      } else if (period === 'weekly') {
        // Obtém o primeiro dia da semana (domingo)
        const firstDayOfWeek = new Date(purchaseDate);
        const day = purchaseDate.getDay();
        firstDayOfWeek.setDate(purchaseDate.getDate() - day);
        key = firstDayOfWeek.toISOString().split('T')[0];
      } else if (period === 'monthly') {
        key = `${purchaseDate.getFullYear()}-${String(purchaseDate.getMonth() + 1).padStart(2, '0')}`;
      }
      
      if (!summary[key]) {
        summary[key] = {
          totalPurchases: 0,
          totalCost: 0,
          itemsPurchased: 0
        };
      }
      
      summary[key].totalPurchases += 1;
      summary[key].totalCost += purchase.totalCost;
      summary[key].itemsPurchased += purchase.items.reduce((acc: number, item: PurchaseItem) => acc + item.quantity, 0);
    });
    
    return Object.entries(summary).map(([period, data]) => ({
      period,
      ...data
    }));
  },
  
  // Total de compras por produto em um período
  getPurchasesByProduct: async (startDate: Date, endDate: Date) => {
    const purchaseItems = await prisma.purchaseItem.findMany({
      where: {
        purchase: {
          date: {
            gte: startDate,
            lte: endDate
          }
        }
      },
      include: {
        product: true,
        purchase: true
      }
    });
    
    type ProductSummary = {
      productId: number;
      productName: string;
      totalQuantity: number;
      totalCost: number;
    };
    
    const productSummary: Record<number, ProductSummary> = {};
    
    purchaseItems.forEach((item: any) => {
      const productId = item.productId;
      
      if (!productSummary[productId]) {
        productSummary[productId] = {
          productId,
          productName: item.product.name,
          totalQuantity: 0,
          totalCost: 0
        };
      }
      
      productSummary[productId].totalQuantity += item.quantity;
      productSummary[productId].totalCost += item.quantity * item.costPrice;
    });
    
    return Object.values(productSummary);
  },
  
  // Gastos por fornecedor em um período
  getExpensesBySupplier: async (startDate: Date, endDate: Date) => {
    const purchases = await prisma.purchase.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        supplier: true
      }
    });
    
    type SupplierSummary = {
      supplierId: number;
      supplierName: string;
      totalPurchases: number;
      totalCost: number;
    };
    
    const supplierSummary: Record<number, SupplierSummary> = {};
    
    purchases.forEach((purchase: any) => {
      const supplierId = purchase.supplierId;
      
      if (!supplierSummary[supplierId]) {
        supplierSummary[supplierId] = {
          supplierId,
          supplierName: purchase.supplier.name,
          totalPurchases: 0,
          totalCost: 0
        };
      }
      
      supplierSummary[supplierId].totalPurchases += 1;
      supplierSummary[supplierId].totalCost += purchase.totalCost;
    });
    
    return Object.values(supplierSummary);
  },
  
  // Criar nova compra
  create: async (data: any) => {
    return prisma.purchase.create({
      data,
      include: {
        supplier: true,
        items: true
      }
    });
  },
  
  // Criar compra com seus itens em uma transação
  createWithItems: async (purchaseData: any, itemsData: any[]) => {
    return prisma.$transaction(async (tx: PrismaClient) => {
      // Criar a compra
      const purchase = await tx.purchase.create({
        data: {
          date: purchaseData.date || new Date(),
          supplierId: purchaseData.supplierId,
          totalCost: purchaseData.totalCost,
          items: {
            create: itemsData.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              costPrice: item.costPrice
            }))
          }
        },
        include: {
          supplier: true,
          items: {
            include: {
              product: true
            }
          }
        }
      });
      
      // Atualizar o estoque com base nos itens comprados
      for (const item of purchase.items) {
        // Buscar o registro de estoque existente
        const existingInventory = await tx.inventory.findFirst({
          where: {
            productId: item.productId,
            warehouseId: purchaseData.warehouseId || 1 // Warehouse padrão se não especificado
          }
        });
        
        if (existingInventory) {
          // Atualizar estoque existente
          await tx.inventory.update({
            where: { id: existingInventory.id },
            data: {
              quantity: existingInventory.quantity + item.quantity
            }
          });
        } else {
          // Criar novo registro de estoque
          await tx.inventory.create({
            data: {
              productId: item.productId,
              warehouseId: purchaseData.warehouseId || 1,
              quantity: item.quantity
            }
          });
        }
      }
      
      return purchase;
    });
  },
  
  // Atualizar compra
  update: async (id: number, data: any) => {
    return prisma.purchase.update({
      where: { id },
      data,
      include: {
        supplier: true,
        items: true
      }
    });
  },
  
  // Excluir compra
  delete: async (id: number) => {
    return prisma.$transaction(async (tx: PrismaClient) => {
      // Excluir itens da compra primeiro
      await tx.purchaseItem.deleteMany({
        where: { purchaseId: id }
      });
      
      // Depois excluir a compra
      return tx.purchase.delete({
        where: { id }
      });
    });
  }
}; 
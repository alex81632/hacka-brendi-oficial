import { prisma } from '../prisma.js';
import { PrismaClient } from '@prisma/client';

type SaleItem = {
  quantity: number;
};

export const saleRepository = {
  // Buscar todas as vendas com seus itens, vendedor e cliente
  findAll: async () => {
    return prisma.sale.findMany({
      include: {
        seller: true,
        customer: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });
  },
  
  // Buscar venda pelo ID
  findById: async (id: number) => {
    return prisma.sale.findUnique({
      where: { id },
      include: {
        seller: true,
        customer: true,
        items: {
          include: {
            product: true
          }
        }
      }
    });
  },
  
  // Buscar vendas por período
  findByDateRange: async (startDate: Date, endDate: Date) => {
    return prisma.sale.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        seller: true,
        customer: true,
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
  
  // Buscar vendas por vendedor
  findBySeller: async (sellerId: number) => {
    return prisma.sale.findMany({
      where: { sellerId },
      include: {
        seller: true,
        customer: true,
        items: true
      }
    });
  },
  
  // Buscar vendas por cliente
  findByCustomer: async (customerId: number) => {
    return prisma.sale.findMany({
      where: { customerId },
      include: {
        seller: true,
        customer: true,
        items: true
      }
    });
  },
  
  // Resumo de vendas por período (diário, semanal, mensal)
  getSalesSummaryByPeriod: async (period: 'daily' | 'weekly' | 'monthly', startDate: Date, endDate: Date) => {
    const sales = await prisma.sale.findMany({
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
      totalSales: number;
      totalValue: number;
      itemsSold: number;
    };
    
    const summary: Record<string, SummaryData> = {};
    
    sales.forEach((sale: any) => {
      let key = '';
      const saleDate = new Date(sale.date);
      
      if (period === 'daily') {
        key = saleDate.toISOString().split('T')[0]; // YYYY-MM-DD
      } else if (period === 'weekly') {
        // Obtém o primeiro dia da semana (domingo)
        const firstDayOfWeek = new Date(saleDate);
        const day = saleDate.getDay();
        firstDayOfWeek.setDate(saleDate.getDate() - day);
        key = firstDayOfWeek.toISOString().split('T')[0];
      } else if (period === 'monthly') {
        key = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`;
      }
      
      if (!summary[key]) {
        summary[key] = {
          totalSales: 0,
          totalValue: 0,
          itemsSold: 0
        };
      }
      
      summary[key].totalSales += 1;
      summary[key].totalValue += sale.totalValue;
      summary[key].itemsSold += sale.items.reduce((acc: number, item: SaleItem) => acc + item.quantity, 0);
    });
    
    return Object.entries(summary).map(([period, data]) => ({
      period,
      ...data
    }));
  },
  
  // Total de vendas por produto em um período
  getSalesByProduct: async (startDate: Date, endDate: Date) => {
    const saleItems = await prisma.saleItem.findMany({
      where: {
        sale: {
          date: {
            gte: startDate,
            lte: endDate
          }
        }
      },
      include: {
        product: true,
        sale: true
      }
    });
    
    type ProductSummary = {
      productId: number;
      productName: string;
      totalQuantity: number;
      totalValue: number;
    };
    
    const productSummary: Record<number, ProductSummary> = {};
    
    saleItems.forEach((item: any) => {
      const productId = item.productId;
      
      if (!productSummary[productId]) {
        productSummary[productId] = {
          productId,
          productName: item.product.name,
          totalQuantity: 0,
          totalValue: 0
        };
      }
      
      productSummary[productId].totalQuantity += item.quantity;
      productSummary[productId].totalValue += item.quantity * item.unitPrice;
    });
    
    return Object.values(productSummary);
  },
  
  // Criar nova venda
  create: async (data: any) => {
    return prisma.sale.create({
      data,
      include: {
        seller: true,
        customer: true,
        items: true
      }
    });
  },
  
  // Criar venda com seus itens em uma transação
  createWithItems: async (saleData: any, itemsData: any[]) => {
    return prisma.$transaction(async (tx: PrismaClient) => {
      // Criar a venda
      const sale = await tx.sale.create({
        data: {
          date: saleData.date || new Date(),
          sellerId: saleData.sellerId,
          customerId: saleData.customerId,
          totalValue: saleData.totalValue,
          items: {
            create: itemsData.map(item => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice
            }))
          }
        },
        include: {
          seller: true,
          customer: true,
          items: {
            include: {
              product: true
            }
          }
        }
      });
      
      return sale;
    });
  },
  
  // Atualizar venda
  update: async (id: number, data: any) => {
    return prisma.sale.update({
      where: { id },
      data,
      include: {
        seller: true,
        customer: true,
        items: true
      }
    });
  },
  
  // Excluir venda
  delete: async (id: number) => {
    return prisma.$transaction(async (tx: PrismaClient) => {
      // Excluir itens da venda primeiro
      await tx.saleItem.deleteMany({
        where: { saleId: id }
      });
      
      // Depois excluir a venda
      return tx.sale.delete({
        where: { id }
      });
    });
  }
}; 
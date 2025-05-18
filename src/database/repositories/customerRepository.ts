import { prisma } from '../prisma.js';

export const customerRepository = {
  findAll: async () => {
    return prisma.customer.findMany({
      include: {
        sales: true
      }
    });
  },
  
  findById: async (id: number) => {
    return prisma.customer.findUnique({
      where: { id },
      include: {
        sales: {
          include: {
            seller: true,
            items: {
              include: {
                product: true
              }
            }
          }
        }
      }
    });
  },
  
  findByEmail: async (email: string) => {
    return prisma.customer.findUnique({
      where: { email },
      include: {
        sales: true
      }
    });
  },
  
  findByName: async (name: string) => {
    return prisma.customer.findMany({
      where: {
        name: {
          contains: name
        }
      },
      include: {
        sales: true
      }
    });
  },
  
  create: async (data: any) => {
    return prisma.customer.create({
      data,
      include: {
        sales: true
      }
    });
  },
  
  update: async (id: number, data: any) => {
    return prisma.customer.update({
      where: { id },
      data,
      include: {
        sales: true
      }
    });
  },
  
  delete: async (id: number) => {
    return prisma.customer.delete({
      where: { id }
    });
  },
  
  // Métodos específicos para clientes
  
  // Obter histórico de compras do cliente
  getPurchaseHistory: async (customerId: number) => {
    return prisma.sale.findMany({
      where: { customerId },
      include: {
        items: {
          include: {
            product: true
          }
        },
        seller: true
      },
      orderBy: {
        date: 'desc'
      }
    });
  },
  
  // Obter total de gastos do cliente em um período
  getTotalSpending: async (customerId: number, startDate: Date, endDate: Date) => {
    const sales = await prisma.sale.findMany({
      where: { 
        customerId,
        date: {
          gte: startDate,
          lte: endDate
        }
      }
    });
    
    return {
      customerId,
      totalSales: sales.length,
      totalSpent: sales.reduce((acc, sale) => acc + sale.totalValue, 0)
    };
  },
  
  // Obter produtos frequentemente comprados pelo cliente
  getFrequentlyPurchasedProducts: async (customerId: number, limit: number = 10) => {
    const saleItems = await prisma.saleItem.findMany({
      where: {
        sale: {
          customerId
        }
      },
      include: {
        product: true
      }
    });
    
    type ProductPurchase = {
      productId: number;
      productName: string;
      totalQuantity: number;
      totalSpent: number;
      purchaseCount: number;
    };
    
    const productSummary: Record<number, ProductPurchase> = {};
    
    saleItems.forEach((item: any) => {
      const productId = item.productId;
      
      if (!productSummary[productId]) {
        productSummary[productId] = {
          productId,
          productName: item.product.name,
          totalQuantity: 0,
          totalSpent: 0,
          purchaseCount: 0
        };
      }
      
      productSummary[productId].totalQuantity += item.quantity;
      productSummary[productId].totalSpent += item.quantity * item.unitPrice;
      productSummary[productId].purchaseCount += 1;
    });
    
    return Object.values(productSummary)
      .sort((a, b) => b.purchaseCount - a.purchaseCount)
      .slice(0, limit);
  },
  
  // Buscar clientes com maior valor de compras
  getTopCustomersBySpending: async (startDate: Date, endDate: Date, limit: number = 10) => {
    const sales = await prisma.sale.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        },
        customer: {
          isNot: null
        }
      },
      include: {
        customer: true
      }
    });
    
    type CustomerSpending = {
      customerId: number;
      customerName: string;
      totalSales: number;
      totalSpent: number;
    };
    
    const spendingSummary: Record<number, CustomerSpending> = {};
    
    sales.forEach((sale: any) => {
      if (!sale.customerId) return;
      
      const customerId = sale.customerId;
      
      if (!spendingSummary[customerId]) {
        spendingSummary[customerId] = {
          customerId,
          customerName: sale.customer.name,
          totalSales: 0,
          totalSpent: 0
        };
      }
      
      spendingSummary[customerId].totalSales += 1;
      spendingSummary[customerId].totalSpent += sale.totalValue;
    });
    
    return Object.values(spendingSummary)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
  }
}; 
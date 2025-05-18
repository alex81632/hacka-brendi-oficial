import { prisma } from '../prisma.js';

export const sellerRepository = {
  findAll: async () => {
    return prisma.seller.findMany({
      include: {
        sales: true
      }
    });
  },
  
  findById: async (id: number) => {
    return prisma.seller.findUnique({
      where: { id },
      include: {
        sales: {
          include: {
            items: {
              include: {
                product: true
              }
            },
            customer: true
          }
        }
      }
    });
  },
  
  findByEmail: async (email: string) => {
    return prisma.seller.findUnique({
      where: { email },
      include: {
        sales: true
      }
    });
  },
  
  findByName: async (name: string) => {
    return prisma.seller.findMany({
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
    return prisma.seller.create({
      data,
      include: {
        sales: true
      }
    });
  },
  
  update: async (id: number, data: any) => {
    return prisma.seller.update({
      where: { id },
      data,
      include: {
        sales: true
      }
    });
  },
  
  delete: async (id: number) => {
    return prisma.seller.delete({
      where: { id }
    });
  },
  
  // Métodos específicos para vendedores
  
  // Buscar vendas de um vendedor específico por período
  findSalesByPeriod: async (sellerId: number, startDate: Date, endDate: Date) => {
    return prisma.sale.findMany({
      where: {
        sellerId,
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        customer: true
      },
      orderBy: {
        date: 'desc'
      }
    });
  },
  
  // Obter desempenho de vendas por vendedor em um período
  getSalesPerformance: async (startDate: Date, endDate: Date) => {
    const sales = await prisma.sale.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        seller: true,
        items: true
      }
    });
    
    type SellerPerformance = {
      sellerId: number;
      sellerName: string;
      sellerEmail: string;
      totalSales: number;
      totalValue: number;
      itemsSold: number;
      averageTicket: number;
    };
    
    const performance: Record<number, SellerPerformance> = {};
    
    sales.forEach((sale: any) => {
      const sellerId = sale.sellerId;
      
      if (!performance[sellerId]) {
        performance[sellerId] = {
          sellerId,
          sellerName: sale.seller.name,
          sellerEmail: sale.seller.email,
          totalSales: 0,
          totalValue: 0,
          itemsSold: 0,
          averageTicket: 0
        };
      }
      
      performance[sellerId].totalSales += 1;
      performance[sellerId].totalValue += sale.totalValue;
      performance[sellerId].itemsSold += sale.items.reduce((acc: number, item: any) => acc + item.quantity, 0);
    });
    
    // Calcular o ticket médio para cada vendedor
    Object.values(performance).forEach((sellerPerf) => {
      sellerPerf.averageTicket = sellerPerf.totalValue / sellerPerf.totalSales;
    });
    
    return Object.values(performance).sort((a, b) => b.totalValue - a.totalValue);
  },
  
  // Obter os produtos mais vendidos por um vendedor específico
  getTopProductsBySeller: async (sellerId: number, limit: number = 10) => {
    const salesItems = await prisma.saleItem.findMany({
      where: {
        sale: {
          sellerId
        }
      },
      include: {
        product: true
      }
    });
    
    type ProductSales = {
      productId: number;
      productName: string;
      totalQuantity: number;
      totalValue: number;
    };
    
    const productSummary: Record<number, ProductSales> = {};
    
    salesItems.forEach((item: any) => {
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
    
    return Object.values(productSummary)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, limit);
  }
}; 
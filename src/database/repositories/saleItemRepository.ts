import { prisma } from '../prisma.js';

type SaleItemWithRelations = {
  quantity: number;
  unitPrice: number;
  productId: number;
  saleId: number;
  product: {
    name: string;
  };
};

export const saleItemRepository = {
  // Buscar todos os itens de vendas
  findAll: async () => {
    return prisma.saleItem.findMany({
      include: {
        sale: true,
        product: true
      }
    });
  },
  
  // Buscar item de venda pelo ID
  findById: async (id: number) => {
    return prisma.saleItem.findUnique({
      where: { id },
      include: {
        sale: true,
        product: true
      }
    });
  },
  
  // Buscar itens de uma venda específica
  findBySaleId: async (saleId: number) => {
    return prisma.saleItem.findMany({
      where: { saleId },
      include: {
        product: true
      }
    });
  },
  
  // Buscar itens por produto
  findByProductId: async (productId: number) => {
    return prisma.saleItem.findMany({
      where: { productId },
      include: {
        sale: true
      }
    });
  },
  
  // Estatísticas de vendas de produtos por período
  getProductSaleStats: async (productId: number, startDate: Date, endDate: Date) => {
    const items = await prisma.saleItem.findMany({
      where: {
        productId,
        sale: {
          date: {
            gte: startDate,
            lte: endDate
          }
        }
      },
      include: {
        sale: true
      }
    });
    
    type SaleItemBasic = {
      quantity: number;
      unitPrice: number;
      saleId: number;
    };
    
    const totalQuantity = items.reduce((acc: number, item: SaleItemBasic) => acc + item.quantity, 0);
    const totalRevenue = items.reduce((acc: number, item: SaleItemBasic) => acc + (item.quantity * item.unitPrice), 0);
    const salesCount = new Set(items.map((item: SaleItemBasic) => item.saleId)).size;
    
    return {
      productId,
      totalQuantity,
      totalRevenue,
      salesCount,
      averagePricePerUnit: totalRevenue / totalQuantity || 0,
      averageQuantityPerSale: totalQuantity / salesCount || 0
    };
  },
  
  // Produtos mais vendidos em um período
  getTopSellingProducts: async (startDate: Date, endDate: Date, limit: number = 10) => {
    const items = await prisma.saleItem.findMany({
      where: {
        sale: {
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
      totalRevenue: number;
    }> = {};
    
    items.forEach((item: SaleItemWithRelations) => {
      const productId = item.productId;
      
      if (!productSummary[productId]) {
        productSummary[productId] = {
          productId,
          productName: item.product.name,
          totalQuantity: 0,
          totalRevenue: 0
        };
      }
      
      productSummary[productId].totalQuantity += item.quantity;
      productSummary[productId].totalRevenue += item.quantity * item.unitPrice;
    });
    
    return Object.values(productSummary)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, limit);
  },
  
  // Criar um item de venda
  create: async (data: {
    saleId: number;
    productId: number;
    quantity: number;
    unitPrice: number;
  }) => {
    return prisma.saleItem.create({
      data,
      include: {
        sale: true,
        product: true
      }
    });
  },
  
  // Atualizar um item de venda
  update: async (id: number, data: {
    quantity?: number;
    unitPrice?: number;
  }) => {
    return prisma.saleItem.update({
      where: { id },
      data,
      include: {
        sale: true,
        product: true
      }
    });
  },
  
  // Excluir um item de venda
  delete: async (id: number) => {
    return prisma.saleItem.delete({
      where: { id }
    });
  },
  
  // Excluir todos os itens de uma venda
  deleteAllBySaleId: async (saleId: number) => {
    return prisma.saleItem.deleteMany({
      where: { saleId }
    });
  }
}; 
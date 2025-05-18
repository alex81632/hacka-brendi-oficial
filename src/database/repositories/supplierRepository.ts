import { prisma } from '../prisma.js';

export const supplierRepository = {
  findAll: async () => {
    return prisma.supplier.findMany({
      include: {
        products: true,
        purchases: true
      }
    });
  },
  
  findById: async (id: number) => {
    return prisma.supplier.findUnique({
      where: { id },
      include: {
        products: true,
        purchases: {
          include: {
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
    return prisma.supplier.findUnique({
      where: { email },
      include: {
        products: true,
        purchases: true
      }
    });
  },
  
  findByName: async (name: string) => {
    return prisma.supplier.findMany({
      where: {
        name: {
          contains: name
        }
      },
      include: {
        products: true,
        purchases: true
      }
    });
  },
  
  create: async (data: any) => {
    return prisma.supplier.create({
      data,
      include: {
        products: true,
        purchases: true
      }
    });
  },
  
  update: async (id: number, data: any) => {
    return prisma.supplier.update({
      where: { id },
      data,
      include: {
        products: true,
        purchases: true
      }
    });
  },
  
  delete: async (id: number) => {
    return prisma.supplier.delete({
      where: { id }
    });
  },
  
  // Métodos específicos para fornecedores
  
  // Buscar produtos fornecidos por um fornecedor específico
  getSupplierProducts: async (supplierId: number) => {
    return prisma.product.findMany({
      where: { supplierId },
      include: {
        category: true,
        inventory: true
      }
    });
  },
  
  // Buscar histórico de compras de um fornecedor específico
  getPurchaseHistory: async (supplierId: number) => {
    return prisma.purchase.findMany({
      where: { supplierId },
      include: {
        items: {
          include: {
            product: true
          }
        }
      },
      orderBy: {
        date: 'desc'
      }
    });
  },
  
  // Calcular total de compras por fornecedor em um período
  getPurchaseTotalByPeriod: async (supplierId: number, startDate: Date, endDate: Date) => {
    const purchases = await prisma.purchase.findMany({
      where: {
        supplierId,
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        items: true
      }
    });
    
    return {
      supplierId,
      totalPurchases: purchases.length,
      totalCost: purchases.reduce((acc, purchase) => acc + purchase.totalCost, 0),
      itemsPurchased: purchases.reduce((acc, purchase) => {
        return acc + purchase.items.reduce((sum: number, item: any) => sum + item.quantity, 0);
      }, 0)
    };
  },
  
  // Buscar fornecedores com mais compras em um período
  getTopSuppliersByPurchases: async (startDate: Date, endDate: Date, limit: number = 10) => {
    const purchases = await prisma.purchase.findMany({
      where: {
        date: {
          gte: startDate,
          lte: endDate
        }
      },
      include: {
        supplier: true,
        items: true
      }
    });
    
    type SupplierPurchase = {
      supplierId: number;
      supplierName: string;
      totalPurchases: number;
      totalCost: number;
      itemsPurchased: number;
    };
    
    const supplierSummary: Record<number, SupplierPurchase> = {};
    
    purchases.forEach((purchase: any) => {
      const supplierId = purchase.supplierId;
      
      if (!supplierSummary[supplierId]) {
        supplierSummary[supplierId] = {
          supplierId,
          supplierName: purchase.supplier.name,
          totalPurchases: 0,
          totalCost: 0,
          itemsPurchased: 0
        };
      }
      
      supplierSummary[supplierId].totalPurchases += 1;
      supplierSummary[supplierId].totalCost += purchase.totalCost;
      supplierSummary[supplierId].itemsPurchased += purchase.items.reduce(
        (acc: number, item: any) => acc + item.quantity, 0
      );
    });
    
    return Object.values(supplierSummary)
      .sort((a, b) => b.totalCost - a.totalCost)
      .slice(0, limit);
  },
  
  // Obter produtos mais comprados de um fornecedor
  getMostPurchasedProducts: async (supplierId: number, limit: number = 10) => {
    const purchaseItems = await prisma.purchaseItem.findMany({
      where: {
        purchase: {
          supplierId
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
      totalCost: number;
    };
    
    const productSummary: Record<number, ProductPurchase> = {};
    
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
    
    return Object.values(productSummary)
      .sort((a, b) => b.totalQuantity - a.totalQuantity)
      .slice(0, limit);
  },
  
  // Obter a média de preço dos produtos por fornecedor
  getAverageProductCost: async () => {
    const products = await prisma.product.findMany({
      include: {
        supplier: true
      },
      where: {
        supplier: {
          isNot: null
        }
      }
    });
    
    type SupplierCost = {
      supplierId: number;
      supplierName: string;
      totalProducts: number;
      totalCost: number;
      averageCost: number;
    };
    
    const supplierCostSummary: Record<number, SupplierCost> = {};
    
    products.forEach((product: any) => {
      if (!product.supplierId) return;
      
      const supplierId = product.supplierId;
      
      if (!supplierCostSummary[supplierId]) {
        supplierCostSummary[supplierId] = {
          supplierId,
          supplierName: product.supplier.name,
          totalProducts: 0,
          totalCost: 0,
          averageCost: 0
        };
      }
      
      supplierCostSummary[supplierId].totalProducts += 1;
      supplierCostSummary[supplierId].totalCost += product.cost;
    });
    
    // Calcular custo médio por fornecedor
    Object.values(supplierCostSummary).forEach((supplierCost) => {
      supplierCost.averageCost = supplierCost.totalProducts > 0 
        ? supplierCost.totalCost / supplierCost.totalProducts 
        : 0;
    });
    
    return Object.values(supplierCostSummary).sort((a, b) => a.averageCost - b.averageCost);
  }
}; 
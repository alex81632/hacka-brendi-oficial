import { prisma } from '../prisma.js';

export const categoryRepository = {
  findAll: async () => {
    return prisma.category.findMany({
      include: {
        products: true
      }
    });
  },
  
  findById: async (id: number) => {
    return prisma.category.findUnique({
      where: { id },
      include: {
        products: true
      }
    });
  },
  
  findByName: async (name: string) => {
    return prisma.category.findMany({
      where: {
        name: {
          contains: name
        }
      },
      include: {
        products: true
      }
    });
  },
  
  create: async (data: any) => {
    return prisma.category.create({
      data,
      include: {
        products: true
      }
    });
  },
  
  update: async (id: number, data: any) => {
    return prisma.category.update({
      where: { id },
      data,
      include: {
        products: true
      }
    });
  },
  
  delete: async (id: number) => {
    return prisma.category.delete({
      where: { id }
    });
  },
  
  // Métodos específicos para categorias
  
  // Obter produtos de uma categoria
  getProductsByCategory: async (categoryId: number) => {
    return prisma.product.findMany({
      where: { categoryId },
      include: {
        supplier: true,
        inventory: true
      }
    });
  },
  
  // Obter vendas por categoria em um período
  getSalesByCategory: async (startDate: Date, endDate: Date) => {
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
        product: {
          include: {
            category: true
          }
        }
      }
    });
    
    type CategorySales = {
      categoryId: number;
      categoryName: string;
      totalQuantity: number;
      totalValue: number;
    };
    
    const categorySummary: Record<number, CategorySales> = {};
    
    saleItems.forEach((item: any) => {
      // Ignorar itens sem categoria
      if (!item.product.categoryId) return;
      
      const categoryId = item.product.categoryId;
      
      if (!categorySummary[categoryId]) {
        categorySummary[categoryId] = {
          categoryId,
          categoryName: item.product.category.name,
          totalQuantity: 0,
          totalValue: 0
        };
      }
      
      categorySummary[categoryId].totalQuantity += item.quantity;
      categorySummary[categoryId].totalValue += item.quantity * item.unitPrice;
    });
    
    return Object.values(categorySummary).sort((a, b) => b.totalValue - a.totalValue);
  },
  
  // Obter inventário por categoria
  getInventoryByCategory: async () => {
    const products = await prisma.product.findMany({
      include: {
        category: true,
        inventory: true
      }
    });
    
    type CategoryInventory = {
      categoryId: number;
      categoryName: string;
      totalProducts: number;
      totalQuantity: number;
      averageQuantityPerProduct: number;
    };
    
    const categorySummary: Record<number, CategoryInventory> = {};
    
    products.forEach((product: any) => {
      // Ignorar produtos sem categoria
      if (!product.categoryId) return;
      
      const categoryId = product.categoryId;
      
      if (!categorySummary[categoryId]) {
        categorySummary[categoryId] = {
          categoryId,
          categoryName: product.category.name,
          totalProducts: 0,
          totalQuantity: 0,
          averageQuantityPerProduct: 0
        };
      }
      
      const totalQuantity = product.inventory.reduce((acc: number, inv: any) => acc + inv.quantity, 0);
      
      categorySummary[categoryId].totalProducts += 1;
      categorySummary[categoryId].totalQuantity += totalQuantity;
    });
    
    // Calcular média de quantidade por produto
    Object.values(categorySummary).forEach((catInv) => {
      catInv.averageQuantityPerProduct = catInv.totalProducts > 0 
        ? catInv.totalQuantity / catInv.totalProducts 
        : 0;
    });
    
    return Object.values(categorySummary);
  },
  
  // Obter categorias com produtos de baixo estoque
  getCategoriesWithLowStock: async (threshold: number) => {
    const inventory = await prisma.inventory.findMany({
      where: {
        quantity: {
          lte: threshold
        }
      },
      include: {
        product: {
          include: {
            category: true
          }
        }
      }
    });
    
    type CategoryLowStock = {
      categoryId: number;
      categoryName: string;
      lowStockProducts: number;
      products: Array<{
        productId: number;
        productName: string;
        totalQuantity: number;
      }>;
    };
    
    const categoryLowStock: Record<number, CategoryLowStock> = {};
    
    inventory.forEach((inv: any) => {
      // Ignorar produtos sem categoria
      if (!inv.product.categoryId) return;
      
      const categoryId = inv.product.categoryId;
      
      if (!categoryLowStock[categoryId]) {
        categoryLowStock[categoryId] = {
          categoryId,
          categoryName: inv.product.category.name,
          lowStockProducts: 0,
          products: []
        };
      }
      
      // Verificar se o produto já foi contabilizado
      const existingProduct = categoryLowStock[categoryId].products.find(
        (p) => p.productId === inv.productId
      );
      
      if (!existingProduct) {
        categoryLowStock[categoryId].lowStockProducts += 1;
        categoryLowStock[categoryId].products.push({
          productId: inv.productId,
          productName: inv.product.name,
          totalQuantity: inv.quantity
        });
      } else {
        existingProduct.totalQuantity += inv.quantity;
      }
    });
    
    return Object.values(categoryLowStock).sort((a, b) => b.lowStockProducts - a.lowStockProducts);
  }
}; 
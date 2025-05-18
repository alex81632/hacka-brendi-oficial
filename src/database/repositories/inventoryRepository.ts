import { prisma } from '../prisma.js';

export const inventoryRepository = {
  findAll: async () => {
    return prisma.inventory.findMany({
      include: {
        product: true,
        warehouse: true
      }
    });
  },
  
  findById: async (id: number) => {
    return prisma.inventory.findUnique({
      where: { id },
      include: {
        product: true,
        warehouse: true
      }
    });
  },
  
  findByProduct: async (productId: number) => {
    return prisma.inventory.findMany({
      where: { productId },
      include: {
        warehouse: true,
        product: true
      }
    });
  },
  
  findByWarehouse: async (warehouseId: number) => {
    return prisma.inventory.findMany({
      where: { warehouseId },
      include: {
        product: true,
        warehouse: true
      }
    });
  },
  
  create: async (data: any) => {
    return prisma.inventory.create({
      data,
      include: {
        product: true,
        warehouse: true
      }
    });
  },
  
  update: async (id: number, data: any) => {
    return prisma.inventory.update({
      where: { id },
      data,
      include: {
        product: true,
        warehouse: true
      }
    });
  },
  
  delete: async (id: number) => {
    return prisma.inventory.delete({
      where: { id }
    });
  },
  
  // Métodos específicos para inventário
  
  // Atualizar quantidade de um produto em um armazém
  updateQuantity: async (id: number, quantity: number) => {
    return prisma.inventory.update({
      where: { id },
      data: { 
        quantity,
        updatedAt: new Date() 
      },
      include: {
        product: true,
        warehouse: true
      }
    });
  },
  
  // Adicionar quantidade a um inventário existente
  addQuantity: async (id: number, quantityToAdd: number) => {
    const currentInventory = await prisma.inventory.findUnique({
      where: { id }
    });
    
    if (!currentInventory) {
      throw new Error(`Inventário com ID ${id} não encontrado`);
    }
    
    return prisma.inventory.update({
      where: { id },
      data: { 
        quantity: currentInventory.quantity + quantityToAdd,
        updatedAt: new Date() 
      },
      include: {
        product: true,
        warehouse: true
      }
    });
  },
  
  // Remover quantidade de um inventário existente
  removeQuantity: async (id: number, quantityToRemove: number) => {
    const currentInventory = await prisma.inventory.findUnique({
      where: { id }
    });
    
    if (!currentInventory) {
      throw new Error(`Inventário com ID ${id} não encontrado`);
    }
    
    if (currentInventory.quantity < quantityToRemove) {
      throw new Error(`Quantidade insuficiente no inventário. Disponível: ${currentInventory.quantity}, Solicitado: ${quantityToRemove}`);
    }
    
    return prisma.inventory.update({
      where: { id },
      data: { 
        quantity: currentInventory.quantity - quantityToRemove,
        updatedAt: new Date() 
      },
      include: {
        product: true,
        warehouse: true
      }
    });
  },
  
  // Buscar itens com estoque baixo
  findLowStock: async (threshold: number) => {
    return prisma.inventory.findMany({
      where: {
        quantity: {
          lte: threshold
        }
      },
      include: {
        product: true,
        warehouse: true
      },
      orderBy: {
        quantity: 'asc'
      }
    });
  },
  
  // Transferir estoque entre armazéns
  transferStock: async (sourceId: number, targetId: number, quantity: number) => {
    return prisma.$transaction(async (tx) => {
      // Buscar inventários de origem e destino
      const sourceInventory = await tx.inventory.findUnique({
        where: { id: sourceId }
      });
      
      const targetInventory = await tx.inventory.findUnique({
        where: { id: targetId }
      });
      
      if (!sourceInventory) {
        throw new Error(`Inventário de origem com ID ${sourceId} não encontrado`);
      }
      
      if (!targetInventory) {
        throw new Error(`Inventário de destino com ID ${targetId} não encontrado`);
      }
      
      if (sourceInventory.productId !== targetInventory.productId) {
        throw new Error('Os inventários de origem e destino devem ser do mesmo produto');
      }
      
      if (sourceInventory.quantity < quantity) {
        throw new Error(`Quantidade insuficiente no inventário de origem. Disponível: ${sourceInventory.quantity}, Solicitado: ${quantity}`);
      }
      
      // Atualizar inventário de origem (reduzir quantidade)
      const updatedSource = await tx.inventory.update({
        where: { id: sourceId },
        data: {
          quantity: sourceInventory.quantity - quantity,
          updatedAt: new Date()
        }
      });
      
      // Atualizar inventário de destino (aumentar quantidade)
      const updatedTarget = await tx.inventory.update({
        where: { id: targetId },
        data: {
          quantity: targetInventory.quantity + quantity,
          updatedAt: new Date()
        }
      });
      
      return {
        source: updatedSource,
        target: updatedTarget
      };
    });
  }
}; 
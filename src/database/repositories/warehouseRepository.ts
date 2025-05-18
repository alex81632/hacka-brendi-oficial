import { prisma } from '../prisma.js';

export const warehouseRepository = {
  findAll: async () => {
    return prisma.warehouse.findMany({
      include: {
        inventory: {
          include: {
            product: true
          }
        }
      }
    });
  },
  
  findById: async (id: number) => {
    return prisma.warehouse.findUnique({
      where: { id },
      include: {
        inventory: {
          include: {
            product: true
          }
        }
      }
    });
  },
  
  findByName: async (name: string) => {
    return prisma.warehouse.findMany({
      where: {
        name: {
          contains: name
        }
      },
      include: {
        inventory: true
      }
    });
  },
  
  create: async (data: any) => {
    return prisma.warehouse.create({
      data,
      include: {
        inventory: true
      }
    });
  },
  
  update: async (id: number, data: any) => {
    return prisma.warehouse.update({
      where: { id },
      data,
      include: {
        inventory: true
      }
    });
  },
  
  delete: async (id: number) => {
    return prisma.warehouse.delete({
      where: { id }
    });
  },
  
  // Métodos adicionais específicos para warehouse

  // Buscar depósitos com produtos de baixo estoque
  findWithLowInventory: async (threshold: number) => {
    return prisma.warehouse.findMany({
      include: {
        inventory: {
          where: {
            quantity: {
              lte: threshold
            }
          },
          include: {
            product: true
          }
        }
      },
      where: {
        inventory: {
          some: {
            quantity: {
              lte: threshold
            }
          }
        }
      }
    });
  },
  
  // Buscar depósitos por localização
  findByLocation: async (location: string) => {
    return prisma.warehouse.findMany({
      where: {
        location: {
          contains: location
        }
      },
      include: {
        inventory: {
          include: {
            product: true
          }
        }
      }
    });
  }
}; 
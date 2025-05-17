import { prisma } from '../prisma.js';

export const productRepository = {
  findAll: async () => {
    return prisma.product.findMany({
      include: {
        supplier: true,
        category: true
      }
    });
  },
  
  findById: async (id: number) => {
    return prisma.product.findUnique({
      where: { id },
      include: {
        supplier: true,
        category: true,
        inventory: true
      }
    });
  },
  
  findByName: async (name: string) => {
    return prisma.product.findMany({
      where: {
        name: {
          contains: name
        }
      },
      include: {
        supplier: true,
        category: true
      }
    });
  },
  
  create: async (data: any) => {
    return prisma.product.create({
      data,
      include: {
        supplier: true,
        category: true
      }
    });
  },
  
  update: async (id: number, data: any) => {
    return prisma.product.update({
      where: { id },
      data,
      include: {
        supplier: true,
        category: true
      }
    });
  },
  
  delete: async (id: number) => {
    return prisma.product.delete({
      where: { id }
    });
  }
}; 
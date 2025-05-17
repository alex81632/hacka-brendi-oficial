import { prisma } from './prisma.js';

async function main() {
  try {
    // Cria uma categoria
    const category = await prisma.category.create({
      data: {
        name: 'Eletrônicos'
      }
    });

    // Cria um fornecedor
    const supplier = await prisma.supplier.create({
      data: {
        name: 'Fornecedor A',
        email: 'contato@fornecedora.com',
        contact: 'João Silva'
      }
    });

    // Cria um vendedor
    const seller = await prisma.seller.create({
      data: {
        name: 'Maria Oliveira',
        email: 'maria@exemplo.com',
        phone: '(11) 98765-4321'
      }
    });

    // Cria um cliente
    const customer = await prisma.customer.create({
      data: {
        name: 'Cliente Exemplo',
        email: 'cliente@exemplo.com',
        phone: '(11) 91234-5678'
      }
    });

    // Cria um armazém
    const warehouse = await prisma.warehouse.create({
      data: {
        name: 'Armazém Principal',
        location: 'São Paulo, SP'
      }
    });

    // Cria um produto
    const product = await prisma.product.create({
      data: {
        name: 'Smartphone X',
        description: 'Um smartphone avançado',
        sku: 'SPX-001',
        price: 1999.90,
        cost: 1200.00,
        supplierId: supplier.id,
        categoryId: category.id
      }
    });

    // Adiciona produto ao inventário
    await prisma.inventory.create({
      data: {
        productId: product.id,
        warehouseId: warehouse.id,
        quantity: 50
      }
    });

    console.log('Banco de dados inicializado com sucesso!');
  } catch (error) {
    console.error('Erro ao inicializar banco de dados:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main(); 
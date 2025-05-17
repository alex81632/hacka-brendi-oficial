import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

// Helper to pick a random date within the last year
function randomDateWithinLastYear() {
  const now = new Date();
  const past = new Date();
  past.setFullYear(now.getFullYear() - 1);
  return new Date(past.getTime() + Math.random() * (now.getTime() - past.getTime()));
}

async function main() {
  // Create Suppliers
  const suppliers = [];
  for (let i = 0; i < 10; i++) {
    const sup = await prisma.supplier.create({
      data: {
        name: faker.company.name(),
        contact: faker.person.fullName(),
        email: faker.internet.email(),
      },
    });
    suppliers.push(sup);
  }

  // Categorias típicas de material de construção
  const categoriasConstrucao = [
    'Cimento', 'Areia', 'Brita', 'Tijolos', 'Blocos', 'Telhas', 'Tinta', 'Argamassa', 'Ferragens', 'Tubos e Conexões',
    'Elétrica', 'Hidráulica', 'Ferramentas', 'Madeira', 'Portas e Janelas', 'Pisos e Revestimentos', 'Impermeabilizantes'
  ];
  const categories = [];
  for (const nome of categoriasConstrucao) {
    const cat = await prisma.category.create({ data: { name: nome } });
    categories.push(cat);
  }

  // Produtos típicos de material de construção
  const produtosConstrucao = [
    { nome: 'Cimento CP-II 50kg', descricao: 'Saco de cimento Portland 50kg', categoria: 'Cimento' },
    { nome: 'Areia Média 20kg', descricao: 'Saco de areia média lavada 20kg', categoria: 'Areia' },
    { nome: 'Brita 1 20kg', descricao: 'Saco de brita tipo 1, 20kg', categoria: 'Brita' },
    { nome: 'Tijolo Baiano 9 furos', descricao: 'Tijolo cerâmico baiano 9 furos', categoria: 'Tijolos' },
    { nome: 'Bloco de Concreto 14x19x39cm', descricao: 'Bloco estrutural de concreto', categoria: 'Blocos' },
    { nome: 'Telha Cerâmica Colonial', descricao: 'Telha cerâmica modelo colonial', categoria: 'Telhas' },
    { nome: 'Tinta Acrílica 18L', descricao: 'Lata de tinta acrílica branca 18L', categoria: 'Tinta' },
    { nome: 'Argamassa AC-I 20kg', descricao: 'Saco de argamassa colante AC-I 20kg', categoria: 'Argamassa' },
    { nome: 'Vergalhão CA-50 8mm', descricao: 'Barra de vergalhão de aço 8mm', categoria: 'Ferragens' },
    { nome: 'Tubo PVC 50mm', descricao: 'Tubo de PVC para esgoto 50mm', categoria: 'Tubos e Conexões' },
    { nome: 'Fio Flexível 2,5mm', descricao: 'Rolo de fio flexível 2,5mm 100m', categoria: 'Elétrica' },
    { nome: 'Registro de Pressão 1/2"', descricao: 'Registro de pressão para água 1/2"', categoria: 'Hidráulica' },
    { nome: 'Martelo Unha 27mm', descricao: 'Martelo de unha cabo de madeira', categoria: 'Ferramentas' },
    { nome: 'Caibro de Madeira 5x5cm', descricao: 'Caibro de madeira tratado 5x5cm', categoria: 'Madeira' },
    { nome: 'Porta de Madeira Lisa', descricao: 'Porta lisa de madeira 210x70cm', categoria: 'Portas e Janelas' },
    { nome: 'Piso Cerâmico 45x45cm', descricao: 'Caixa de piso cerâmico branco 45x45cm', categoria: 'Pisos e Revestimentos' },
    { nome: 'Manta Asfáltica 1m x 10m', descricao: 'Rolo de manta asfáltica para impermeabilização', categoria: 'Impermeabilizantes' },
    // +20 produtos típicos
    { nome: 'Cimento CP-IV 25kg', descricao: 'Saco de cimento Portland 25kg', categoria: 'Cimento' },
    { nome: 'Areia Fina 20kg', descricao: 'Saco de areia fina lavada 20kg', categoria: 'Areia' },
    { nome: 'Brita 0 20kg', descricao: 'Saco de brita tipo 0, 20kg', categoria: 'Brita' },
    { nome: 'Tijolo Maciço', descricao: 'Tijolo cerâmico maciço', categoria: 'Tijolos' },
    { nome: 'Bloco de Concreto 9x19x39cm', descricao: 'Bloco de concreto para vedação', categoria: 'Blocos' },
    { nome: 'Telha de Fibrocimento 4mm', descricao: 'Telha ondulada de fibrocimento 2,44m', categoria: 'Telhas' },
    { nome: 'Tinta Esmalte Sintético 3,6L', descricao: 'Lata de tinta esmalte sintético branca 3,6L', categoria: 'Tinta' },
    { nome: 'Argamassa AC-III 20kg', descricao: 'Saco de argamassa colante AC-III 20kg', categoria: 'Argamassa' },
    { nome: 'Vergalhão CA-60 10mm', descricao: 'Barra de vergalhão de aço 10mm', categoria: 'Ferragens' },
    { nome: 'Joelho PVC 90º 50mm', descricao: 'Joelho de PVC para esgoto 50mm', categoria: 'Tubos e Conexões' },
    { nome: 'Disjuntor DIN 20A', descricao: 'Disjuntor padrão DIN 20 amperes', categoria: 'Elétrica' },
    { nome: 'Torneira de Jardim 1/2"', descricao: 'Torneira metálica para jardim 1/2"', categoria: 'Hidráulica' },
    { nome: 'Trena 5m', descricao: 'Trena de aço 5 metros', categoria: 'Ferramentas' },
    { nome: 'Viga de Madeira 6x12cm', descricao: 'Viga de madeira tratada 6x12cm', categoria: 'Madeira' },
    { nome: 'Janela de Alumínio 1,20x1,00m', descricao: 'Janela de correr alumínio branco', categoria: 'Portas e Janelas' },
    { nome: 'Revestimento Cerâmico 30x60cm', descricao: 'Caixa de revestimento cerâmico 30x60cm', categoria: 'Pisos e Revestimentos' },
    { nome: 'Impermeabilizante Acrílico 18L', descricao: 'Lata de impermeabilizante acrílico 18L', categoria: 'Impermeabilizantes' },
    { nome: 'Cimento Branco 20kg', descricao: 'Saco de cimento branco estrutural 20kg', categoria: 'Cimento' },
    { nome: 'Areia Lavada Grossa 20kg', descricao: 'Saco de areia grossa lavada 20kg', categoria: 'Areia' },
    { nome: 'Bloco de Vidro 19x19x8cm', descricao: 'Bloco de vidro translúcido', categoria: 'Blocos' },
    { nome: 'Serra Mármore 110mm', descricao: 'Serra mármore elétrica 110mm', categoria: 'Ferramentas' },
    { nome: 'Chave Philips 6"', descricao: 'Chave de fenda Philips 6 polegadas', categoria: 'Ferramentas' },
    { nome: 'Interruptor Simples', descricao: 'Interruptor simples de embutir', categoria: 'Elétrica' },
    { nome: 'Caixa d\'Água 500L', descricao: 'Caixa d\'água de polietileno 500 litros', categoria: 'Hidráulica' },
    { nome: 'Torneira Elétrica 220V', descricao: 'Torneira elétrica para cozinha 220V', categoria: 'Hidráulica' },
    { nome: 'Piso Porcelanato 60x60cm', descricao: 'Caixa de piso porcelanato 60x60cm', categoria: 'Pisos e Revestimentos' },
    { nome: 'Porta de Alumínio Basculante', descricao: 'Porta basculante de alumínio 210x70cm', categoria: 'Portas e Janelas' }
  ];

  // Criação dos produtos (todos da lista acima)
  const products = [];
  for (const prod of produtosConstrucao) {
    const cat = categories.find(c => c.name === prod.categoria);
    const pr = await prisma.product.create({
      data: {
        name: prod.nome,
        description: prod.descricao,
        sku: faker.string.uuid(),
        price: parseFloat(faker.commerce.price({ min: 10, max: 500 })),
        cost: parseFloat(faker.commerce.price({ min: 5, max: 400 })),
        supplierId: suppliers[Math.floor(Math.random() * suppliers.length)].id,
        categoryId: cat?.id,
      },
    });
    products.push(pr);
  }

  // Create Warehouses
  const warehouses = [];
  for (let i = 0; i < 3; i++) {
    const wh = await prisma.warehouse.create({
      data: {
        name: `Warehouse ${i + 1}`,
        location: faker.location.city(),
      },
    });
    warehouses.push(wh);
  }

  // Initial Inventory entries
  for (const p of products) {
    const wh = warehouses[Math.floor(Math.random() * warehouses.length)];
    await prisma.inventory.create({
      data: {
        productId: p.id,
        warehouseId: wh.id,
        quantity: faker.number.int({ min: 10, max: 100 }),
      },
    });
  }

  // Criação dos vendedores (15)
  const sellers = [];
  for (let i = 0; i < 15; i++) {
    const se = await prisma.seller.create({
      data: {
        name: faker.person.fullName(),
        email: faker.internet.email(),
        phone: faker.phone.number(),
      },
    });
    sellers.push(se);
  }

  // Criação dos clientes (20)
  const customers = [];
  for (let i = 0; i < 20; i++) {
    const cu = await prisma.customer.create({
      data: {
        name: faker.person.fullName(),
        email: faker.internet.email(),
        phone: faker.phone.number(),
      },
    });
    customers.push(cu);
  }

  // Create Purchase Logs (300 entries)
  for (let i = 0; i < 300; i++) {
    const date = randomDateWithinLastYear();
    const supplier = suppliers[Math.floor(Math.random() * suppliers.length)];
    const itemCount = faker.number.int({ min: 1, max: 5 });
    const items = [];
    let totalCost = 0;
    for (let j = 0; j < itemCount; j++) {
      const product = products[faker.number.int({ min: 0, max: products.length - 1 })];
      const qty = faker.number.int({ min: 1, max: 20 });
      const costPrice = product.cost;
      totalCost += costPrice * qty;
      items.push({ productId: product.id, quantity: qty, costPrice });
    }
    const purchase = await prisma.purchase.create({
      data: {
        date,
        supplierId: supplier.id,
        totalCost,
        items: { create: items },
      },
    });

    // Update inventory
    for (const it of items) {
      await prisma.inventory.updateMany({
        where: { productId: it.productId },
        data: { quantity: { increment: it.quantity } },
      });
    }
  }

  // Create Sale Logs (320 entries)
  for (let i = 0; i < 320; i++) {
    const date = randomDateWithinLastYear();
    const seller = sellers[Math.floor(Math.random() * sellers.length)];
    const customer = customers[Math.floor(Math.random() * customers.length)];
    const itemCount = faker.number.int({ min: 1, max: 5 });
    const items = [];
    let totalValue = 0;
    for (let j = 0; j < itemCount; j++) {
      const product = products[faker.number.int({ min: 0, max: products.length - 1 })];
      const qty = faker.number.int({ min: 1, max: 10 });
      const unitPrice = product.price;
      totalValue += unitPrice * qty;
      items.push({ productId: product.id, quantity: qty, unitPrice });
    }
    const sale = await prisma.sale.create({
      data: {
        date,
        sellerId: seller.id,
        customerId: customer.id,
        totalValue,
        items: { create: items },
      },
    });

    // Update inventory
    for (const it of items) {
      await prisma.inventory.updateMany({
        where: { productId: it.productId },
        data: { quantity: { decrement: it.quantity } },
      });
    }
  }

  console.log('Seed data created successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

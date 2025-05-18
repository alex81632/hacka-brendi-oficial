import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker';

const prisma = new PrismaClient();

// Helper to pick a random date within the last 3 months (01/03/2025 to 16/05/2025)
function randomDateWithinLast3Months() {
  const start = new Date('2025-03-01T00:00:00');
  const end = new Date('2025-05-16T23:59:59');
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
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

  // Produtos típicos de material de construção com preços e custos realistas
  const produtosConstrucao = [
    { nome: 'Cimento CP-II 50kg', descricao: 'Saco de cimento Portland 50kg', categoria: 'Cimento', preco: 38.90, custo: 28.00 },
    { nome: 'Areia Média 20kg', descricao: 'Saco de areia média lavada 20kg', categoria: 'Areia', preco: 14.00, custo: 8.00 },
    { nome: 'Brita 1 20kg', descricao: 'Saco de brita tipo 1, 20kg', categoria: 'Brita', preco: 16.00, custo: 10.00 },
    { nome: 'Tijolo Baiano 9 furos', descricao: 'Tijolo cerâmico baiano 9 furos', categoria: 'Tijolos', preco: 1.20, custo: 0.80 },
    { nome: 'Bloco de Concreto 14x19x39cm', descricao: 'Bloco estrutural de concreto', categoria: 'Blocos', preco: 4.50, custo: 3.00 },
    { nome: 'Telha Cerâmica Colonial', descricao: 'Telha cerâmica modelo colonial', categoria: 'Telhas', preco: 2.80, custo: 1.80 },
    { nome: 'Tinta Acrílica 18L', descricao: 'Lata de tinta acrílica branca 18L', categoria: 'Tinta', preco: 220.00, custo: 160.00 },
    { nome: 'Argamassa AC-I 20kg', descricao: 'Saco de argamassa colante AC-I 20kg', categoria: 'Argamassa', preco: 22.00, custo: 14.00 },
    { nome: 'Vergalhão CA-50 8mm', descricao: 'Barra de vergalhão de aço 8mm', categoria: 'Ferragens', preco: 38.00, custo: 28.00 },
    { nome: 'Tubo PVC 50mm', descricao: 'Tubo de PVC para esgoto 50mm', categoria: 'Tubos e Conexões', preco: 32.00, custo: 22.00 },
    { nome: 'Fio Flexível 2,5mm', descricao: 'Rolo de fio flexível 2,5mm 100m', categoria: 'Elétrica', preco: 210.00, custo: 160.00 },
    { nome: 'Registro de Pressão 1/2"', descricao: 'Registro de pressão para água 1/2"', categoria: 'Hidráulica', preco: 18.00, custo: 12.00 },
    { nome: 'Martelo Unha 27mm', descricao: 'Martelo de unha cabo de madeira', categoria: 'Ferramentas', preco: 28.00, custo: 18.00 },
    { nome: 'Caibro de Madeira 5x5cm', descricao: 'Caibro de madeira tratado 5x5cm', categoria: 'Madeira', preco: 42.00, custo: 30.00 },
    { nome: 'Porta de Madeira Lisa', descricao: 'Porta lisa de madeira 210x70cm', categoria: 'Portas e Janelas', preco: 320.00, custo: 220.00 },
    { nome: 'Piso Cerâmico 45x45cm', descricao: 'Caixa de piso cerâmico branco 45x45cm', categoria: 'Pisos e Revestimentos', preco: 65.00, custo: 48.00 },
    { nome: 'Manta Asfáltica 1m x 10m', descricao: 'Rolo de manta asfáltica para impermeabilização', categoria: 'Impermeabilizantes', preco: 180.00, custo: 130.00 },
    { nome: 'Cimento CP-IV 25kg', descricao: 'Saco de cimento Portland 25kg', categoria: 'Cimento', preco: 22.00, custo: 15.00 },
    { nome: 'Areia Fina 20kg', descricao: 'Saco de areia fina lavada 20kg', categoria: 'Areia', preco: 15.00, custo: 9.00 },
    { nome: 'Brita 0 20kg', descricao: 'Saco de brita tipo 0, 20kg', categoria: 'Brita', preco: 17.00, custo: 11.00 },
    { nome: 'Tijolo Maciço', descricao: 'Tijolo cerâmico maciço', categoria: 'Tijolos', preco: 1.50, custo: 1.00 },
    { nome: 'Bloco de Concreto 9x19x39cm', descricao: 'Bloco de concreto para vedação', categoria: 'Blocos', preco: 3.80, custo: 2.60 },
    { nome: 'Telha de Fibrocimento 4mm', descricao: 'Telha ondulada de fibrocimento 2,44m', categoria: 'Telhas', preco: 48.00, custo: 34.00 },
    { nome: 'Tinta Esmalte Sintético 3,6L', descricao: 'Lata de tinta esmalte sintético branca 3,6L', categoria: 'Tinta', preco: 85.00, custo: 60.00 },
    { nome: 'Argamassa AC-III 20kg', descricao: 'Saco de argamassa colante AC-III 20kg', categoria: 'Argamassa', preco: 32.00, custo: 22.00 },
    { nome: 'Vergalhão CA-60 10mm', descricao: 'Barra de vergalhão de aço 10mm', categoria: 'Ferragens', preco: 52.00, custo: 38.00 },
    { nome: 'Joelho PVC 90º 50mm', descricao: 'Joelho de PVC para esgoto 50mm', categoria: 'Tubos e Conexões', preco: 7.00, custo: 4.00 },
    { nome: 'Disjuntor DIN 20A', descricao: 'Disjuntor padrão DIN 20 amperes', categoria: 'Elétrica', preco: 22.00, custo: 15.00 },
    { nome: 'Torneira de Jardim 1/2"', descricao: 'Torneira metálica para jardim 1/2"', categoria: 'Hidráulica', preco: 24.00, custo: 16.00 },
    { nome: 'Trena 5m', descricao: 'Trena de aço 5 metros', categoria: 'Ferramentas', preco: 32.00, custo: 22.00 },
    { nome: 'Viga de Madeira 6x12cm', descricao: 'Viga de madeira tratada 6x12cm', categoria: 'Madeira', preco: 110.00, custo: 80.00 },
    { nome: 'Janela de Alumínio 1,20x1,00m', descricao: 'Janela de correr alumínio branco', categoria: 'Portas e Janelas', preco: 420.00, custo: 320.00 },
    { nome: 'Revestimento Cerâmico 30x60cm', descricao: 'Caixa de revestimento cerâmico 30x60cm', categoria: 'Pisos e Revestimentos', preco: 75.00, custo: 55.00 },
    { nome: 'Impermeabilizante Acrílico 18L', descricao: 'Lata de impermeabilizante acrílico 18L', categoria: 'Impermeabilizantes', preco: 210.00, custo: 160.00 },
    { nome: 'Cimento Branco 20kg', descricao: 'Saco de cimento branco estrutural 20kg', categoria: 'Cimento', preco: 48.00, custo: 36.00 },
    { nome: 'Areia Lavada Grossa 20kg', descricao: 'Saco de areia grossa lavada 20kg', categoria: 'Areia', preco: 16.00, custo: 10.00 },
    { nome: 'Bloco de Vidro 19x19x8cm', descricao: 'Bloco de vidro translúcido', categoria: 'Blocos', preco: 18.00, custo: 12.00 },
    { nome: 'Serra Mármore 110mm', descricao: 'Serra mármore elétrica 110mm', categoria: 'Ferramentas', preco: 320.00, custo: 240.00 },
    { nome: 'Chave Philips 6"', descricao: 'Chave de fenda Philips 6 polegadas', categoria: 'Ferramentas', preco: 14.00, custo: 9.00 },
    { nome: 'Interruptor Simples', descricao: 'Interruptor simples de embutir', categoria: 'Elétrica', preco: 7.00, custo: 4.00 },
    { nome: 'Caixa d\'Água 500L', descricao: 'Caixa d\'água de polietileno 500 litros', categoria: 'Hidráulica', preco: 420.00, custo: 320.00 },
    { nome: 'Torneira Elétrica 220V', descricao: 'Torneira elétrica para cozinha 220V', categoria: 'Hidráulica', preco: 110.00, custo: 80.00 },
    { nome: 'Piso Porcelanato 60x60cm', descricao: 'Caixa de piso porcelanato 60x60cm', categoria: 'Pisos e Revestimentos', preco: 120.00, custo: 90.00 },
    { nome: 'Porta de Alumínio Basculante', descricao: 'Porta basculante de alumínio 210x70cm', categoria: 'Portas e Janelas', preco: 520.00, custo: 400.00 },
    { nome: 'Torneira de Esfera 1/2"', descricao: 'Torneira de esfera para água fria 1/2"', categoria: 'Hidráulica', preco: 19.00, custo: 13.00 },
    { nome: 'Lixa Massa 225', descricao: 'Lixa para massa 225mm', categoria: 'Ferramentas', preco: 2.50, custo: 1.50 },
    { nome: 'Broca para Concreto 8mm', descricao: 'Broca de aço para concreto 8mm', categoria: 'Ferramentas', preco: 7.00, custo: 4.00 },
    { nome: 'Cano PVC 100mm', descricao: 'Cano de PVC para esgoto 100mm', categoria: 'Tubos e Conexões', preco: 65.00, custo: 48.00 },
    { nome: 'Ralo Linear 50cm', descricao: 'Ralo linear de inox 50cm', categoria: 'Hidráulica', preco: 58.00, custo: 40.00 },
    { nome: 'Espátula de Aço 8cm', descricao: 'Espátula de aço para pintura 8cm', categoria: 'Ferramentas', preco: 6.00, custo: 3.50 },
    { nome: 'Balde Plástico 12L', descricao: 'Balde plástico reforçado 12 litros', categoria: 'Ferramentas', preco: 18.00, custo: 12.00 },
    { nome: 'Pá Quadrada', descricao: 'Pá quadrada para construção', categoria: 'Ferramentas', preco: 38.00, custo: 25.00 },
    { nome: 'Carrinho de Mão', descricao: 'Carrinho de mão reforçado', categoria: 'Ferramentas', preco: 210.00, custo: 160.00 },
    { nome: 'Escada Alumínio 6 Degraus', descricao: 'Escada de alumínio doméstica 6 degraus', categoria: 'Ferramentas', preco: 180.00, custo: 130.00 },
    { nome: 'Cabo Flexível 4mm', descricao: 'Rolo de cabo flexível 4mm 100m', categoria: 'Elétrica', preco: 320.00, custo: 240.00 },
    { nome: 'Tomada 2P+T 10A', descricao: 'Tomada 2 polos + terra 10A', categoria: 'Elétrica', preco: 8.00, custo: 5.00 },
    { nome: 'Caixa de Passagem 4x4', descricao: 'Caixa de passagem plástica 4x4', categoria: 'Elétrica', preco: 6.00, custo: 3.50 },
    { nome: 'Chave Inglesa 10"', descricao: 'Chave inglesa ajustável 10 polegadas', categoria: 'Ferramentas', preco: 32.00, custo: 22.00 },
    { nome: 'Disco de Corte 115mm', descricao: 'Disco de corte para ferro 115mm', categoria: 'Ferramentas', preco: 9.00, custo: 5.00 },
    { nome: 'Cimento Queimado 5kg', descricao: 'Saco de cimento queimado 5kg', categoria: 'Cimento', preco: 32.00, custo: 22.00 },
    { nome: 'Tinta Spray 400ml', descricao: 'Tinta spray multiuso 400ml', categoria: 'Tinta', preco: 18.00, custo: 12.00 },
    { nome: 'Massa Corrida 25kg', descricao: 'Saco de massa corrida 25kg', categoria: 'Argamassa', preco: 38.00, custo: 28.00 },
    { nome: 'Piso Vinílico 2mm', descricao: 'Caixa de piso vinílico 2mm', categoria: 'Pisos e Revestimentos', preco: 160.00, custo: 120.00 },
    { nome: 'Torneira para Lavatório', descricao: 'Torneira metálica para lavatório', categoria: 'Hidráulica', preco: 38.00, custo: 28.00 },
    { nome: 'Chave de Fenda 5"', descricao: 'Chave de fenda 5 polegadas', categoria: 'Ferramentas', preco: 8.00, custo: 5.00 },
    { nome: 'Bucha Plástica 8mm', descricao: 'Pacote com 100 buchas plásticas 8mm', categoria: 'Ferramentas', preco: 12.00, custo: 7.00 },
    { nome: 'Parafuso 6x50mm', descricao: 'Pacote com 100 parafusos 6x50mm', categoria: 'Ferramentas', preco: 18.00, custo: 12.00 },
    { nome: 'Luminária LED 18W', descricao: 'Luminária LED embutir 18W', categoria: 'Elétrica', preco: 38.00, custo: 28.00 },
    { nome: 'Fita Isolante 19mm', descricao: 'Rolo de fita isolante 19mm', categoria: 'Elétrica', preco: 4.00, custo: 2.00 },
    { nome: 'Caixa Sifonada 150mm', descricao: 'Caixa sifonada PVC 150mm', categoria: 'Hidráulica', preco: 22.00, custo: 15.00 },
    { nome: 'Régua de Alumínio 2m', descricao: 'Régua de alumínio para construção 2 metros', categoria: 'Ferramentas', preco: 48.00, custo: 34.00 },
    { nome: 'Espuma Expansiva 500ml', descricao: 'Espuma expansiva para vedação 500ml', categoria: 'Impermeabilizantes', preco: 32.00, custo: 22.00 },
    { nome: 'Piso Antiderrapante 40x40cm', descricao: 'Caixa de piso antiderrapante 40x40cm', categoria: 'Pisos e Revestimentos', preco: 85.00, custo: 60.00 },
    { nome: 'Janela Basculante 60x60cm', descricao: 'Janela basculante de alumínio 60x60cm', categoria: 'Portas e Janelas', preco: 180.00, custo: 130.00 },
    { nome: 'Torneira de Jardim Plástica', descricao: 'Torneira plástica para jardim', categoria: 'Hidráulica', preco: 8.00, custo: 4.00 },
    { nome: 'Piso Cerâmico Decorado 45x45cm', descricao: 'Caixa de piso cerâmico decorado 45x45cm', categoria: 'Pisos e Revestimentos', preco: 95.00, custo: 70.00 },
    { nome: 'Porta Sanfonada PVC', descricao: 'Porta sanfonada de PVC branca', categoria: 'Portas e Janelas', preco: 160.00, custo: 120.00 },
    { nome: 'Tinta Epóxi 3,6L', descricao: 'Lata de tinta epóxi branca 3,6L', categoria: 'Tinta', preco: 120.00, custo: 90.00 },
    { nome: 'Bloco Estrutural 14x19x39cm', descricao: 'Bloco estrutural de concreto 14x19x39cm', categoria: 'Blocos', preco: 5.20, custo: 3.80 },
    { nome: 'Areia Lavada Média 20kg', descricao: 'Saco de areia lavada média 20kg', categoria: 'Areia', preco: 14.50, custo: 9.50 },
    { nome: 'Tubo Corrugado 25mm', descricao: 'Tubo corrugado flexível 25mm', categoria: 'Elétrica', preco: 18.00, custo: 12.00 },
    { nome: 'Massa Acrílica 25kg', descricao: 'Saco de massa acrílica 25kg', categoria: 'Argamassa', preco: 42.00, custo: 30.00 },
    { nome: 'Tinta Verniz 3,6L', descricao: 'Lata de verniz para madeira 3,6L', categoria: 'Tinta', preco: 68.00, custo: 48.00 },
    { nome: 'Torneira Misturador', descricao: 'Torneira misturador para lavatório', categoria: 'Hidráulica', preco: 120.00, custo: 90.00 },
    { nome: 'Piso Laminado 7mm', descricao: 'Caixa de piso laminado 7mm', categoria: 'Pisos e Revestimentos', preco: 140.00, custo: 105.00 },
    { nome: 'Janela de Madeira 1,00x1,00m', descricao: 'Janela de madeira 1,00x1,00m', categoria: 'Portas e Janelas', preco: 220.00, custo: 160.00 },
    { nome: 'Bloco Canaleta 14x19x39cm', descricao: 'Bloco canaleta de concreto 14x19x39cm', categoria: 'Blocos', preco: 6.00, custo: 4.20 },
    { nome: 'Tinta Textura 25kg', descricao: 'Balde de tinta textura 25kg', categoria: 'Tinta', preco: 95.00, custo: 70.00 },
    { nome: 'Areia Usinada 20kg', descricao: 'Saco de areia usinada 20kg', categoria: 'Areia', preco: 13.00, custo: 8.00 },
    { nome: 'Tubo Soldável 20mm', descricao: 'Tubo soldável para água fria 20mm', categoria: 'Tubos e Conexões', preco: 9.00, custo: 5.00 },
    { nome: 'Chave Allen 5mm', descricao: 'Chave allen 5mm', categoria: 'Ferramentas', preco: 4.00, custo: 2.00 },
    { nome: 'Piso Cerâmico Bege 45x45cm', descricao: 'Caixa de piso cerâmico bege 45x45cm', categoria: 'Pisos e Revestimentos', preco: 68.00, custo: 50.00 },
    { nome: 'Porta Pivotante de Madeira', descricao: 'Porta pivotante de madeira 210x90cm', categoria: 'Portas e Janelas', preco: 680.00, custo: 520.00 },
    { nome: 'Tinta Acrílica Fosca 18L', descricao: 'Lata de tinta acrílica fosca 18L', categoria: 'Tinta', preco: 210.00, custo: 160.00 },
    { nome: 'Areia Grossa 20kg', descricao: 'Saco de areia grossa 20kg', categoria: 'Areia', preco: 15.00, custo: 9.00 },
    { nome: 'Bloco de Concreto Celular', descricao: 'Bloco de concreto celular 60x20x10cm', categoria: 'Blocos', preco: 12.00, custo: 8.00 },
    { nome: 'Torneira para Cozinha', descricao: 'Torneira metálica para cozinha', categoria: 'Hidráulica', preco: 38.00, custo: 28.00 },
    { nome: 'Piso Cerâmico Branco 30x30cm', descricao: 'Caixa de piso cerâmico branco 30x30cm', categoria: 'Pisos e Revestimentos', preco: 55.00, custo: 40.00 },
    { nome: 'Porta de Correr Alumínio', descricao: 'Porta de correr de alumínio 210x120cm', categoria: 'Portas e Janelas', preco: 520.00, custo: 400.00 }
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
        price: prod.preco,
        cost: prod.custo,
        supplierId: suppliers[Math.floor(Math.random() * suppliers.length)].id,
        categoryId: cat?.id,
      },
    });
    products.push(pr);
  }

  // Create Warehouses
  const warehouseNames = ["Loja São José", "Loja São Paulo", "Loja Jacareí"];
  const warehouses = [];
  for (let i = 0; i < warehouseNames.length; i++) {
    const wh = await prisma.warehouse.create({
      data: {
        name: warehouseNames[i],
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
  for (let i = 0; i < 50; i++) {
    const cu = await prisma.customer.create({
      data: {
        name: faker.person.fullName(),
        email: faker.internet.email(),
        phone: faker.phone.number(),
      },
    });
    customers.push(cu);
  }

  // Create Purchase Logs (580 entries)
  for (let i = 0; i < 2000; i++) {
    const date = randomDateWithinLast3Months();
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

  // Create Sale Logs (600 entries)
  for (let i = 0; i < 2000; i++) {
    const date = randomDateWithinLast3Months();
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

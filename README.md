# Sistema de Gerenciamento de Inventário e Vendas

Este projeto é um MVP (Produto Mínimo Viável) para gerenciamento de inventário, vendas, compras e fornecedores, utilizando Node.js, TypeScript e Prisma com SQLite.

## Tecnologias Utilizadas

- Node.js
- TypeScript
- Prisma ORM
- SQLite (para MVP)
- OpenAI API (para agentes inteligentes)

## Configuração do Ambiente

### Pré-requisitos

- Node.js (versão 18 ou superior)
- npm ou yarn

### Configuração do .env

Crie um arquivo `.env` na raiz do projeto com o seguinte conteúdo:

```
# URL do banco de dados
DATABASE_URL="file:./dev.db"

# Chave da API OpenAI (obrigatória para os agentes)
OPENAI_API_KEY="sua-chave-api-aqui"
```

## Instalação

1. Clone este repositório
2. Instale as dependências:
   ```
   npm install
   ```
3. Crie o banco de dados:
   ```
   npm run db:push
   ```
4. Populate o banco com dados iniciais (opcional):
   ```
   npm run db:seed
   ```

## Comandos Disponíveis

- `npm run dev`: Inicia o servidor de desenvolvimento
- `npm run db:push`: Aplica o schema ao banco de dados
- `npm run db:migrate`: Cria migrações e aplica ao banco de dados
- `npm run db:reset`: Reseta o banco de dados
- `npm run db:seed`: Popula o banco com dados iniciais
- `npm run prisma:studio`: Abre o Prisma Studio para visualizar/editar dados

## Estrutura do Banco de Dados

O sistema inclui os seguintes modelos:

- **Produtos**: Cadastro de produtos com preços, custos e SKUs
- **Fornecedores**: Gerenciamento de fornecedores
- **Clientes**: Cadastro de clientes
- **Vendedores**: Registro de vendedores
- **Vendas**: Registro de vendas com múltiplos itens
- **Compras**: Registro de compras de fornecedores
- **Inventário**: Controle de estoque em múltiplos armazéns
- **Categorias**: Categorização de produtos

## Estrutura do Projeto

```
.
├── prisma/                  # Configuração do Prisma e schema do banco
├── src/
│   ├── agents/              # Agentes inteligentes (OpenAI)
│   ├── database/
│   │   ├── repositories/    # Repositórios para acesso aos dados
│   │   ├── prisma.ts        # Cliente Prisma
│   │   └── seed.ts          # Script para popular o banco
├── .env                     # Variáveis de ambiente
├── .gitignore               # Arquivos ignorados pelo git
├── package.json             # Dependências e scripts
└── tsconfig.json            # Configuração do TypeScript
```

## Exemplo de Uso dos Repositórios

```typescript
import { productRepository } from './src/database/repositories';

// Listar todos os produtos
const products = await productRepository.findAll();

// Criar um novo produto
const newProduct = await productRepository.create({
  name: 'Novo Produto',
  price: 99.90,
  cost: 50.0,
  description: 'Descrição do produto'
});
```

## Contribuindo

1. Faça um fork do projeto
2. Crie uma branch para sua feature (`git checkout -b feature/nova-feature`)
3. Faça commit das suas mudanças (`git commit -m 'Adiciona nova feature'`)
4. Faça push para a branch (`git push origin feature/nova-feature`)
5. Abra um Pull Request

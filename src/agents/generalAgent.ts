/**
 * Concrete generalAgent implementation.
 */
/* eslint-disable camelcase */
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ChatCompletionMessageParam } from 'openai/resources';
import { z } from 'zod';
import { getPersonality } from './utils.js';

export class GeneralAgent {

    private openai: OpenAI;
    private model: string;
    private temperature: number;
    private config = {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4.1-2025-04-14',
        temperature: 0,
    };
    private schema = z.object({
        reasoning: z.string(),
        response: z.string(),
    });
    private responseFormat = zodResponseFormat(this.schema, 'GeneralAgentResponse');
    private prompt = '';

    private buildPrompt() {
        this.prompt = `
        # AGENTE DE RESPOSTA GERAL

        Você é um assistente de vendas de uma empresa de materiais de construção. Seu objetivo é responder perguntas simples como "Bom dia", "O que você pode fazer para mim?", etc.

        ${getPersonality()}

        # Regras
        - Deve responder de forma humanizada, com informações detalhadas e fáceis de entender.
        - Deve ser educado e simpático.

        # Informações Adicionais
        - Este agente de IA é capaz de responder perguntas estratégicas e operacionais sobre seu estoque e vendas, com base em análises preditivas e diagnósticas. Abaixo estão as principais capacidades, organizadas por categoria:

---

## 🔍 **Estoque Atual e Histórico**

**1. Quantidade em Estoque**
Veja quantas unidades estão disponíveis por produto e armazém.

**2. Valor em Dinheiro no Estoque**
Avalie quanto capital está imobilizado no estoque, com análises por categoria.

**3. Tempo de Vida no Estoque**
Identifique por quanto tempo os produtos ficam armazenados até serem vendidos.

**4. Faltas no Estoque**
Saiba quantas vezes produtos estiveram em falta e onde isso ocorreu.

---

## 📈 **Vendas e Projeções Futuras**

**5. Vendas por Dia**
Analise a média de vendas diárias por item, vendedor e categoria.

**6. Projeção de Vendas por Produto**
Descubra quais produtos tendem a vender mais na próxima semana.

**7. Venda Prevista Próxima de Zero**
Identifique produtos parados, sem expectativa de venda.

**8. Aceleração de Vendas**
Veja quais itens aumentaram o ritmo de venda nos últimos dias.

**9. Alta Demanda Recente**
Descubra produtos em crescimento contínuo, ideais para promoção.

---

## 📉 **Ruptura, Reposição e Giro**

**10. Projeção de Ruptura de Estoque**
Identifique produtos que correm risco de acabar nos próximos 7 dias.

**11. Estoque Projetado vs. Ponto de Reposição**
Veja quais produtos devem ser reabastecidos com base no consumo estimado.

**12. Giro Projetado vs. Estoque Atual**
Detecte produtos com saída muito rápida que exigem reposição urgente.

**13. Estoque Excessivo com Baixa Projeção de Venda**
Evite acúmulo de produtos com pouca perspectiva de giro.

---

## 💰 **Receita, Lucro e Custos**

**14. Receita por Produto**
Avalie quanto foi arrecadado em vendas por item e período.

**15. Receita Projetada por Produto**
Projeção da receita que cada produto pode gerar na próxima semana.

**16. Margem por Peça**
Veja a rentabilidade unitária dos produtos.

**17. Lucro Estimado para 7 Dias**
Identifique quais produtos trarão mais lucro na semana seguinte.

**18. Gasto com Compras**
Monitore o quanto foi investido em compras de mercadorias por período.

**19. Reabastecimento Necessário**
Calcule quanto precisa comprar para voltar ao nível ideal de estoque.

---

## 🤖 **O que o Agente pode responder por você**

* "Quais produtos vão acabar em breve?"
* "O que devo comprar esta semana?"
* "O que vai vender mais?"
* "Qual produto está parado no estoque?"
* "Quais itens posso promover para os vendedores?"
* "O que está vendendo mais rápido do que o previsto?"
* "Qual produto gerou mais receita ou lucro?"
* "Onde estou com excesso de estoque sem previsão de venda?"
* ... e muito mais!

---    
`;
    }
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.model = this.config.model;
        this.temperature = this.config.temperature;
    }

    public async process(messages: ChatCompletionMessageParam[]): Promise<{
        reasoning: string;
        response: string;
    }> {
        try {
            this.buildPrompt();
            const response = await this.openai.chat.completions.create({
                model: this.model,
                temperature: this.temperature,
                messages: [
                    {
                        role: 'developer',
                        content: this.prompt,
                    },
                    ...messages,
                ],
                response_format: this.responseFormat,
            });

            const content = response.choices[0]?.message.content;
            if (!content) {
                throw new Error('No response from model');
            }

            const json = JSON.parse(content);

            return json;
        } catch (error) {
            throw new Error(`Error in GeneralAgent: ${error}`);
        }
    }
}

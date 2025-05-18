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
         Você é o assistente virtual na Construction Co., parceira estratégica em materiais de construção.

Estou aqui para facilitar sua rotina como gerente, oferecendo acesso rápido e inteligente às informações mais importantes da empresa. Comigo, você pode:

📦 Acompanhar estoque e movimentações de mercadorias em tempo real

💰 Consultar dados financeiros, como faturamento, custos e lucros por período

🧑‍💼 Avaliar o desempenho de vendedores, metas e comissões

🛒 Analisar compras por fornecedor, histórico e previsões de reposição

📈 Gerar relatórios de vendas

🔍 Obter insights sobre produtos mais vendidos, sazonalidade e oportunidades de negócio

Sempre que precisar de um panorama rápido, um relatório detalhado ou suporte para tomar decisões, é só me chamar. Estou pronto para ajudar!
        
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

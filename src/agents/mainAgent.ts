/**
 * Concrete MainAgent implementation.
 */
/* eslint-disable camelcase */
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ChatCompletionMessageParam } from 'openai/resources';
import { z } from 'zod';

export class MainAgent {

    private openai: OpenAI;
    private model: string;
    private temperature: number;
    private config = {
        apiKey: process.env.OPENAI_API_KEY,
        model: 'gpt-4.1-2025-04-14',
        temperature: 0,
    };
    private schema = z.object({
        reasoning: z.string().describe('O raciocínio para a classificação da pergunta'),
        category: z.enum(['history', 'forecast', 'analysis', 'greetings']).describe('A categoria da pergunta'),
    });
    private responseFormat = zodResponseFormat(this.schema, 'MainAgentResponse');
    private prompt = '';

    private buildPrompt() {
        this.prompt = `
        # AGENTE PRINCIPAL
        Você é um assistente do gerente da empresa de construção Construction Co. Sua tarefa é classificar perguntas feitas pelo gerente em uma das três categorias abaixo, de acordo com o tipo de resposta necessária. Essa classificação será usada para acionar agentes especializados, que consultarão bancos de dados e/ou executarão modelos de previsão.

As categorias são:

"history" - Perguntas sobre produtos, vendas, estoque, etc, resumo de produtos, vendas, Graficos de vendas passadas, produtos mais vendidos, etc.

"forecast" - Perguntas relacionadas a projeções, previsões ou estimativas para o futuro.

"analysis" - Perguntas que exigem uma análise completa, abrangendo passado, presente e futuro, podendo incluir gráficos, relatórios ou comparações.

"greetings" - Coisas como "Ola", "Como você está?", "O que você faz?", e etc.

Instruções adicionais:

Se a pergunta não se encaixar claramente em nenhuma das categorias acima, responda educadamente que não é possível classificá-la.

Se a pergunta não estiver relacionada à empresa ou ao contexto de construção, responda educadamente que só pode tratar de questões relacionadas à Construction Co.

Formato de resposta: RESPONDA APENAS NESSE FORMATO CASO HAJA CATEGORIA ENCONTRADA
{Categoria: history | forecast | analysis | greetings}
        `;
    }
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        this.model = this.config.model;
        this.temperature = this.config.temperature;
    }

    public async process(messages: ChatCompletionMessageParam[]): Promise<{
        reasoning: string;
        category: string;
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
            throw new Error(`Error in SampleAgent: ${error}`);
        }
    }
}

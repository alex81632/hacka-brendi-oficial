/**
 * Concrete SampleAgent implementation.
 */
/* eslint-disable camelcase */
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ChatCompletionMessageParam } from 'openai/resources';
import { z } from 'zod';

export class SampleAgent {

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
    private responseFormat = zodResponseFormat(this.schema, 'SampleAgentResponse');
    private prompt = '';

    private buildPrompt() {
        this.prompt = `
        # AGENTE DE EXEMPLO
        `;
    }
    constructor() {
        this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY___RESUME_CONVERSATIONS });
        this.model = this.config.model;
        this.temperature = this.config.temperature;
    }

    public async process(messages: ChatCompletionMessageParam[]): Promise<{
        reasoning: string;
        isQuestion: boolean;
        question: string;
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

import { ChatCompletionMessageParam } from "openai/resources";
import { MainAgent } from "../agents/mainAgent.js";
import { HistoryAgent } from "../agents/historyAgent.js";

export const mainHandle = async (messages: ChatCompletionMessageParam[]): Promise<{
    reasoning: string;
    response: string;
}> => {
    const agent = new MainAgent();
    const { reasoning, category } = await agent.process(messages);

    const historyAgent = new HistoryAgent();
    const forecastAgent = {
        process: async (messages: ChatCompletionMessageParam[]) => {
            return {
                reasoning: "Resposta da categoria forecast",
                response: "Resposta da categoria forecast"
            };
        }
    };
    const analysisAgent = {
        process: async (messages: ChatCompletionMessageParam[]) => {
            return {
                reasoning: "Resposta da categoria analysis",
                response: "Resposta da categoria analysis"
            };
        }
    };
    const generalAgent = {
        process: async (messages: ChatCompletionMessageParam[]) => {
            return {
                reasoning: "Resposta da categoria general",
                response: `
Olá, sou seu assistente virtual na Construction Co., sua parceira estratégica em materiais de construção.

Estou aqui para facilitar sua rotina como gerente, oferecendo acesso rápido e inteligente às informações mais importantes da empresa. Comigo, você pode:

📦 Acompanhar estoque e movimentações de mercadorias em tempo real

💰 Consultar dados financeiros, como faturamento, custos e lucros por loja ou período

🧑‍💼 Avaliar o desempenho de vendedores, metas e comissões

🛒 Analisar compras por fornecedor, histórico e previsões de reposição

📈 Gerar relatórios de vendas, comparativos entre lojas e tendências

🔍 Obter insights sobre produtos mais vendidos, sazonalidade e oportunidades de negócio

Sempre que precisar de um panorama rápido, um relatório detalhado ou suporte para tomar decisões, é só me chamar. Estou pronto para ajudar!`
            };
        }
    };

    let agentResponse;

    switch (category) {
        case "history":
            agentResponse = await historyAgent.process(messages);
            break;
        case "forecast":
            agentResponse = await forecastAgent.process(messages);
            break;
        case "analysis":
            agentResponse = await analysisAgent.process(messages);
            break;
        case "general":
            agentResponse = await generalAgent.process(messages);
            break;
        default:
            agentResponse = {
                reasoning: "Não foi possível classificar a pergunta",
                response: "Não foi possível classificar a pergunta"
            };
            break;
    }

    return agentResponse || {
        reasoning: "Ocorreu um erro ao processar a resposta",
        response: "Desculpe, ocorreu um erro ao processar sua pergunta"
    };
}

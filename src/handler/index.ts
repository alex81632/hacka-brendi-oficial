import { ChatCompletionMessageParam } from "openai/resources";
import { MainAgent } from "../agents/mainAgent.js";
import { HistoryAgent } from "../agents/historyAgent.js";

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
            response: "Resposta da categoria general"
        };
    }
};

export const mainHandle = async (messages: ChatCompletionMessageParam[]): Promise<{
    reasoning: string;
    response: string;
}> => {
    const agent = new MainAgent();
    const { reasoning, category } = await agent.process(messages);

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

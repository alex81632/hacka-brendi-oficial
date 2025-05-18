import { ChatCompletionMessageParam } from "openai/resources";
import { MainAgent } from "../agents/mainAgent.js";
import { HistoryAgent } from "../agents/historyAgent.js";
import { GeneralAgent } from "../agents/generalAgent.js";
import { Context } from "telegraf";
import { ForecastAgent } from "../agents/forecastAgent.js";

export const mainHandle = async (
    messages: ChatCompletionMessageParam[],
    telegramContext?: Context,
    chatId?: number
): Promise<{
    reasoning: string;
    response: string;
}> => {
    const agent = new MainAgent();
    const { reasoning, category } = await agent.process(messages);

    const historyAgent = new HistoryAgent();
    const forecastAgent = new ForecastAgent();
    if (telegramContext && chatId) {
        historyAgent.setTelegramContext(telegramContext, chatId);
        forecastAgent.setTelegramContext(telegramContext, chatId);
    }
    const generalAgent = new GeneralAgent();

    let agentResponse;

    switch (category) {
        case "history":
            agentResponse = await historyAgent.process(messages);
            break;
        case "forecast":
            agentResponse = await forecastAgent.process(messages);
            break;
        case "greetings":
            agentResponse = await generalAgent.process(messages);
            break;
        default:
            agentResponse = {
                reasoning: "Não foi possível classificar a pergunta",
                response: "Não foi possível classificar a pergunta"
            };
            break;
    }

    console.log(`[DEBUG] main -> ${category}`);

    return agentResponse || {
        reasoning: "Ocorreu um erro ao processar a resposta",
        response: "Desculpe, ocorreu um erro ao processar sua pergunta"
    };
}

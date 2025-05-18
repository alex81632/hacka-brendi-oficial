import { config } from "dotenv";
import { Context, Telegraf } from "telegraf";
import { message } from "telegraf/filters";
import { ChatCompletionMessageParam } from "openai/resources";
import { mainHandle } from "./handler/index.js";
import { TranscribeAudio } from "./agents/transcriberAgent.js";
import { convertMarkdownToWhatsAppFormat } from "./agents/utils.js";

async function connectToTelegram() {
  const telegraf = new Telegraf<Context>(process.env.TELEGRAM_TOKEN!);
  telegraf.launch();

  const { username } = await telegraf.telegram.getMe();
  console.log(`Start chatting here: https://t.me/${username}`);

  process.once("SIGINT", () => telegraf.stop("SIGINT"));
  process.once("SIGTERM", () => telegraf.stop("SIGTERM"));

  return telegraf;
}

async function run() {
  config();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key is required");
  }

  let messages: ChatCompletionMessageParam[] = [];

  const telegram = await connectToTelegram();

  telegram.on(message("text"), async (ctx) => {
    const telegramChatId = ctx.message.chat.id;
    await ctx.telegram.sendChatAction(telegramChatId, "typing");

    const content = ctx.message.text;
    messages.push({ role: "user", content });

    messages = messages.slice(-50);

    const { reasoning, response } = await mainHandle(messages, ctx, telegramChatId);

    const formattedResponse = convertMarkdownToWhatsAppFormat(response);

    if (!response) {
      return;
    }

    messages.push({ role: "assistant", content: formattedResponse });
    // await telegram.telegram.sendMessage(Number(telegramChatId), reasoning);
    await telegram.telegram.sendMessage(Number(telegramChatId), formattedResponse);
  });

  telegram.on(message("voice"), async (ctx) => {
    const telegramChatId = ctx.message.chat.id;
    await ctx.telegram.sendChatAction(telegramChatId, "typing");

    const voice = ctx.message.voice;
    const voiceUrl = await ctx.telegram.getFileLink(voice.file_id);
    
    const transcriber = new TranscribeAudio();
    const transcription = await transcriber.process(voiceUrl.href);

    messages.push({ role: "user", content: transcription });

    messages = messages.slice(-50);

    const { reasoning, response } = await mainHandle(messages, ctx, telegramChatId);

    if (!response) {
      return;
    }

    messages.push({ role: "assistant", content: response });

    await telegram.telegram.sendMessage(Number(telegramChatId), response);
  });
}

run();

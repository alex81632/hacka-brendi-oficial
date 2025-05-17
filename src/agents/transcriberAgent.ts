
/**
 * Concrete TranscribeAudio implementation.
 */
import Groq from 'groq-sdk';

export class TranscribeAudio {

    private groq: Groq;
    private model: string;
    private temperature: number;
    private config = {
        apiKey: process.env.GROQ_API_KEY,
        model: 'whisper-large-v3-turbo',
        temperature: 0,
    };

    constructor() {
        this.groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
        this.model = this.config.model;
        this.temperature = this.config.temperature;
    }

    public async process(link: string): Promise<string> {
        try {
            // Create a transcription job
            const transcription = await this.groq.audio.transcriptions.create({
                url: link,
                model: this.model, // Required model to use for transcription
                temperature: this.temperature, // Optional
            });

            const content = transcription.text;
            if (!content) {
                throw new Error('No response from model');
            }

            return content;
        } catch (error) {
            throw new Error(`Error in GreetingsAgent: ${error}`);
        }
    }
}

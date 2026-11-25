import { GoogleGenAI } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please add your API key in the Settings > Secrets panel.'
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

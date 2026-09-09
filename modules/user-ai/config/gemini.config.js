import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_KEY || process.env.GEMINI_API_KEY;

if (!apiKey) {
  console.warn(
    "[User AI] Warning: Neither GEMINI_KEY nor GEMINI_API_KEY is defined in environment variables."
  );
}

export const ai = new GoogleGenAI({
  apiKey: apiKey || "",
});

// gemini-3.5-flash-lite has ultra-low latency (~1s TTFT), ideal for streaming chat
export const MODEL_GENERATION = "gemini-3.5-flash-lite";
export const MODEL_EMBEDDING = "gemini-embedding-001";
export const FALLBACK_GENERATION_MODELS = ["gemini-3.6-flash", "gemini-3.5-flash"];

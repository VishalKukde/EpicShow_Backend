import { ai, MODEL_EMBEDDING } from "../config/gemini.config.js";

// In-memory cache for query embeddings to avoid duplicate API calls
const embeddingCache = new Map();

/**
 * Generate a vector embedding for a single string
 * @param {string} text
 * @returns {Promise<number[]|null>}
 */
export async function embedText(text) {
  if (!text || typeof text !== "string") return null;

  const normalized = text.trim();
  if (!normalized) return null;

  // Check cache
  if (embeddingCache.has(normalized)) {
    return embeddingCache.get(normalized);
  }

  try {
    const res = await ai.models.embedContent({
      model: MODEL_EMBEDDING,
      contents: normalized,
    });

    const values = res.embeddings?.[0]?.values;
    if (Array.isArray(values) && values.length > 0) {
      embeddingCache.set(normalized, values);
      return values;
    }

    return null;
  } catch (error) {
    console.error(`[User AI Embedding] Error embedding text: "${normalized.slice(0, 40)}..."`, error.message);
    return null;
  }
}

/**
 * Generate embeddings for an array of texts with slight delay to prevent rate limits
 * @param {string[]} texts
 * @returns {Promise<Array<number[]|null>>}
 */
export async function embedBatch(texts, delayMs = 150) {
  const results = [];
  for (const text of texts) {
    const vector = await embedText(text);
    results.push(vector);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  return results;
}

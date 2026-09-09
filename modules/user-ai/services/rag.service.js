import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { embedText } from "./embedding.service.js";
import { vectorStore } from "./vectorStore.service.js";
import { loadAllMarkdownChunks } from "./markdownLoader.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const KNOWLEDGE_DIR = path.resolve(__dirname, "../knowledge");
const CACHE_PATH = path.resolve(__dirname, "../data/embeddings-cache.json");

let isInitialized = false;

/**
 * Serialize embeddings cache to clean JSON with single-line vector arrays for fast IDE loading
 * @param {Record<string, any>} cacheMap
 * @returns {string}
 */
function serializeEmbeddingsCache(cacheMap) {
  const keys = Object.keys(cacheMap);
  const lines = ["{"];
  keys.forEach((key, idx) => {
    const entry = cacheMap[key];
    const isLast = idx === keys.length - 1;
    lines.push(`  ${JSON.stringify(key)}: {`);
    lines.push(`    "hash": ${JSON.stringify(entry.hash)},`);
    lines.push(`    "file": ${JSON.stringify(entry.file)},`);
    lines.push(`    "title": ${JSON.stringify(entry.title)},`);
    lines.push(`    "vector": ${JSON.stringify(entry.vector)},`);
    lines.push(`    "updatedAt": ${JSON.stringify(entry.updatedAt)}`);
    lines.push(`  }${isLast ? "" : ","}`);
  });
  lines.push("}\n");
  return lines.join("\n");
}

/**
 * Initialize knowledge base from structured Markdown files and populate vector store
 * Uses SHA-256 content hashes to only generate embeddings for new/modified chunks
 */
export async function initializeKnowledgeBase() {
  if (isInitialized) return;

  try {
    if (!fs.existsSync(KNOWLEDGE_DIR)) {
      console.warn("[User AI RAG] Knowledge directory not found at:", KNOWLEDGE_DIR);
      return;
    }

    // 1. Scan and parse all Markdown files dynamically
    const chunks = loadAllMarkdownChunks(KNOWLEDGE_DIR);
    if (chunks.length === 0) {
      console.warn("[User AI RAG] No markdown chunks parsed from:", KNOWLEDGE_DIR);
      return;
    }

    // 2. Load existing embedding cache
    let cacheMap = {};
    if (fs.existsSync(CACHE_PATH)) {
      try {
        const rawCache = fs.readFileSync(CACHE_PATH, "utf-8");
        cacheMap = JSON.parse(rawCache);
      } catch (err) {
        console.warn("[User AI RAG] Failed to parse embeddings cache, will regenerate...", err.message);
        cacheMap = {};
      }
    }

    const docsWithVectors = [];
    let cachedCount = 0;
    let generatedCount = 0;
    let cacheUpdated = false;

    // 3. Process each chunk incrementally
    for (const chunk of chunks) {
      const cachedEntry = cacheMap[chunk.id];
      let vector = null;

      // Check if cache has matching SHA-256 content hash
      if (
        cachedEntry &&
        typeof cachedEntry === "object" &&
        cachedEntry.hash === chunk.hash &&
        Array.isArray(cachedEntry.vector) &&
        cachedEntry.vector.length > 0
      ) {
        // Content unchanged: reuse cached vector
        vector = cachedEntry.vector;
        cachedCount++;
      } else {
        // New or modified content: generate embedding via Gemini API
        const textToEmbed = `${chunk.title}: ${chunk.content} (Category: ${chunk.category}, File: ${chunk.file}, Keywords: ${(chunk.keywords || []).join(", ")})`;
        vector = await embedText(textToEmbed);

        if (vector) {
          cacheMap[chunk.id] = {
            hash: chunk.hash,
            file: chunk.file,
            title: chunk.title,
            vector,
            updatedAt: new Date().toISOString(),
          };
          generatedCount++;
          cacheUpdated = true;

          // Gentle throttle to avoid burst rate limits
          await new Promise((r) => setTimeout(r, 80));
        }
      }

      if (vector) {
        docsWithVectors.push({
          ...chunk,
          vector,
        });
      }
    }

    // 4. Prune obsolete chunks from cache that no longer exist in markdown files
    const currentChunkIds = new Set(chunks.map((c) => c.id));
    for (const cachedId of Object.keys(cacheMap)) {
      if (!currentChunkIds.has(cachedId)) {
        delete cacheMap[cachedId];
        cacheUpdated = true;
      }
    }

    // 5. Persist updated cache if modified
    if (cacheUpdated) {
      try {
        // Ensure parent directory exists
        const cacheDir = path.dirname(CACHE_PATH);
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }

        fs.writeFileSync(CACHE_PATH, serializeEmbeddingsCache(cacheMap), "utf-8");
        console.log(
          `[User AI RAG] Embeddings cache persisted: ${generatedCount} generated, ${cachedCount} reused, total cached: ${Object.keys(cacheMap).length}.`
        );
      } catch (writeErr) {
        console.warn("[User AI RAG] Could not write cache file:", writeErr.message);
      }
    } else {
      console.log(`[User AI RAG] Embeddings cache intact. All ${cachedCount} chunks verified via content hash.`);
    }

    // 6. Index into vector store
    vectorStore.setDocuments(docsWithVectors);
    isInitialized = true;
    console.log(
      `[User AI RAG] Vector store ready with ${docsWithVectors.length} knowledge chunks (${cachedCount} cached, ${generatedCount} generated).`
    );
  } catch (error) {
    console.error("[User AI RAG] Error initializing knowledge base:", error.message);
  }
}

/**
 * Retrieve top relevant knowledge snippets for a query
 * Uses hybrid semantic vector search with fast fallback to ensure low latency
 * @param {string} query
 * @param {number} topK
 * @returns {Promise<Array<{ id: string, title: string, category: string, content: string, score: number }>>}
 */
export async function retrieveKnowledge(query, topK = 4) {
  if (!query || typeof query !== "string") return [];

  // Ensure knowledge base is initialized
  if (!isInitialized) {
    await initializeKnowledgeBase();
  }

  // Fast keyword hits as baseline
  const keywordHits = vectorStore.keywordSearch(query, topK);
  let results = keywordHits.map((kh) => ({ ...kh.document, score: kh.score }));

  // Attempt semantic vector search with a 1500ms timeout
  try {
    const embedPromise = embedText(query);
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 1500));
    const queryVector = await Promise.race([embedPromise, timeoutPromise]);

    if (queryVector) {
      const hits = vectorStore.search(queryVector, topK, 0.22);
      if (hits.length > 0) {
        results = hits.map((h) => ({
          ...h.document,
          score: h.score,
        }));
      }
    }
  } catch (err) {
    console.warn("[User AI RAG] Vector search timed out or failed:", err.message);
  }

  return results;
}

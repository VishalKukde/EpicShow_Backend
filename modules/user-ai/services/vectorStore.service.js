/**
 * Compute cosine similarity between two numeric vectors
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class InMemoryVectorStore {
  constructor() {
    this.documents = []; // Array of { id, title, category, content, keywords, vector }
  }

  /**
   * Set indexed documents
   * @param {Array<{ id: string, title: string, category: string, content: string, keywords: string[], vector: number[] }>} docs
   */
  setDocuments(docs) {
    this.documents = docs.filter((d) => Array.isArray(d.vector) && d.vector.length > 0);
  }

  /**
   * Add a single document
   */
  addDocument(doc) {
    if (doc && Array.isArray(doc.vector)) {
      this.documents.push(doc);
    }
  }

  /**
   * Semantic vector search using cosine similarity
   * @param {number[]} queryVector
   * @param {number} topK
   * @param {number} minScore
   * @returns {Array<{ document: object, score: number }>}
   */
  search(queryVector, topK = 4, minScore = 0.25) {
    if (!queryVector || this.documents.length === 0) return [];

    const scored = this.documents.map((doc) => ({
      document: {
        id: doc.id,
        file: doc.file,
        category: doc.category,
        title: doc.title,
        content: doc.content,
      },
      score: cosineSimilarity(queryVector, doc.vector),
    }));

    return scored
      .filter((item) => item.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /**
   * Keyword fallback search if embedding is temporarily unavailable
   * @param {string} query
   * @param {number} topK
   */
  keywordSearch(query, topK = 3) {
    if (!query || typeof query !== "string") return [];
    const tokens = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
    if (tokens.length === 0) return [];

    const scored = this.documents.map((doc) => {
      let matchCount = 0;
      const combined = `${doc.title} ${doc.content} ${(doc.keywords || []).join(" ")}`.toLowerCase();

      for (const token of tokens) {
        if (combined.includes(token)) {
          matchCount++;
        }
      }

      return {
        document: {
          id: doc.id,
          file: doc.file,
          category: doc.category,
          title: doc.title,
          content: doc.content,
        },
        score: matchCount / tokens.length,
      };
    });

    return scored
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}

export const vectorStore = new InMemoryVectorStore();

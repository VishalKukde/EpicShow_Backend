import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Generate a clean URL/ID friendly slug
 * @param {string} text
 * @returns {string}
 */
export function slugify(text = "") {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Compute SHA-256 hash of a string
 * @param {string} text
 * @returns {string}
 */
export function computeHash(text = "") {
  return crypto.createHash("sha256").update(text.trim(), "utf-8").digest("hex");
}

/**
 * Extract meaningful keywords from chunk text for fast hybrid matching
 * @param {string} text
 * @returns {string[]}
 */
export function extractKeywords(text = "") {
  const words = text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3);

  // Frequency-based unique keywords (top 15)
  const freq = {};
  for (const w of words) {
    freq[w] = (freq[w] || 0) + 1;
  }

  return Object.keys(freq)
    .sort((a, b) => freq[b] - freq[a])
    .slice(0, 15);
}

/**
 * Parse and chunk a single markdown file into logical sections
 * @param {string} filePath
 * @param {string} [customCategory]
 * @returns {Array<{ id: string, file: string, category: string, title: string, content: string, hash: string, keywords: string[] }>}
 */
export function parseMarkdownFile(filePath, customCategory = null) {
  if (!fs.existsSync(filePath)) return [];

  const rawContent = fs.readFileSync(filePath, "utf-8");
  const fileBasename = path.basename(filePath);
  const fileCategory = customCategory || path.basename(filePath, path.extname(filePath));

  // Determine top-level document title if present
  const docTitleMatch = rawContent.match(/^#\s+([^\n]+)/m);
  const docTitle = docTitleMatch ? docTitleMatch[1].trim() : fileCategory;

  // Split content by headings: ## or ###
  // Matches section headers like "## Section Title"
  const sectionSplitter = /(?:^|\n)(#{2,3}\s+[^\n]+)/;
  const parts = rawContent.split(sectionSplitter);

  const chunks = [];
  let currentHeading = docTitle;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;

    const headingMatch = part.match(/^#{2,3}\s+([^\n]+)$/);
    if (headingMatch) {
      currentHeading = headingMatch[1].trim();
      continue;
    }

    // This is the section body
    const sectionBody = part;
    if (sectionBody.length < 20) continue; // Skip trivial fragments

    const chunkTitle = currentHeading === docTitle ? `${docTitle} Overview` : `${docTitle} - ${currentHeading}`;
    const chunkSlug = slugify(currentHeading);
    const chunkId = `${fileCategory}_${chunkSlug || "section"}_${chunks.length + 1}`;

    const textForHashing = `${chunkTitle}\n${sectionBody}`;
    const hash = computeHash(textForHashing);
    const keywords = extractKeywords(`${chunkTitle} ${sectionBody}`);

    chunks.push({
      id: chunkId,
      file: fileBasename,
      category: fileCategory,
      title: chunkTitle,
      content: sectionBody,
      hash,
      keywords,
    });
  }

  // Fallback: If no sub-headings were parsed, create a single chunk for the whole document
  if (chunks.length === 0 && rawContent.trim().length > 30) {
    const textForHashing = `${docTitle}\n${rawContent.trim()}`;
    chunks.push({
      id: `${fileCategory}_overview`,
      file: fileBasename,
      category: fileCategory,
      title: docTitle,
      content: rawContent.trim(),
      hash: computeHash(textForHashing),
      keywords: extractKeywords(rawContent),
    });
  }

  return chunks;
}

/**
 * Automatically scan directory for all .md files and load/chunk them
 * Newly added .md files are included dynamically without code changes
 * @param {string} knowledgeDir
 * @returns {Array<{ id: string, file: string, category: string, title: string, content: string, hash: string, keywords: string[] }>}
 */
export function loadAllMarkdownChunks(knowledgeDir) {
  if (!fs.existsSync(knowledgeDir)) {
    console.warn("[User AI Markdown] Knowledge directory does not exist:", knowledgeDir);
    return [];
  }

  const entries = fs.readdirSync(knowledgeDir, { withFileTypes: true });
  const mdFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"))
    .map((entry) => entry.name)
    .sort();

  const allChunks = [];
  for (const fileName of mdFiles) {
    const fullPath = path.join(knowledgeDir, fileName);
    const fileChunks = parseMarkdownFile(fullPath);
    allChunks.push(...fileChunks);
  }

  console.log(
    `[User AI Markdown] Scanned ${mdFiles.length} markdown file(s) from "${path.basename(
      knowledgeDir
    )}". Generated ${allChunks.length} chunks.`
  );

  return allChunks;
}

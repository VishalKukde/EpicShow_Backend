import { ai, MODEL_GENERATION, FALLBACK_GENERATION_MODELS } from "../config/gemini.config.js";
import { retrieveKnowledge } from "./rag.service.js";
import {
  getUserBookings,
  getUserRefundStatus,
  getUserCoupons,
  getUpcomingCatalog,
  getUserProfileAndWallet,
} from "./mongoTools.service.js";
import { buildUserAiSystemPrompt } from "../prompts/userAi.prompt.js";

/**
 * Detect what dynamic tools may be relevant based on text intent and history
 * @param {string} text
 * @param {Array<{ role: string, text: string }>} history
 * @returns {object}
 */
function analyzeIntent(text = "", history = []) {
  const lower = text.toLowerCase().trim();

  // Category mentions (supporting common typos and synonyms)
  const mentionsMovie = /\b(movie|movies|cinema|film|films|theater|theatre|movei|movi|moview|filim)\b/i.test(lower);
  const mentionsTrain = /\b(train|trains|railway|irctc|pnr|berth|coach)\b/i.test(lower);
  const mentionsSports = /\b(sport|sports|cricket|football|match|stadium)\b/i.test(lower);
  const mentionsGaming = /\b(gaming|game|games|vr|console|arcade)\b/i.test(lower);

  // Check if the last assistant message asked the user to choose a booking category
  const lastAssistantMsg = [...history].reverse().find((h) => h.role === "assistant")?.text?.toLowerCase() || "";
  const previousTurnAskedCategory =
    lastAssistantMsg.includes("which type of booking") ||
    lastAssistantMsg.includes("which category") ||
    (lastAssistantMsg.includes("movies") && lastAssistantMsg.includes("sports") && lastAssistantMsg.includes("trains"));

  const isCategoryFollowUp =
    previousTurnAskedCategory && (mentionsMovie || mentionsTrain || mentionsSports || mentionsGaming);

  const isGeneralBookingQuery =
    /\b(my booking|my ticket|last booking|latest booking|previous booking|show my ticket|booked ticket|booking details|my reservation)\b/.test(
      lower
    );

  let selectedCategory = null;
  if (mentionsMovie) selectedCategory = "movie";
  else if (mentionsTrain) selectedCategory = "train";
  else if (mentionsSports) selectedCategory = "sports";
  else if (mentionsGaming) selectedCategory = "gaming";

  let needsBookings = false;
  let needsCategoryDisambiguation = false;

  if (isCategoryFollowUp) {
    needsBookings = true;
  } else if (isGeneralBookingQuery) {
    if (selectedCategory) {
      needsBookings = true;
    } else {
      // User asked for "last booking details" without specifying which category!
      needsCategoryDisambiguation = true;
    }
  }

  const needsRefunds =
    /\b(my refund|refund status|where is my refund|refund details|money back)\b/.test(
      lower
    );

  const needsCoupons =
    /\b(my coupon|my offer|my discount|promo code for me|available coupons|my vouchers)\b/.test(
      lower
    );

  const isBookingAttempt =
    /\b(book|booking|reserve|reservation|buy|purchase|lock)\b.*\b(ticket|tickets|seat|seats|show|shows|pass|passes|berth|berths)\b/i.test(
      lower
    ) ||
    /\b(book now|book for me|can you book|book this|book a ticket|book tickets|i want to book|i wanna book|help me book|please book)\b/i.test(
      lower
    );

  const isGreeting =
    /^(hi|hello|hey|greetings|good\s+(morning|afternoon|evening)|howdy|sup)\b/i.test(lower) &&
    lower.split(/\s+/).length <= 4;

  const needsWallet =
    /\b(wallet|balance|my balance|wallet balance|my money|funds|cash balance|reward points|rewards|how much money|check balance)\b/i.test(
      lower
    );

  const needsProfile =
    /\b(my profile|my account|my details|user details|account details|who am i|phone number|membership status)\b/i.test(
      lower
    );

  const wantsBestOrTop =
    /\b(best|top|highest rated|highest rating|greatest|finest|hit|favorite|recommend|recommended|suggestion|suggest)\b/i.test(
      lower
    );

  const needsCatalog =
    mentionsMovie ||
    /\b(upcoming|showing|now showing|releases|what movies|popular movies|playing movies|latest movies|what to watch|watch|stream|theatre|theater)\b/i.test(
      lower
    ) ||
    isBookingAttempt;

  return {
    isGreeting,
    needsBookings,
    needsCategoryDisambiguation,
    selectedCategory,
    needsRefunds,
    needsCoupons,
    needsWallet,
    needsProfile,
    needsCatalog,
    wantsBestOrTop,
    isBookingAttempt,
  };
}

/**
 * Handle streaming chat orchestration
 * @param {object} params
 * @param {string} params.message
 * @param {Array<{ role: string, text: string }>} params.history
 * @param {object|null} params.user
 * @param {(chunk: string) => void} params.onChunk
 * @param {() => void} params.onDone
 * @param {(error: Error) => void} params.onError
 */
export async function streamChatResponse({
  message,
  history = [],
  user = null,
  onChunk,
  onDone,
  onError,
}) {
  try {
    const userId = user?._id || user?.id || null;
    const userName = user?.name || null;
    const isAuthenticated = Boolean(userId);

    const intent = analyzeIntent(message, history);
    const dynamicUserData = {};

    // 1. Fetch dynamic data securely if requested
    if (intent.needsBookings) {
      if (isAuthenticated) {
        // Query specific category (or last 1 if specific, last 3 if all)
        const limit = intent.selectedCategory ? 1 : 3;
        dynamicUserData.user_bookings = await getUserBookings(userId, intent.selectedCategory, limit);
      } else {
        dynamicUserData.user_bookings = {
          authenticated: false,
          note: "User is not logged in. Tell the user to log in to view their bookings.",
        };
      }
    }

    if (intent.needsRefunds) {
      if (isAuthenticated) {
        dynamicUserData.user_refunds = await getUserRefundStatus(userId);
      } else {
        dynamicUserData.user_refunds = {
          authenticated: false,
          note: "User is not logged in. Tell the user to log in to view their refund status.",
        };
      }
    }

    if (intent.needsCoupons) {
      if (isAuthenticated) {
        dynamicUserData.user_coupons = await getUserCoupons(userId);
      } else {
        dynamicUserData.user_coupons = {
          authenticated: false,
          note: "User is not logged in. Tell the user to log in to view their personal coupons.",
        };
      }
    }

    if (intent.needsWallet || intent.needsProfile) {
      if (isAuthenticated) {
        dynamicUserData.user_wallet_and_profile = await getUserProfileAndWallet(userId);
      } else {
        dynamicUserData.user_wallet_and_profile = {
          authenticated: false,
          note: "User is not logged in. Tell the user to log in to their EpicShow account to view their wallet balance and profile details.",
        };
      }
    }

    if (intent.needsCatalog) {
      const sortBy = intent.wantsBestOrTop ? "rating" : "latest";
      dynamicUserData.currently_playing_movies = await getUpcomingCatalog("movies", 3, sortBy);
    }

    // 2. Perform RAG semantic retrieval
    const knowledgeChunks = await retrieveKnowledge(message, 5);

    // 3. Build system prompt
    const systemInstruction = buildUserAiSystemPrompt({
      userName,
      isAuthenticated,
      isGreeting: intent.isGreeting,
      knowledgeChunks,
      dynamicUserData: Object.keys(dynamicUserData).length > 0 ? dynamicUserData : null,
      categoryDisambiguation: intent.needsCategoryDisambiguation,
      isBookingAttempt: intent.isBookingAttempt,
    });

    // 4. Format conversation history
    const contents = [];

    // Include recent history (last 6 turns)
    const recentHistory = Array.isArray(history) ? history.slice(-6) : [];
    for (const h of recentHistory) {
      if (h.text && typeof h.text === "string") {
        contents.push({
          role: h.role === "assistant" ? "model" : "user",
          parts: [{ text: h.text }],
        });
      }
    }

    // Append current user message
    contents.push({
      role: "user",
      parts: [{ text: message }],
    });

    // 5. Generate stream with primary model and fallbacks
    const modelsToTry = [MODEL_GENERATION, ...FALLBACK_GENERATION_MODELS];
    let streamSuccess = false;
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        const stream = await ai.models.generateContentStream({
          model: modelName,
          contents,
          config: {
            systemInstruction,
            temperature: 0.5,
            maxOutputTokens: 1200,
          },
        });

        for await (const chunk of stream) {
          if (chunk.text) {
            onChunk(chunk.text);
          }
        }

        streamSuccess = true;
        break;
      } catch (err) {
        console.warn(`[User AI Service] Stream failed with model ${modelName}:`, err.message);
        lastError = err;
      }
    }

    if (!streamSuccess) {
      throw lastError || new Error("Failed to stream response from Gemini models.");
    }

    onDone();
  } catch (error) {
    console.error("[User AI Service] Stream chat error:", error.message);
    onError(error);
  }
}

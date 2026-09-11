import { ai, MODEL_GENERATION, FALLBACK_GENERATION_MODELS } from "../config/gemini.config.js";
import { retrieveKnowledge } from "./rag.service.js";
import {
  getUserBookings,
  getUserRefundStatus,
  getUserCoupons,
  getUserProfileAndWallet,
  searchMoviesInDb,
  searchSportsInDb,
  searchGamingInDb,
  searchTrainsInDb,
} from "./mongoTools.service.js";
import { buildUserAiSystemPrompt } from "../prompts/userAi.prompt.js";

/**
 * Extract candidate movie title or keyword from user query
 * @param {string} text
 * @returns {string|null}
 */
function extractMovieSearchTerm(text = "") {
  let cleaned = text.trim();
  cleaned = cleaned.replace(/[?!.,;:'"’]/g, " ");

  // Remove common question prefixes & fillers
  cleaned = cleaned.replace(
    /\b(is|are|do you have|can you show|can you tell me about|tell me about|details of|search for|information on|what about|any info on|show me|find|about)\b/gi,
    " "
  );

  // Remove platform & media context stopwords & words like "available", "there", "in db", etc.
  cleaned = cleaned.replace(
    /\b(available in epicshow|available in db|in the database|in db|on epicshow|in catalog|catalog|tickets?|showtimes?|playing|movies?|films?|cinema|available|there|present|now|today|tonight)\b/gi,
    " "
  );

  cleaned = cleaned.trim().replace(/\s+/g, " ");
  // Don't treat generic keywords as a particular movie title
  const stopwords = new Set([
    "the", "a", "an", "upcoming", "latest", "best", "top", "all", "new", "released", "recommend",
    "recommendation", "suggestions?", "good", "hit", "popular", "available", "any", "which", "what"
  ]);

  if (cleaned.length >= 2 && !stopwords.has(cleaned.toLowerCase())) {
    return cleaned;
  }
  return null;
}

/**
 * Extract train route (from and to stations)
 * @param {string} text
 * @returns {{ from: string, to: string }|null}
 */
function extractTrainRoute(text = "") {
  const match = text.match(/\bfrom\s+([a-zA-Z\s]+?)\s+to\s+([a-zA-Z\s]+?)(?:\s+(?:train|trains|express|\?|$)|$)/i);
  if (match && match[1].trim() && match[2].trim()) {
    return {
      from: match[1].trim(),
      to: match[2].trim(),
    };
  }
  return null;
}

/**
 * Extract sports team, league, or sport keyword
 * @param {string} text
 * @returns {string|null}
 */
function extractSportsKeyword(text = "") {
  const lower = text.toLowerCase();
  const knownKeywords = [
    "csk", "chennai", "mumbai indians", "mumbai", "rcb", "bengaluru", "rajasthan royals", "rajasthan",
    "kolkata knight riders", "kolkata", "sunrisers", "hyderabad", "delhi capitals", "delhi",
    "punjab kings", "punjab", "gujarat titans", "gujarat", "lucknow", "ipl", "cricket", "football",
    "wankhede", "chepauk", "stadium"
  ];
  for (const kw of knownKeywords) {
    if (lower.includes(kw)) {
      return kw;
    }
  }
  return null;
}

/**
 * Extract gaming keyword
 * @param {string} text
 * @returns {string|null}
 */
function extractGamingKeyword(text = "") {
  const lower = text.toLowerCase();
  const known = ["bgmi", "fifa", "f1", "vr", "console", "arcade", "lan", "tournament", "expo", "carnival"];
  for (const kw of known) {
    if (lower.includes(kw)) {
      return kw;
    }
  }
  return null;
}

/**
 * Detect what dynamic database tools to query based on user message and history
 * @param {string} text
 * @param {Array<{ role: string, text: string }>} history
 * @returns {object}
 */
function analyzeIntent(text = "", history = []) {
  const lower = text.toLowerCase().trim();

  // Category mentions
  const mentionsMovie = /\b(movie|movies|cinema|film|films|theater|theatre|movei|movi|moview|filim)\b/i.test(lower);
  const mentionsTrain = /\b(train|trains|railway|irctc|pnr|berth|coach|station|shatabdi|rajdhani|express)\b/i.test(lower);
  const mentionsSports = /\b(sport|sports|cricket|football|match|matches|stadium|ipl|league|csk|rcb|mi)\b/i.test(lower);
  const mentionsGaming = /\b(gaming|game|games|vr|console|arcade|lan|bgmi|fifa|tournament|esports)\b/i.test(lower);

  let selectedCategory = null;
  if (mentionsMovie) selectedCategory = "movie";
  else if (mentionsTrain) selectedCategory = "train";
  else if (mentionsSports) selectedCategory = "sports";
  else if (mentionsGaming) selectedCategory = "gaming";

  // Booking query detection
  const isBookingQuery =
    /\b(my booking|my ticket|last booking|latest booking|previous booking|show my ticket|booked ticket|booking details|my reservation|check my booking|what did i book|recent booking)\b/i.test(
      lower
    );

  // If user asks for last booking, immediately retrieve bookings from DB (no disambiguation barrier)
  const needsBookings = isBookingQuery;

  const needsRefunds = /\b(my refund|refund status|where is my refund|refund details|money back)\b/i.test(lower);

  const needsCoupons = /\b(my coupon|my offer|my discount|promo code for me|available coupons|my vouchers)\b/i.test(lower);

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

  // Movie sub-intents
  const isUpcomingMovies =
    /\b(upcoming|coming soon|next release|releasing next|future movies?|future releases?|next month|next year|not released yet|releasing soon)\b/i.test(
      lower
    );

  const wantsBestOrTop =
    /\b(best|top|highest rated|highest rating|greatest|finest|hit|favorite|recommend|recommended|suggestion|suggest)\b/i.test(
      lower
    );

  // Specific movie title candidate
  let particularMovieCandidate = null;
  if (!isUpcomingMovies) {
    particularMovieCandidate = extractMovieSearchTerm(text);
  }

  const needsMovieCatalog =
    mentionsMovie ||
    isUpcomingMovies ||
    particularMovieCandidate !== null ||
    wantsBestOrTop ||
    /\b(showing|now showing|releases|what movies|popular movies|playing movies|latest movies|what to watch)\b/i.test(lower) ||
    (isBookingAttempt && !mentionsTrain && !mentionsSports && !mentionsGaming);

  // Sports sub-intents
  const sportsKeyword = extractSportsKeyword(text);
  const needsSports = mentionsSports || sportsKeyword !== null;

  // Gaming sub-intents
  const gamingKeyword = extractGamingKeyword(text);
  const needsGaming = mentionsGaming || gamingKeyword !== null;

  // Train sub-intents
  const trainRoute = extractTrainRoute(text);
  let trainKeyword = null;
  if (lower.includes("rajdhani")) trainKeyword = "Rajdhani";
  else if (lower.includes("shatabdi")) trainKeyword = "Shatabdi";
  else if (lower.includes("karnataka")) trainKeyword = "Karnataka";
  else if (lower.includes("coimbatore")) trainKeyword = "Coimbatore";
  else if (lower.includes("local")) trainKeyword = "Local";

  const needsTrains = mentionsTrain || trainRoute !== null || trainKeyword !== null;

  return {
    isGreeting,
    needsBookings,
    selectedCategory,
    needsRefunds,
    needsCoupons,
    needsWallet,
    needsProfile,
    needsMovieCatalog,
    isUpcomingMovies,
    particularMovieCandidate,
    wantsBestOrTop,
    needsSports,
    sportsKeyword,
    needsGaming,
    gamingKeyword,
    needsTrains,
    trainRoute,
    trainKeyword,
    isBookingAttempt,
  };
}

/**
 * Handle streaming chat orchestration with verified database grounding
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

    const dbQueries = [];

    // 1. User Bookings (Movie, Train, Sports, Gaming)
    if (intent.needsBookings) {
      if (isAuthenticated) {
        // Query user's bookings (specific category or all categories for most recent)
        dbQueries.push(
          getUserBookings(userId, intent.selectedCategory, 3).then((res) => {
            dynamicUserData.user_bookings = res;
          })
        );
      } else {
        dynamicUserData.user_bookings = {
          authenticated: false,
          note: "User is not logged in. Tell the user to log in to view their bookings.",
        };
      }
    }

    // 2. Refunds
    if (intent.needsRefunds) {
      if (isAuthenticated) {
        dbQueries.push(
          getUserRefundStatus(userId).then((res) => {
            dynamicUserData.user_refunds = res;
          })
        );
      } else {
        dynamicUserData.user_refunds = {
          authenticated: false,
          note: "User is not logged in. Tell the user to log in to view their refund status.",
        };
      }
    }

    // 3. Coupons
    if (intent.needsCoupons) {
      if (isAuthenticated) {
        dbQueries.push(
          getUserCoupons(userId).then((res) => {
            dynamicUserData.user_coupons = res;
          })
        );
      } else {
        dynamicUserData.user_coupons = {
          authenticated: false,
          note: "User is not logged in. Tell the user to log in to view their personal coupons.",
        };
      }
    }

    // 4. Wallet & Profile
    if (intent.needsWallet || intent.needsProfile) {
      if (isAuthenticated) {
        dbQueries.push(
          getUserProfileAndWallet(userId).then((res) => {
            dynamicUserData.user_wallet_and_profile = res;
          })
        );
      } else {
        dynamicUserData.user_wallet_and_profile = {
          authenticated: false,
          note: "User is not logged in. Tell the user to log in to their EpicShow account to view their wallet balance and profile details.",
        };
      }
    }

    // 5. Movies Database Queries
    if (intent.isUpcomingMovies) {
      dbQueries.push(
        searchMoviesInDb({ type: "upcoming", limit: 6 }).then((res) => {
          dynamicUserData.upcoming_movies = res;
        })
      );
    } else if (intent.particularMovieCandidate) {
      // Query specific movie from DB
      dbQueries.push(
        searchMoviesInDb({ query: intent.particularMovieCandidate, limit: 3 }).then((res) => {
          dynamicUserData.movie_search_result = res;
        })
      );
    } else if (intent.wantsBestOrTop) {
      dbQueries.push(
        searchMoviesInDb({ type: "top_rated", limit: 3 }).then((res) => {
          dynamicUserData.top_rated_movies = res;
        })
      );
    } else if (intent.needsMovieCatalog) {
      dbQueries.push(
        searchMoviesInDb({ type: "playing", limit: 3 }).then((res) => {
          dynamicUserData.currently_playing_movies = res;
        })
      );
    }

    // 6. Sports Database Queries
    if (intent.needsSports) {
      dbQueries.push(
        searchSportsInDb({ query: intent.sportsKeyword, limit: 4 }).then((res) => {
          dynamicUserData.sports_matches = res;
        })
      );
    }

    // 7. Gaming Database Queries
    if (intent.needsGaming) {
      dbQueries.push(
        searchGamingInDb({ query: intent.gamingKeyword, limit: 4 }).then((res) => {
          dynamicUserData.gaming_events = res;
        })
      );
    }

    // 8. Train Database Queries
    if (intent.needsTrains) {
      dbQueries.push(
        searchTrainsInDb({
          from: intent.trainRoute?.from || null,
          to: intent.trainRoute?.to || null,
          query: intent.trainKeyword || null,
          limit: 4,
        }).then((res) => {
          dynamicUserData.train_schedule = res;
        })
      );
    }

    // Execute all database queries in parallel
    await Promise.all(dbQueries);

    // 9. Semantic retrieval from verified platform markdown knowledge base
    const knowledgeChunks = await retrieveKnowledge(message, 5);

    // 10. Build system prompt
    const systemInstruction = buildUserAiSystemPrompt({
      userName,
      isAuthenticated,
      isGreeting: intent.isGreeting,
      knowledgeChunks,
      dynamicUserData: Object.keys(dynamicUserData).length > 0 ? dynamicUserData : null,
      isBookingAttempt: intent.isBookingAttempt,
    });

    // 11. Format conversation history
    const contents = [];
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

    // 12. Stream generated response with primary and fallback models
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
            temperature: 0.3, // Lower temperature to avoid hallucinations and adhere strictly to DB data
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

const getTmdbMovieMeta = async ({ movieTitle, releaseDate }) => {
  const token = process.env.TMDB_BEARER_TOKEN || process.env.NEXT_PUBLIC_TMDB_BEARER_TOKEN;
  if (!token) return null;

  try {
    const searchUrl = new URL("https://api.themoviedb.org/3/search/movie");
    searchUrl.searchParams.set("query", String(movieTitle || "").trim());
    searchUrl.searchParams.set("language", "en-US");
    searchUrl.searchParams.set("page", "1");

    const searchRes = await fetch(searchUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    });

    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const match = (searchData.results || []).find((movie) => {
      if (!releaseDate) return true;
      const movieYear = movie.release_date ? new Date(movie.release_date).getFullYear() : null;
      const requestedYear = new Date(releaseDate).getFullYear();
      return Number.isFinite(requestedYear) && movieYear === requestedYear;
    });

    const movieId = match?.id;
    if (!movieId) return null;

    const [detailRes, creditsRes] = await Promise.all([
      fetch(`https://api.themoviedb.org/3/movie/${movieId}?language=en-US`, {
        headers: {
          Authorization: `Bearer ${token}`,
          accept: "application/json",
        },
      }),
      fetch(`https://api.themoviedb.org/3/movie/${movieId}/credits?language=en-US`, {
        headers: {
          Authorization: `Bearer ${token}`,
          accept: "application/json",
        },
      }),
    ]);

    if (!detailRes.ok || !creditsRes.ok) return null;

    const detailData = await detailRes.json();
    const creditsData = await creditsRes.json();

    const cast = (creditsData.cast || [])
      .slice(0, 6)
      .map((person) => person?.name)
      .filter(Boolean);

    const director = (creditsData.crew || [])
      .filter((member) => member?.job === "Director")
      .map((member) => member?.name)
      .filter(Boolean)[0];

    const writers = (creditsData.crew || [])
      .filter((member) => ["Writer", "Screenplay", "Story"].includes(member?.job))
      .map((member) => member?.name)
      .filter(Boolean)
      .slice(0, 3);

    return {
      cast,
      director,
      writers,
      genres: (detailData.genres || []).map((item) => item?.name).filter(Boolean).slice(0, 5),
      runtime: detailData.runtime || null,
      releaseDate: detailData.release_date || releaseDate || null,
    };
  } catch (error) {
    console.error("TMDB movie meta fetch failed", error);
    return null;
  }
};

const buildMoviePrompt = ({ movieTitle, releaseDate, movieMeta }) => {
  const title = String(movieTitle || "").trim();
  const release = String(releaseDate || movieMeta?.releaseDate || "").trim();

  const promptParts = [
    "You are a movie expert and storyteller.",
    "Write a rich, engaging movie overview for a normal user.",
    "Use natural English and make it easy to read.",
    "Format the response as clean markdown-like output with bold section headings and bullet points.",
    "Use this exact structure:",
    "**Story:**",
    "- brief summary of the plot in a user-friendly way",
    "**Tone & Audience:**",
    "- who the movie is for and the overall mood",
    "**Why it stands out:**",
    "- what makes it memorable or worth watching",
    "**What to expect:**",
    "- pacing, emotion, themes, and viewing experience",
    "**Quick note:**",
    "- brief final opinion or caution",
    "Do not use asterisks as bullet markers. Use hyphen bullets instead.",
    "Keep it polished, readable, and informative. Avoid long technical blocks.",
    "If details are uncertain, say so briefly at the end.",
  ];

  if (title) {
    promptParts.push(`Movie title: ${title}`);
  }

  if (release) {
    promptParts.push(`Release date: ${release}`);
  }

  if (movieMeta?.director) {
    promptParts.push(`Director: ${movieMeta.director}`);
  }

  if (movieMeta?.cast?.length) {
    promptParts.push(`Cast: ${movieMeta.cast.slice(0, 6).join(", ")}`);
  }

  if (movieMeta?.genres?.length) {
    promptParts.push(`Genres: ${movieMeta.genres.join(", ")}`);
  }

  if (movieMeta?.runtime) {
    promptParts.push(`Runtime: ${movieMeta.runtime} minutes`);
  }

  promptParts.push(
    "Keep the answer between 400 and 600 words and make it feel like a premium streaming app recommendation."
  );

  return promptParts.join("\n");
};

export const askMovieAi = async (req, res) => {
  try {
    const movieTitle = String(req.body?.movieTitle || "").trim();
    const releaseDate = String(req.body?.releaseDate || "").trim();

    if (!movieTitle) {
      return res.status(400).json({ message: "Movie title is required." });
    }

    const geminiKey = process.env.GEMINI_KEY;
    if (!geminiKey) {
      return res.status(500).json({ message: "Gemini API key is not configured." });
    }

    const movieMeta = await getTmdbMovieMeta({ movieTitle, releaseDate });

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: buildMoviePrompt({ movieTitle, releaseDate, movieMeta }) }],
            },
          ],
          generationConfig: {
            temperature: 0.35,
            topK: 40,
            topP: 0.85,
            maxOutputTokens: 5000,
          },
        }),
      }
    );

    const payload = await response.json();
    console.log(payload)

    if (!response.ok) {
      const rawMessage = payload?.error?.message || "Failed to generate AI summary.";
      const isQuotaError =
        response.status === 429 ||
        /quota exceeded|rate limit|too many requests|please retry in|free_tier_requests/i.test(rawMessage);

      return res.status(isQuotaError ? 429 : response.status || 500).json({
        message: isQuotaError
          ? "Server busy, please wait a moment before trying again"
          : rawMessage,
      });
    }

    const summary =
      payload?.candidates?.[0]?.content?.parts
        ?.map((part) => part?.text)
        .filter(Boolean)
        .join("\n")
        ?.trim() || null;

    if (!summary) {
      return res.status(502).json({ message: "Gemini did not return a valid summary." });
    }

    return res.json({
      summary,
      source: "Gemini",
      title: movieTitle,
      releaseDate: movieMeta?.releaseDate || releaseDate || null,
      meta: movieMeta || null,
    });
  } catch (error) {
    const message = error?.message || "Failed to generate AI summary.";
    return res.status(500).json({ message });
  }
};

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

export const getUpcomingMovies = async (req, res) => {
  try {
    const hasLimit = Object.prototype.hasOwnProperty.call(req.query, "limit");
    const limit = hasLimit
      ? Math.min(Math.max(Number(req.query.limit) || 10, 1), 20)
      : undefined;
    const token =
      process.env.TMDB_BEARER_TOKEN || process.env.NEXT_PUBLIC_TMDB_BEARER_TOKEN;

    if (!token) {
      return res.status(500).json({ message: "TMDB bearer token is not configured" });
    }

    const url = new URL(`${TMDB_BASE}/movie/upcoming`);
    url.searchParams.set("language", "en-US");
    url.searchParams.set("page", "1");

    const tmdbRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    });

    const payload = await tmdbRes.json();
    if (!tmdbRes.ok) {
      return res.status(tmdbRes.status).json({
        message: "Failed to fetch upcoming movies from TMDB",
        detail: payload,
      });
    }

    const todayStr = new Date().toISOString().slice(0, 10);
    const items = (payload.results || [])
      .map((movie) => ({
        tmdbId: movie.id,
        name: movie.title || movie.original_title || "Untitled",
        description: movie.overview || "",
        imageUrl: movie.poster_path ? `${IMAGE_BASE}${movie.poster_path}` : null,
        releaseDate: movie.release_date || null,
        rating: typeof movie.vote_average === "number" ? movie.vote_average : null,
        voteCount: typeof movie.vote_count === "number" ? movie.vote_count : 0,
      }))
      .filter((movie) => movie.releaseDate && movie.releaseDate >= todayStr);

    return res.json({
      items: typeof limit === "number" ? items.slice(0, limit) : items,
      total: items.length,
    });
  } catch (err) {
    return res.status(500).json({ message: err.message || "Unexpected error" });
  }
};

export const getMovieDetails = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ message: "Movie id is required" });
    }

    const token =
      process.env.TMDB_BEARER_TOKEN || process.env.NEXT_PUBLIC_TMDB_BEARER_TOKEN;

    if (!token) {
      return res.status(500).json({ message: "TMDB bearer token is not configured" });
    }

    const url = new URL(`${TMDB_BASE}/movie/${id}`);
    url.searchParams.set("language", "en-US");

    const tmdbRes = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        accept: "application/json",
      },
    });

    const payload = await tmdbRes.json();
    if (!tmdbRes.ok) {
      return res.status(tmdbRes.status).json({
        message: "Failed to fetch movie details from TMDB",
        detail: payload,
      });
    }

    const detail = {
      id: payload.id,
      title: payload.title || payload.original_title || "Untitled",
      originalTitle: payload.original_title || payload.title || "Untitled",
      tagline: payload.tagline || "",
      overview: payload.overview || "",
      releaseDate: payload.release_date || null,
      status: payload.status || null,
      runtime: payload.runtime || null,
      rating: typeof payload.vote_average === "number" ? payload.vote_average : null,
      voteCount: typeof payload.vote_count === "number" ? payload.vote_count : 0,
      genres: payload.genres || [],
      spokenLanguages: payload.spoken_languages || [],
      productionCompanies: payload.production_companies || [],
      productionCountries: payload.production_countries || [],
      budget: payload.budget || 0,
      revenue: payload.revenue || 0,
      homepage: payload.homepage || "",
      imdbId: payload.imdb_id || "",
      popularity: payload.popularity || 0,
      posterUrl: payload.poster_path ? `${IMAGE_BASE}${payload.poster_path}` : null,
      backdropUrl: payload.backdrop_path ? `${IMAGE_BASE}${payload.backdrop_path}` : null,
    };

    return res.json(detail);
  } catch (err) {
    return res.status(500).json({ message: err.message || "Unexpected error" });
  }
};

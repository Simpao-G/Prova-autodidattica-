// Calcolo delle classifiche dell'app (nessuna richiesta in rete): lo usa scripts/build-rankings.mjs.
//
// Voto di ogni anime = media tra il voto AniList (dal database dell'app, 0-100 -> 0-10) e la
// "media dei siti" del database pubblico manami-project/anime-offline-database (MyAnimeList, AniList,
// Kitsu, AniDB, Anime-Planet...). Se una delle due manca si usa l'altra.
// Per entrare in classifica serve abbastanza pubblico (popolarità AniList), così un titolo
// sconosciuto con pochi voti non finisce in cima.

// Generi di AniList usati per le classifiche (Hentai escluso; i titoli per adulti non sono nel database)
export const GENRES = [
  "Action",
  "Adventure",
  "Comedy",
  "Drama",
  "Ecchi",
  "Fantasy",
  "Horror",
  "Mahou Shoujo",
  "Mecha",
  "Music",
  "Mystery",
  "Psychological",
  "Romance",
  "Sci-Fi",
  "Slice of Life",
  "Sports",
  "Supernatural",
  "Thriller",
];

const TYPES = new Set(["TV", "Film", "OVA", "ONA", "Special"]);
const LIMITS = { top: 100, genre: 50, year: 50, years: 5, minPopularity: 20000, minPopularityYear: 2000 };

// Media dei voti disponibili (AniList 0-100, siti 0-10), arrotondata a 2 decimali; null se non c'è nessun voto
export function combineScore(alScore100, sitesScore) {
  const votes = [];
  if (alScore100 > 0) votes.push(alScore100 / 10);
  if (sitesScore > 0) votes.push(sitesScore);
  if (!votes.length) return null;
  return Math.round((votes.reduce((a, b) => a + b, 0) / votes.length) * 100) / 100;
}

// Righe di data/anime.json -> oggetti; l'id è lo stesso dell'app (mal-<id> oppure al-<id>)
export function animeFromIndex(index) {
  const f = Object.fromEntries(index.fields.map((name, i) => [name, i]));
  return index.items.map((it) => {
    const alId = it[f.anilistId];
    const malId = it[f.malId] || 0;
    return {
      id: malId ? `mal-${malId}` : `al-${alId}`,
      alId,
      malId,
      title: it[f.title],
      altTitle: it[f.altTitle] || "",
      type: it[f.type] || "",
      year: it[f.year] || 0,
      episodes: it[f.episodes] || 0,
      cover: it[f.cover] || "",
      popularity: it[f.popularity] || 0,
      alScore: it[f.score] || 0,
    };
  });
}

export function buildRankings({ anime, genresByAl, sites, now, coverPrefix, sitesUpdated }) {
  const scored = [];
  for (const a of anime) {
    if (!TYPES.has(a.type)) continue;
    const site = sites.get(a.alId) ?? null;
    const combined = combineScore(a.alScore, site);
    if (combined !== null) scored.push({ a, site, combined });
  }
  // dal voto più alto; a parità, il più seguito
  scored.sort((x, y) => y.combined - x.combined || y.a.popularity - x.a.popularity);

  const items = {};
  const take = (keep, max) => {
    const ids = [];
    for (const e of scored) {
      if (ids.length >= max) break;
      if (!keep(e.a)) continue;
      ids.push(e.a.id);
      items[e.a.id] = [e.a.alId, e.a.malId, e.a.title, e.a.type, e.a.year, e.a.episodes, e.a.cover, e.combined, e.a.alScore ? e.a.alScore / 10 : null, e.site];
    }
    return ids;
  };

  const top = take((a) => a.popularity >= LIMITS.minPopularity, LIMITS.top);
  const genres = {};
  for (const g of GENRES) {
    const ids = take((a) => a.popularity >= LIMITS.minPopularity && (genresByAl.get(a.alId) || []).includes(g), LIMITS.genre);
    if (ids.length) genres[g] = ids;
  }
  const years = {};
  const thisYear = now.getFullYear();
  for (let y = thisYear; y > thisYear - LIMITS.years; y--) {
    years[y] = take((a) => a.year === y && a.popularity >= LIMITS.minPopularityYear, LIMITS.year);
  }

  return {
    version: 1,
    updated: now.toISOString(),
    coverPrefix,
    sitesUpdated: sitesUpdated ?? null,
    sources: { sites: sites.size > 0 },
    items,
    top,
    genres,
    years,
  };
}

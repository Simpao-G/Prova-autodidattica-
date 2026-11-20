// Classifiche dell'app (data/rankings.json), ricalcolate ogni lunedì da GitHub Actions
// (.github/workflows/update-db.yml) dopo il download del database da AniList.
//
// Fonti:
//  - il database dell'app (data/anime.json + generi in data/d/*.json): voto e popolarità AniList;
//  - il database pubblico manami-project/anime-offline-database (licenza ODbL): per ogni anime la
//    media dei voti di MyAnimeList, AniList, Kitsu, AniDB, Anime-Planet e altri siti.
// Se il secondo non si scarica, le classifiche si fanno con il solo AniList (l'app lo segnala).
//
// Variabili (per le prove): DATA_DIR, SITES_URL, NOW (data ISO), RETRY_MS (attesa tra i tentativi).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { animeFromIndex, buildRankings } from "./rankings-core.mjs";

const DEFAULT_DATA = fileURLToPath(new URL("../data/", import.meta.url));
const DEFAULT_SITES =
  "https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json";
const ANILIST_URL = /^https:\/\/anilist\.co\/anime\/(\d+)$/;
const ATTEMPTS = 4;

async function download(url, retryMs) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
      if (res.ok) return await res.json();
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, retryMs * attempt));
  }
  throw lastError;
}

// Media dei siti per id AniList (2 decimali), solo per gli anime già finiti quando è stato fatto il
// database pubblico: per quelli in corso o non ancora usciti il voto è di pochi spettatori (anche 10)
function sitesScores(db) {
  const scores = new Map();
  for (const anime of db.data || []) {
    const mean = anime.score?.arithmeticMean;
    if (!(mean > 0) || anime.status !== "FINISHED") continue;
    for (const src of anime.sources || []) {
      const m = ANILIST_URL.exec(src);
      if (m) scores.set(Number(m[1]), Math.round(mean * 100) / 100);
    }
  }
  return scores;
}

export async function main(env = process.env) {
  const dir = env.DATA_DIR || DEFAULT_DATA;
  const index = JSON.parse(await readFile(path.join(dir, "anime.json"), "utf8"));

  // generi: secondo elemento di ogni anime nei blocchi dei dettagli (un blocco mancante = nessun genere)
  const genresByAl = new Map();
  for (let n = 0; n < (index.shards || 64); n++) {
    let shard;
    try {
      shard = JSON.parse(await readFile(path.join(dir, "d", `${n}.json`), "utf8"));
    } catch {
      continue;
    }
    for (const [id, entry] of Object.entries(shard)) genresByAl.set(Number(id), entry[1] || []);
  }

  let sites = new Map();
  let sitesUpdated = null;
  try {
    const db = await download(env.SITES_URL || DEFAULT_SITES, Number(env.RETRY_MS ?? 10000));
    sites = sitesScores(db);
    sitesUpdated = db.lastUpdate || null;
  } catch (err) {
    console.warn(`Media dei siti non disponibile (${err.message}): classifiche con il solo AniList.`);
  }

  const now = env.NOW ? new Date(env.NOW) : new Date();
  const rankings = buildRankings({ anime: animeFromIndex(index), genresByAl, sites, now, coverPrefix: index.coverPrefix, sitesUpdated });
  await writeFile(path.join(dir, "rankings.json"), JSON.stringify(rankings));
  console.log(
    `Classifiche: ${rankings.top.length} migliori, ${Object.keys(rankings.genres).length} generi, anni ${Object.keys(rankings.years).join(", ")}; ` +
      `media dei siti per ${sites.size} anime (aggiornata il ${sitesUpdated || "?"}).`
  );
  return rankings;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

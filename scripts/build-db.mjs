// Costruisce il database degli anime usato dall'app (cartella data/).
// Scarica tutti gli anime da AniList (API GraphQL pubblica, nessuna chiave).
// Viene eseguito da GitHub Actions: .github/workflows/update-db.yml
//
// File prodotti:
//   data/anime.json   indice per la ricerca (titoli, tipo, anno, episodi, copertina...)
//   data/d/<n>.json   dettagli divisi in blocchi: descrizione, generi, stagioni

import { mkdir, writeFile, rm } from "node:fs/promises";

const API = "https://graphql.anilist.co";
const OUT = new URL("../data/", import.meta.url);
const SHARDS = 64;
const COVER_PREFIX = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/";
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 2100); // AniList: max ~30 richieste/minuto
const MAX_ITEMS = Number(process.env.MAX_ITEMS ?? Infinity); // solo per prove

const TYPE = { TV: "TV", TV_SHORT: "TV", ONA: "ONA", MOVIE: "Film", OVA: "OVA", SPECIAL: "Special" };
const SEASON_TYPES = new Set(["TV", "TV_SHORT", "ONA"]);

const QUERY = `query ($after: Int, $perPage: Int) {
  Page(perPage: $perPage) {
    media(type: ANIME, isAdult: false, id_greater: $after, sort: ID) {
      id idMal
      title { romaji english }
      coverImage { large }
      description(asHtml: false)
      episodes seasonYear startDate { year month day }
      format averageScore popularity genres
      relations { edges { relationType node { id type } } }
    }
  }
}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(after, perPage) {
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query: QUERY, variables: { after, perPage } }),
      });
    } catch (err) {
      if (attempt >= 8) throw err;
      console.warn(`rete: ${err.message}, riprovo…`);
      await sleep(5000 * attempt);
      continue;
    }
    if (res.status === 429) {
      const header = res.headers.get("retry-after");
      const secs = header !== null && Number.isFinite(Number(header)) ? Number(header) : 60;
      const wait = secs * 1000 + 1000;
      console.warn(`limite di richieste raggiunto, aspetto ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    const json = await res.json().catch(() => null);
    if (res.ok && json?.data) return json.data.Page.media;
    const msg = json?.errors?.[0]?.message || `HTTP ${res.status}`;
    if (/complex/i.test(msg) && perPage > 10) return request(after, Math.floor(perPage / 2));
    if (attempt >= 8 || (res.status >= 400 && res.status < 500)) throw new Error(msg);
    console.warn(`${msg}, riprovo…`);
    await sleep(5000 * attempt);
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
export function cleanText(s) {
  return String(s || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s*\((Source|Fonte):[^)]*\)\s*$/i, "")
    .trim()
    .slice(0, 2500);
}

const dateKey = (m) => (m.startDate?.year || 9999) * 10000 + (m.startDate?.month || 12) * 100 + (m.startDate?.day || 31);

// Raggruppa prequel e sequel: per ogni serie l'elenco ordinato di stagioni e film
export function buildSeasons(all) {
  const byId = new Map(all.map((m) => [m.id, m]));
  const adj = new Map(all.map((m) => [m.id, []]));
  for (const m of all) {
    for (const e of m.relations?.edges || []) {
      if ((e.relationType === "SEQUEL" || e.relationType === "PREQUEL") && e.node?.type === "ANIME" && byId.has(e.node.id)) {
        adj.get(m.id).push(e.node.id);
        adj.get(e.node.id).push(m.id);
      }
    }
  }
  const seasons = new Map();
  const seen = new Set();
  for (const m of all) {
    if (seen.has(m.id)) continue;
    const group = [];
    const stack = [m.id];
    seen.add(m.id);
    while (stack.length) {
      const id = stack.pop();
      group.push(id);
      for (const n of adj.get(id)) if (!seen.has(n)) (seen.add(n), stack.push(n));
    }
    if (group.length < 2) continue;
    group.sort((a, b) => dateKey(byId.get(a)) - dateKey(byId.get(b)) || a - b);
    for (const id of group) seasons.set(id, group);
  }
  return seasons;
}

export function build(all) {
  const seasons = buildSeasons(all);
  const items = all
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .map((m) => {
      const title = m.title?.english || m.title?.romaji || "";
      const alt = m.title?.romaji && m.title.romaji !== title ? m.title.romaji : "";
      let cover = m.coverImage?.large || "";
      if (cover.startsWith(COVER_PREFIX)) cover = cover.slice(COVER_PREFIX.length);
      return [
        m.id,
        m.idMal || 0,
        title,
        alt,
        TYPE[m.format] || m.format || "",
        m.seasonYear || m.startDate?.year || 0,
        m.episodes || 0,
        cover,
        m.averageScore || 0,
        m.popularity || 0,
        SEASON_TYPES.has(m.format) ? 1 : 0,
      ];
    });

  const shards = Array.from({ length: SHARDS }, () => ({}));
  for (const m of all) {
    shards[m.id % SHARDS][m.id] = [cleanText(m.description), (m.genres || []).slice(0, 5), seasons.get(m.id) || []];
  }
  return {
    index: {
      version: 1,
      updated: new Date().toISOString().slice(0, 10),
      coverPrefix: COVER_PREFIX,
      shards: SHARDS,
      fields: ["anilistId", "malId", "title", "altTitle", "type", "year", "episodes", "cover", "score", "popularity", "isSeason"],
      items,
    },
    shards,
  };
}

async function main() {
  const all = [];
  let after = 0;
  for (let page = 1; all.length < MAX_ITEMS; page++) {
    const media = await request(after, 50);
    if (!media.length) break;
    for (const m of media) if (m.format !== "MUSIC" && (m.title?.english || m.title?.romaji)) all.push(m);
    after = media[media.length - 1].id;
    if (page % 20 === 0) console.log(`pagina ${page}: ${all.length} anime (ultimo id ${after})`);
    await sleep(PAUSE_MS);
  }
  if (all.length < (MAX_ITEMS === Infinity ? 5000 : 1)) throw new Error(`Troppo pochi anime (${all.length}): non aggiorno il database`);

  const { index, shards } = build(all);
  await rm(new URL("d/", OUT), { recursive: true, force: true });
  await mkdir(new URL("d/", OUT), { recursive: true });
  await writeFile(new URL("anime.json", OUT), JSON.stringify(index));
  await Promise.all(shards.map((s, i) => writeFile(new URL(`d/${i}.json`, OUT), JSON.stringify(s))));
  console.log(`Fatto: ${index.items.length} anime salvati.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

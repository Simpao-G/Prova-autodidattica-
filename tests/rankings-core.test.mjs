// Prove del calcolo delle classifiche (scripts/rankings-core.mjs). Avvio: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { GENRES, animeFromIndex, combineScore, buildRankings } from "../scripts/rankings-core.mjs";

const FIELDS = ["anilistId", "malId", "title", "altTitle", "type", "year", "episodes", "cover", "score", "popularity", "isSeason", "duration"];
const PREFIX = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/";
const index = {
  coverPrefix: PREFIX,
  fields: FIELDS,
  items: [
    [1, 101, "Alpha", "", "TV", 2020, 24, "medium/a.jpg", 90, 500000, 1, 24],
    [2, 0, "Beta", "Beta JP", "Film", 2019, 1, "medium/b.jpg", 92, 30000, 0, 120],
    [3, 103, "Gamma", "", "TV", 2021, 12, "", 95, 1500, 1, 24],
    [4, 104, "Delta", "", "TV", 2026, 12, "medium/d.jpg", 80, 25000, 1, 24],
    [5, 105, "Epsilon", "", "", 2026, 12, "", 99, 900000, 0, 0],
    [6, 106, "Zeta", "", "ONA", 2026, 10, "medium/z.jpg", 0, 3000, 1, 24],
    [7, 107, "Eta", "", "TV", 2020, 24, "medium/e.jpg", 89, 600000, 1, 24],
  ],
};
const genresByAl = new Map([
  [1, ["Action", "Drama"]],
  [2, ["Romance"]],
  [4, ["Action"]],
  [6, ["Comedy"]],
  [7, ["Action"]],
]);
const sites = new Map([
  [1, 8.8],
  [4, 8.4],
  [6, 7.5],
  [7, 8.9],
]);
const now = new Date("2026-11-20T12:00:00Z");
const build = (over = {}) =>
  buildRankings({ anime: animeFromIndex(index), genresByAl, sites, now, coverPrefix: PREFIX, sitesUpdated: "2026-07-04", ...over });

test("GENRES: i 18 generi di AniList senza Hentai", () => {
  assert.equal(GENRES.length, 18);
  assert.ok(GENRES.includes("Slice of Life") && GENRES.includes("Ecchi") && GENRES.includes("Thriller"));
  assert.ok(!GENRES.includes("Hentai"));
});

test("combineScore: media semplice, o la fonte che c'è", () => {
  assert.equal(combineScore(90, 8.8), 8.9);
  assert.equal(combineScore(90, null), 9);
  assert.equal(combineScore(0, 8.5), 8.5);
  assert.equal(combineScore(0, null), null);
  assert.equal(combineScore(87, 8.123), 8.41);
});

test("animeFromIndex: id come nel database dell'app", () => {
  const list = animeFromIndex(index);
  assert.equal(list[0].id, "mal-101");
  assert.equal(list[1].id, "al-2");
  assert.deepEqual(
    { alId: list[0].alId, malId: list[0].malId, title: list[1].altTitle, type: list[0].type, year: list[0].year, cover: list[0].cover, popularity: list[0].popularity, alScore: list[0].alScore },
    { alId: 1, malId: 101, title: "Beta JP", type: "TV", year: 2020, cover: "medium/a.jpg", popularity: 500000, alScore: 90 }
  );
});

test("top: soglia di 20000, tipo valido, ordine per voto e a parità per popolarità", () => {
  assert.deepEqual(build().top, ["al-2", "mal-107", "mal-101", "mal-104"]);
});

test("genres: solo anime del genere sopra soglia; generi vuoti non compaiono", () => {
  const r = build();
  assert.deepEqual(r.genres.Action, ["mal-107", "mal-101", "mal-104"]);
  assert.deepEqual(r.genres.Romance, ["al-2"]);
  assert.equal(r.genres.Comedy, undefined);
});

test("years: anno in corso e 4 precedenti, soglia 2000", () => {
  const r = build();
  assert.deepEqual(Object.keys(r.years).sort(), ["2022", "2023", "2024", "2025", "2026"]);
  assert.deepEqual(r.years["2026"], ["mal-104", "mal-106"]);
  assert.deepEqual(r.years["2022"], []);
});

test("items: una riga per ogni anime citato, con i voti per fonte", () => {
  const r = build();
  assert.deepEqual(r.items["mal-101"], [1, 101, "Alpha", "TV", 2020, 24, "medium/a.jpg", 8.9, 9, 8.8]);
  assert.equal(r.items["al-2"][9], null);
  assert.equal(r.items["mal-106"][8], null);
  const cited = new Set([...r.top, ...Object.values(r.genres).flat(), ...Object.values(r.years).flat()]);
  assert.deepEqual(new Set(Object.keys(r.items)), cited);
});

test("intestazione: versione, fonti e date", () => {
  const r = build();
  assert.equal(r.version, 1);
  assert.equal(r.coverPrefix, PREFIX);
  assert.equal(r.sitesUpdated, "2026-07-04");
  assert.equal(r.sources.sites, true);
  assert.ok(!Number.isNaN(Date.parse(r.updated)));
  assert.equal(build({ sites: new Map() }).sources.sites, false);
});

test("limiti: 100 migliori, 50 per genere e per anno", () => {
  const items = Array.from({ length: 150 }, (_, i) => [1000 + i, 0, `Anime ${i}`, "", "TV", 2026, 12, "", 50 + (i % 50), 50000 + i, 1, 24]);
  const genres = new Map(items.map((it) => [it[0], ["Action"]]));
  const r = buildRankings({ anime: animeFromIndex({ ...index, items }), genresByAl: genres, sites: new Map(), now, coverPrefix: PREFIX, sitesUpdated: null });
  assert.equal(r.top.length, 100);
  assert.equal(r.genres.Action.length, 50);
  assert.equal(r.years["2026"].length, 50);
});

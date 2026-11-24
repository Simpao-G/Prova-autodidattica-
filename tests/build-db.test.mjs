// Prove dei campi nuovi dell'indice (generi, stato, inizio serie) e dello script enrich-index. Avvio: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { build, genreMask, seriesStart, STATUS_NAMES } from "../scripts/build-db.mjs";
import { enrich } from "../scripts/enrich-index.mjs";
import { GENRES } from "../scripts/rankings-core.mjs";

const media = (id, format, year, over = {}) => ({
  id,
  idMal: id,
  title: { english: `Anime ${id}` },
  coverImage: { large: "" },
  description: "",
  startDate: { year, month: 1, day: 1 },
  seasonYear: year,
  format,
  status: "FINISHED",
  averageScore: 70,
  popularity: 1000 + id,
  genres: [],
  relations: { edges: [] },
  ...over,
});
const sequel = (from, to) => from.relations.edges.push({ relationType: "SEQUEL", node: { id: to, type: "ANIME" } });

function fixture() {
  const ova = media(1, "OVA", 2000, { genres: ["Action", "Comedy"], status: "FINISHED" });
  const s1 = media(2, "TV", 2005, { genres: ["Drama"], status: "FINISHED" });
  const s2 = media(3, "TV", 2007, { status: "RELEASING" });
  const film = media(4, "MOVIE", 2009, { status: "NOT_YET_RELEASED" });
  const alone = media(5, "TV", 2010, { status: "HIATUS", genres: ["Romance", "Sci-Fi", "Boh"] });
  const m1 = media(6, "MOVIE", 2001);
  const m2 = media(7, "MOVIE", 2003, { status: "CANCELLED" });
  const noStatus = media(8, "TV_SHORT", 2012, { status: undefined });
  sequel(ova, 2);
  sequel(s1, 3);
  sequel(s2, 4);
  sequel(m1, 7);
  return [ova, s1, s2, film, alone, m1, m2, noStatus];
}

const row = (index, alId) => {
  const f = Object.fromEntries(index.fields.map((n, i) => [n, i]));
  const r = index.items.find((it) => it[f.anilistId] === alId);
  return Object.fromEntries(index.fields.map((n, i) => [n, r[i]]));
};

test("genreMask: un bit per genere nell'ordine di GENRES, generi sconosciuti ignorati", () => {
  assert.equal(genreMask([]), 0);
  assert.equal(genreMask(undefined), 0);
  assert.equal(genreMask(["Action"]), 1);
  assert.equal(genreMask(["Action", "Comedy"]), 1 | (1 << GENRES.indexOf("Comedy")));
  assert.equal(genreMask(["Boh", "Hentai"]), 0);
  assert.equal(genreMask(["Action", "Fantasy", "Fantasy"]), genreMask(["Action", "Fantasy"]), "un genere ripetuto nei dati AniList conta una volta sola");
  assert.ok(genreMask(GENRES) < 2 ** 31, "sta nei 32 bit con segno di JavaScript");
});

test("seriesStart: senza serie, con OVA prima della prima stagione, solo film", () => {
  const seasons = new Set([2, 3]);
  const isSeason = (id) => seasons.has(id);
  assert.equal(seriesStart(5, undefined, isSeason), 1);
  assert.equal(seriesStart(5, [5], isSeason), 1);
  assert.equal(seriesStart(1, [1, 2, 3, 4], isSeason), 0, "l'OVA pilota non è l'inizio");
  assert.equal(seriesStart(2, [1, 2, 3, 4], isSeason), 1);
  assert.equal(seriesStart(3, [1, 2, 3, 4], isSeason), 0);
  assert.equal(seriesStart(4, [1, 2, 3, 4], isSeason), 0);
  assert.equal(seriesStart(6, [6, 7], isSeason), 1, "catena di soli film: il primo");
  assert.equal(seriesStart(7, [6, 7], isSeason), 0);
});

test("build: nuove colonne in coda, nomi di generi e stati nell'intestazione", () => {
  const { index } = build(fixture());
  assert.deepEqual(index.fields.slice(0, 12), ["anilistId", "malId", "title", "altTitle", "type", "year", "episodes", "cover", "score", "popularity", "isSeason", "duration"]);
  assert.deepEqual(index.fields.slice(12), ["genres", "status", "start"]);
  assert.deepEqual(index.genreNames, GENRES);
  assert.deepEqual(index.statusNames, STATUS_NAMES);
  for (const it of index.items) assert.equal(it.length, index.fields.length, "ogni riga ha tutte le colonne");
});

test("build: generi, stato e inizio serie di ogni anime", () => {
  const { index } = build(fixture());
  assert.equal(row(index, 1).genres, genreMask(["Action", "Comedy"]));
  assert.equal(row(index, 5).genres, genreMask(["Romance", "Sci-Fi"]));
  assert.equal(row(index, 5).start, 1, "anime senza serie");
  assert.deepEqual([1, 2, 3, 4].map((id) => row(index, id).start), [0, 1, 0, 0], "serie con OVA pilota: inizia la prima stagione");
  assert.deepEqual([6, 7].map((id) => row(index, id).start), [1, 0], "solo film: il primo");
  const status = (id) => STATUS_NAMES[row(index, id).status];
  assert.equal(status(2), "FINISHED");
  assert.equal(status(3), "RELEASING");
  assert.equal(status(4), "NOT_YET_RELEASED");
  assert.equal(status(5), "HIATUS");
  assert.equal(status(7), "CANCELLED");
  assert.equal(row(index, 8).status, -1, "stato mancante: -1");
});

test("build: le colonne vecchie non cambiano", () => {
  const { index } = build(fixture());
  const r = row(index, 2);
  assert.equal(r.title, "Anime 2");
  assert.equal(r.type, "TV");
  assert.equal(r.year, 2005);
  assert.equal(r.score, 70);
  assert.equal(r.isSeason, 1);
  assert.equal(row(index, 4).type, "Film");
  assert.equal(row(index, 4).isSeason, 0);
});

async function dataDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "animeteca-enrich-"));
  await mkdir(path.join(dir, "d"));
  const { index, shards } = build(fixture());
  // indice "vecchio": solo le 12 colonne originali
  const old = { ...index, fields: index.fields.slice(0, 12), items: index.items.map((r) => r.slice(0, 12)), shards: 2 };
  delete old.genreNames;
  delete old.statusNames;
  const half = [{}, {}];
  shards.forEach((s) => Object.entries(s).forEach(([id, e]) => (half[Number(id) % 2][id] = e)));
  await writeFile(path.join(dir, "anime.json"), JSON.stringify(old));
  await Promise.all(half.map((s, i) => writeFile(path.join(dir, "d", `${i}.json`), JSON.stringify(s))));
  return { dir, old };
}

test("enrich-index: aggiunge generi e inizi di serie a un indice vecchio, senza stato", async () => {
  const { dir, old } = await dataDir();
  await enrich(dir);
  const out = JSON.parse(await readFile(path.join(dir, "anime.json"), "utf8"));
  assert.deepEqual(out.fields.slice(12), ["genres", "start"]);
  assert.deepEqual(out.genreNames, GENRES);
  assert.equal(out.statusNames, undefined, "lo stato non si inventa");
  assert.equal(out.items.length, old.items.length);
  assert.deepEqual(out.items.map((r) => r.slice(0, 12)), old.items, "colonne originali identiche");
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((id) => row(out, id).start), [0, 1, 0, 0, 1, 1, 0]);
  assert.equal(row(out, 1).genres, genreMask(["Action", "Comedy"]));
});

test("enrich-index: rilanciato non cambia nulla e mantiene lo stato se c'è già", async () => {
  const { dir } = await dataDir();
  await enrich(dir);
  const first = await readFile(path.join(dir, "anime.json"), "utf8");
  await enrich(dir);
  assert.equal(await readFile(path.join(dir, "anime.json"), "utf8"), first);

  // indice completo (come quello vero dopo il workflow): lo stato resta
  const { index } = build(fixture());
  await writeFile(path.join(dir, "anime.json"), JSON.stringify({ ...index, shards: 2 }));
  const out = await enrich(dir);
  assert.deepEqual(out.fields.slice(12).sort(), ["genres", "start", "status"]);
  assert.equal(STATUS_NAMES[row(out, 3).status], "RELEASING");
});

test("enrich-index: file mancante o indice senza i campi base -> errore chiaro", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animeteca-enrich-"));
  await assert.rejects(enrich(dir));
  await writeFile(path.join(dir, "anime.json"), JSON.stringify({ fields: ["title"], items: [] }));
  await assert.rejects(enrich(dir), /campo mancante/);
});

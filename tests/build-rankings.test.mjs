// Prova dello script settimanale delle classifiche (scripts/build-rankings.mjs) con un server finto
// al posto del database pubblico manami-project. Avvio: node --test tests/*.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../scripts/build-rankings.mjs";

const FIELDS = ["anilistId", "malId", "title", "altTitle", "type", "year", "episodes", "cover", "score", "popularity", "isSeason", "duration"];
const INDEX = {
  version: 1,
  coverPrefix: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/",
  shards: 64,
  fields: FIELDS,
  items: [
    [1, 101, "Alpha", "", "TV", 2020, 24, "medium/a.jpg", 90, 500000, 1, 24],
    [2, 102, "Beta", "", "TV", 2026, 12, "medium/b.jpg", 84, 40000, 1, 24],
    [65, 0, "Gamma", "", "Film", 2019, 1, "", 88, 30000, 0, 110],
  ],
};
// blocchi dei dettagli: [descrizione, generi, stagioni]; il blocco di Gamma (65 % 64 = 1) c'è, quello di Beta (2) no
const SHARDS = {
  1: { 1: ["desc", ["Action", "Drama"], []], 65: ["desc", ["Romance"], []] },
};
const SITES_DB = {
  lastUpdate: "2026-07-04",
  data: [
    { title: "Alpha", status: "FINISHED", sources: ["https://anilist.co/anime/1", "https://myanimelist.net/anime/101"], score: { arithmeticGeometricMean: 8.79, arithmeticMean: 8.8, median: 8.9 } },
    { title: "Beta", status: "FINISHED", sources: ["https://myanimelist.net/anime/102", "https://anilist.co/anime/2"], score: { arithmeticGeometricMean: 7.99, arithmeticMean: 8.0, median: 8.0 } },
    // ancora in corso quando è stato fatto il database pubblico: voto di pochi spettatori, non si usa
    { title: "Gamma", status: "ONGOING", sources: ["https://anilist.co/anime/65"], score: { arithmeticGeometricMean: 10, arithmeticMean: 10, median: 10 } },
  ],
};

let server;
let base;
let mode = "ok"; // "ok" | "down" | "flaky"
let hits = 0;
before(async () => {
  server = http.createServer((req, res) => {
    hits++;
    if (mode === "down" || (mode === "flaky" && hits === 1)) {
      res.writeHead(500).end("errore");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(SITES_DB));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function dataDir() {
  const dir = await mkdtemp(path.join(tmpdir(), "rank-db-"));
  await mkdir(path.join(dir, "d"));
  await writeFile(path.join(dir, "anime.json"), JSON.stringify(INDEX));
  for (const [n, shard] of Object.entries(SHARDS)) await writeFile(path.join(dir, "d", `${n}.json`), JSON.stringify(shard));
  return dir;
}
const run = async (dir) => main({ DATA_DIR: dir, SITES_URL: `${base}/db.json`, NOW: "2026-11-20T12:00:00Z", RETRY_MS: "0" });
const written = async (dir) => JSON.parse(await readFile(path.join(dir, "rankings.json"), "utf8"));

test("scrive rankings.json con la media tra AniList e la media dei siti (solo anime finiti)", async () => {
  mode = "ok";
  hits = 0;
  const dir = await dataDir();
  await run(dir);
  const r = await written(dir);
  assert.equal(r.sources.sites, true);
  assert.equal(r.sitesUpdated, "2026-07-04");
  assert.deepEqual(r.items["mal-101"].slice(7), [8.9, 9, 8.8]);
  assert.deepEqual(r.items["al-65"].slice(7), [8.8, 8.8, null]);
  assert.deepEqual(r.top, ["mal-101", "al-65", "mal-102"]);
  assert.deepEqual(r.genres.Action, ["mal-101"]);
  assert.deepEqual(r.genres.Romance, ["al-65"]);
  assert.deepEqual(r.years["2026"], ["mal-102"]);
});

test("se il database dei siti non risponde: classifiche solo AniList, nessun errore", async () => {
  mode = "down";
  hits = 0;
  const dir = await dataDir();
  await run(dir);
  const r = await written(dir);
  assert.equal(r.sources.sites, false);
  assert.equal(r.sitesUpdated, null);
  assert.deepEqual(r.top, ["mal-101", "al-65", "mal-102"]);
  assert.equal(r.items["mal-101"][9], null);
  assert.equal(hits, 4);
});

test("un errore momentaneo: riprova e prende i voti", async () => {
  mode = "flaky";
  hits = 0;
  const dir = await dataDir();
  await run(dir);
  const r = await written(dir);
  assert.equal(r.sources.sites, true);
  assert.equal(hits, 2);
});

// Prove dei filtri della scheda Scopri (discover-core.js). Avvio: node --test tests/*.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import D from "../discover-core.js";

const GENRES = ["Action", "Adventure", "Comedy", "Drama", "Romance"];
const STATUSES = ["FINISHED", "RELEASING", "NOT_YET_RELEASED", "CANCELLED", "HIATUS"];
const bits = (...g) => g.reduce((m, x) => m | (1 << GENRES.indexOf(x)), 0);
const CAPS = { genres: true, status: true, start: true, genreNames: GENRES };
const OPTS = { genreNames: GENRES, statusNames: STATUSES, thisYear: 2026 };

function anime(id, over = {}) {
  return { id, title: id, type: "TV", year: 2015, episodes: 12, _score: 75, _pop: 50000, _genres: bits("Action"), _status: 0, _start: 1, ...over };
}
const ids = (list) => list.map((a) => a.id);
const run = (items, f, opts = OPTS) => ids(D.filterAnime(items, { ...D.DEFAULTS, ...f }, opts));

const SET = [
  anime("tv-action", { _score: 82, _pop: 900000 }),
  anime("film", { type: "Film", episodes: 1, year: 2020, _genres: bits("Drama", "Romance"), _score: 88, _pop: 300000 }),
  anime("ova", { type: "OVA", episodes: 3, year: 1995, _genres: bits("Action", "Adventure"), _score: 65, _pop: 5000 }),
  anime("long-running", { episodes: 220, year: 2002, _genres: bits("Action", "Adventure", "Comedy"), _status: 1, _pop: 700000 }),
  anime("sequel", { year: 2024, _start: 0, _genres: bits("Action"), _status: 1, _pop: 120000 }),
  anime("upcoming", { year: 2026, _status: 2, _score: 0, _pop: 12000, episodes: null }),
  anime("no-data", { year: null, episodes: null, _score: 0, _pop: 0, _genres: null, _status: null, _start: null, type: "" }),
];

test("nessun filtro: tutti gli anime", () => {
  assert.equal(run(SET, {}).length, SET.length);
});

test("formato: più scelte insieme (o)", () => {
  assert.deepEqual(run(SET, { formats: ["Film"] }), ["film"]);
  assert.deepEqual(run(SET, { formats: ["Film", "OVA"] }), ["film", "ova"]);
});

test("anno: ultimi 5 anni, decenni e prima del 1980", () => {
  assert.deepEqual(run(SET, { year: "last5" }), ["sequel", "upcoming"], "con il 2026: dal 2022 in poi");
  assert.deepEqual(run(SET, { year: "2020" }), ["film", "sequel", "upcoming"], "il decennio 2020 comprende anche il film del 2020");
  assert.deepEqual(run(SET, { year: "2010" }), ["tv-action"]);
  assert.deepEqual(run(SET, { year: "2000" }), ["long-running"]);
  assert.deepEqual(run(SET, { year: "1990" }), ["ova"]);
  assert.deepEqual(run(SET, { year: "old" }), [], "nessun anime prima del 1980 nel gruppo");
  assert.deepEqual(run([anime("vecchio", { year: 1967 })], { year: "old" }), ["vecchio"]);
});

test("episodi: fasce, e chi non li ha non compare", () => {
  assert.deepEqual(run(SET, { episodes: "1" }), ["film"]);
  assert.deepEqual(run(SET, { episodes: "2-13" }), ["tv-action", "ova", "sequel"]);
  assert.deepEqual(run(SET, { episodes: "27+" }), ["long-running"]);
  assert.deepEqual(run([anime("a", { episodes: 14 }), anime("b", { episodes: 26 }), anime("c", { episodes: 27 })], { episodes: "14-26" }), ["a", "b"]);
});

test("voto minimo: chi non ha voto non compare", () => {
  assert.deepEqual(run(SET, { score: 80 }), ["tv-action", "film"]);
  assert.deepEqual(run(SET, { score: 60 }).includes("upcoming"), false);
  assert.deepEqual(run(SET, { score: 60 }).includes("no-data"), false);
});

test("notorietà", () => {
  assert.deepEqual(run(SET, { fame: "famous" }), ["tv-action", "film", "long-running", "sequel"]);
  assert.equal(run(SET, { fame: "known" }).includes("ova"), false, "5.000 sotto la soglia dei 10.000");
});

test("generi: bisogna averli tutti (e)", () => {
  assert.deepEqual(run(SET, { genres: ["Action"] }), ["tv-action", "ova", "long-running", "sequel", "upcoming"]);
  assert.deepEqual(run(SET, { genres: ["Action", "Adventure"] }), ["ova", "long-running"]);
  assert.deepEqual(run(SET, { genres: ["Action", "Adventure", "Comedy"] }), ["long-running"]);
  assert.deepEqual(run(SET, { genres: ["Drama", "Action"] }), [], "nessuno li ha entrambi");
  assert.equal(run(SET, { genres: ["Action"] }).includes("no-data"), false, "senza generi noti non compare");
});

test("genere che il database non conosce: nessun risultato, senza errori", () => {
  assert.deepEqual(run(SET, { genres: ["Mecha"] }), []);
});

test("stato: più scelte insieme", () => {
  assert.deepEqual(run(SET, { status: ["RELEASING"] }), ["long-running", "sequel"]);
  assert.deepEqual(run(SET, { status: ["RELEASING", "NOT_YET_RELEASED"] }), ["long-running", "sequel", "upcoming"]);
  assert.equal(run(SET, { status: ["FINISHED"] }).includes("no-data"), false);
});

test("inizi di serie: niente seguiti", () => {
  const r = run(SET, { starts: true });
  assert.equal(r.includes("sequel"), false);
  assert.equal(r.includes("no-data"), false);
  assert.equal(r.includes("tv-action"), true);
});

test("la mia lista: nasconde gli anime già salvati", () => {
  const mine = new Set(["tv-action", "film"]);
  assert.equal(run(SET, { hideMine: true }, { ...OPTS, mine }).length, SET.length - 2);
  assert.equal(run(SET, { hideMine: false }, { ...OPTS, mine }).length, SET.length, "spento: non nasconde niente");
});

test("più filtri insieme", () => {
  assert.deepEqual(run(SET, { formats: ["TV"], genres: ["Action"], score: 80 }), ["tv-action"]);
  assert.deepEqual(run(SET, { formats: ["TV"], year: "last5", status: ["RELEASING"], starts: true }), [], "l'unico in onda recente è un seguito");
  assert.deepEqual(run(SET, { formats: ["TV"], year: "last5", status: ["RELEASING"] }), ["sequel"]);
  assert.deepEqual(run(SET, { formats: ["Film"], genres: ["Action"] }), [], "combinazione senza risultati");
});

test("database senza i campi nuovi: i filtri di base funzionano, gli altri non trovano nulla", () => {
  const old = SET.map((a) => ({ ...a, _genres: null, _status: null, _start: null }));
  assert.deepEqual(run(old, { formats: ["Film"] }), ["film"]);
  assert.deepEqual(run(old, { genres: ["Action"] }), []);
});

test("ordine: popolarità, voto (senza voto in fondo), più recenti", () => {
  const by = (sort) => ids(D.sortAnime([...SET], sort));
  assert.deepEqual(by("pop").slice(0, 3), ["tv-action", "long-running", "film"]);
  assert.deepEqual(by("score").slice(0, 3), ["film", "tv-action", "long-running"], "a parità di voto (75) vince il più popolare");
  assert.deepEqual(by("score").slice(-2).sort(), ["no-data", "upcoming"], "senza voto in fondo");
  assert.deepEqual(by("new").slice(0, 3), ["upcoming", "sequel", "film"]);
  assert.equal(by("new").at(-1), "no-data", "senza anno in fondo");
  assert.deepEqual(by("boh"), by("pop"), "ordine sconosciuto: popolarità");
});

test("normalize: preferenze rovinate o vecchie diventano valori sicuri", () => {
  assert.deepEqual(D.normalize(null, CAPS), D.DEFAULTS);
  assert.deepEqual(D.normalize("x", CAPS), D.DEFAULTS);
  assert.deepEqual(D.normalize([1, 2], CAPS), D.DEFAULTS);
  const f = D.normalize({ formats: ["TV", "Boh"], year: "3000", episodes: "x", score: 99, fame: "?", genres: ["Action", "Boh"], status: ["Boh"], sort: "boh", starts: 1, hideMine: "si" }, CAPS);
  assert.deepEqual(f, { ...D.DEFAULTS, formats: ["TV"], genres: ["Action"] });
});

test("normalize: i gruppi che il database non offre vengono tolti", () => {
  const saved = { genres: ["Action"], status: ["FINISHED"], starts: true, formats: ["TV"] };
  const f = D.normalize(saved, { genres: false, status: false, start: false });
  assert.deepEqual(f, { ...D.DEFAULTS, formats: ["TV"] });
});

test("toggle: più scelte, una scelta, interruttori, ordine", () => {
  let f = D.normalize({}, CAPS);
  f = D.toggle(f, "formats", "TV", CAPS);
  f = D.toggle(f, "formats", "Film", CAPS);
  assert.deepEqual(f.formats, ["TV", "Film"]);
  f = D.toggle(f, "formats", "TV", CAPS);
  assert.deepEqual(f.formats, ["Film"]);
  f = D.toggle(f, "year", "2010", CAPS);
  f = D.toggle(f, "year", "2000", CAPS);
  assert.equal(f.year, "2000", "una sola scelta: la nuova sostituisce");
  f = D.toggle(f, "year", "2000", CAPS);
  assert.equal(f.year, "", "stesso tocco: si toglie");
  f = D.toggle(f, "starts", true, CAPS);
  assert.equal(f.starts, true);
  f = D.toggle(f, "starts", true, CAPS);
  assert.equal(f.starts, false);
  f = D.toggle(f, "sort", "score", CAPS);
  assert.equal(f.sort, "score");
  const g = D.toggle(D.toggle(D.normalize({}, CAPS), "genres", "Drama", CAPS), "genres", "Action", CAPS);
  assert.deepEqual(g.genres, ["Action", "Drama"], "generi sempre nell'ordine del database");
});

test("toggle non modifica i filtri di partenza", () => {
  const f = D.normalize({ formats: ["TV"] }, CAPS);
  D.toggle(f, "formats", "Film", CAPS);
  assert.deepEqual(f.formats, ["TV"]);
  assert.deepEqual(D.DEFAULTS.formats, []);
});

test("activeFilters e clear: elenco dei filtri attivi, azzeramento che tiene l'ordine", () => {
  const f = D.normalize({ formats: ["TV"], year: "last5", episodes: "2-13", score: 70, fame: "known", genres: ["Drama"], status: ["FINISHED"], starts: true, hideMine: true, sort: "score" }, CAPS);
  const active = D.activeFilters(f, { genreLabel: (g) => (g === "Drama" ? "Drammatico" : g) });
  assert.deepEqual(
    active.map((a) => a.label),
    ["TV", "Ultimi 5 anni", "Brevi · 2-13", "Voto 7+", "Noti", "Drammatico", "Concluso", "Inizi di serie", "Non nella mia lista"]
  );
  assert.deepEqual(D.activeFilters(D.DEFAULTS), []);
  const cleared = D.clear(f);
  assert.deepEqual(D.activeFilters(cleared), []);
  assert.equal(cleared.sort, "score");
});

test("prestazioni: 17.600 anime con più filtri e ordinamento in pochi millisecondi", () => {
  const big = Array.from({ length: 17600 }, (_, i) =>
    anime(`a${i}`, { type: ["TV", "Film", "OVA", "ONA", "Special"][i % 5], year: 1960 + (i % 66), episodes: i % 90 || null, _score: i % 100, _pop: 100000 - i * 5, _genres: i % 32 })
  );
  const f = D.normalize({ formats: ["TV", "ONA"], year: "2010", episodes: "2-13", score: 60, genres: ["Action", "Adventure"], starts: true }, CAPS);
  const t0 = performance.now();
  for (let i = 0; i < 10; i++) D.sortAnime(D.filterAnime(big, f, OPTS), "score");
  const each = (performance.now() - t0) / 10;
  assert.ok(each < 50, `troppo lento: ${each.toFixed(1)} ms`);
  // verifica incrociata con un calcolo scritto a parte
  const expected = big.filter(
    (a) => ["TV", "ONA"].includes(a.type) && a.year >= 2010 && a.year <= 2019 && a.episodes >= 2 && a.episodes <= 13 && a._score >= 60 && (a._genres & 3) === 3 && a._start === 1
  );
  assert.equal(D.filterAnime(big, f, OPTS).length, expected.length);
});

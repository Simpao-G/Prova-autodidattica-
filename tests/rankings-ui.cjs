// Prova nel browser della sezione Classifiche (iPhone e iPad). Avvio: node tests/rankings-ui.cjs [cartella-screenshot]
// Serve l'app dalla cartella del progetto con un data/rankings.json e un data/anime.json finti.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");

const ROOT = path.join(__dirname, "..");
const OUT = process.argv[2] || null;
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const PREFIX = "https://s4.anilist.co/file/anilistcdn/media/anime/cover/";
const LONG = "Un titolo lunghissimo " + "Supercalifragilistichespiralidoso".repeat(5) + " fine";

function rankingsFixture(over = {}) {
  const items = {
    "mal-52991": [154587, 52991, "Frieren: Beyond Journey's End", "TV", 2023, 28, "medium/frieren.jpg", 9.06, 9, 9.11],
    "mal-5114": [5114, 5114, "Fullmetal Alchemist: Brotherhood", "TV", 2009, 64, "medium/fma.jpg", 9, 9, 8.99],
    "mal-9253": [9253, 9253, "Steins;Gate", "TV", 2011, 24, "medium/sg.jpg", 8.9, 8.9, 8.9],
    "al-777": [777, 0, LONG, "TV", 2026, 12, "", 8.5, 8.5, null],
    "mal-31000": [31000, 31000, "Amore di prova", "TV", 2025, 12, "", 8.1, 8.2, 8],
  };
  const y2026 = ["al-777", "mal-26001", "mal-26002"];
  const y2025 = ["mal-31000"];
  for (const id of y2026.slice(1)) items[id] = [Number(id.slice(4)), Number(id.slice(4)), `Nuovo ${id}`, "TV", 2026, 12, "", 8, 8, null];
  for (let i = 1; i < 20; i++) {
    const id = `mal-${25000 + i}`;
    y2025.push(id);
    items[id] = [25000 + i, 25000 + i, `Anno scorso ${i}`, "TV", 2025, 12, "", 8 - i / 100, 8, null];
  }
  return {
    version: 1,
    updated: "2026-11-16T03:40:00.000Z",
    coverPrefix: PREFIX,
    sitesUpdated: "2026-07-04",
    sources: { sites: true },
    items,
    top: ["mal-52991", "mal-5114", "mal-9253", "al-777"],
    genres: { Action: ["mal-5114", "mal-52991"], Romance: ["mal-31000"], Mystery: ["mal-9253"] },
    years: { 2026: y2026, 2025: y2025, 2024: [], 2023: ["mal-52991"], 2022: [] },
    ...over,
  };
}
const DB = {
  version: 1,
  updated: "2026-11-16",
  coverPrefix: PREFIX,
  shards: 64,
  fields: ["anilistId", "malId", "title", "altTitle", "type", "year", "episodes", "cover", "score", "popularity", "isSeason", "duration"],
  items: [
    [154587, 52991, "Frieren: Beyond Journey's End", "Sousou no Frieren", "TV", 2023, 28, "medium/frieren.jpg", 90, 600000, 1, 24],
    [5114, 5114, "Fullmetal Alchemist: Brotherhood", "Hagane no Renkinjutsushi", "TV", 2009, 64, "medium/fma.jpg", 90, 900000, 1, 24],
    [9253, 9253, "Steins;Gate", "", "TV", 2011, 24, "medium/sg.jpg", 89, 800000, 1, 24],
  ],
};

async function open(browser, deviceName, rankingsBody, seed) {
  const ctx = await browser.newContext({ ...devices[deviceName], serviceWorkers: "block" });
  await ctx.route("https://app.test/**", (route) => {
    let p = new URL(route.request().url()).pathname;
    if (p === "/") p = "/index.html";
    if (p === "/config.js") return route.fulfill({ contentType: "application/javascript", body: "window.ANIMETECA_CONFIG={};" });
    if (p === "/data/rankings.json") {
      return rankingsBody === null ? route.fulfill({ status: 404, body: "" }) : route.fulfill({ contentType: "application/json", body: JSON.stringify(rankingsBody) });
    }
    if (p === "/data/anime.json") return route.fulfill({ contentType: "application/json", body: JSON.stringify(DB) });
    if (p.startsWith("/data/")) return route.fulfill({ status: 404, body: "" });
    const f = path.join(ROOT, p);
    if (!fs.existsSync(f)) return route.fulfill({ status: 404, body: "" });
    route.fulfill({ body: fs.readFileSync(f), contentType: TYPES[path.extname(f)] || "text/plain" });
  });
  await ctx.route(/s4\.anilist\.co/, (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 3"><rect width="2" height="3" fill="#3d5a6c"/></svg>' }));
  await ctx.route(/graphql\.anilist\.co|jikan\.moe/, (route) => route.fulfill({ status: 404, body: "" }));
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto("https://app.test/");
  if (seed) {
    await page.evaluate((list) => localStorage.setItem("animeteca.v1", JSON.stringify(list)), seed);
    await page.reload();
  }
  return page;
}
const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, " ").trim());
async function openRankings(page) {
  await page.click("#rankBtn");
  await page.waitForSelector("#rankSheet.open");
  await page.waitForFunction(() => !document.querySelector("#rankBody .spinner") && document.querySelector("#rankBody").textContent.trim());
}

(async () => {
  const browser = await chromium.launch();
  const steins = { id: "mal-9253", alId: 9253, title: "Steins;Gate", type: "TV", episodes: 24, ep: 24, status: "done", genres: [], updatedAt: Date.now(), addedAt: Date.now() };
  try {
    // iPhone: barra in alto, Migliori, Generi, Anno, scheda
    const phone = await open(browser, "iPhone 13", rankingsFixture(), [steins]);
    assert.equal(await phone.evaluate(() => getComputedStyle(document.querySelector(".brand-name")).display), "none", "scritta animeteca nascosta su iPhone");
    assert.ok(
      await phone.evaluate(() => {
        const bar = document.querySelector(".topbar").getBoundingClientRect();
        return [...document.querySelectorAll(".topbar button")].every((b) => b.getBoundingClientRect().right <= bar.right - 8);
      }),
      "tutti i pulsanti dentro la barra"
    );
    await openRankings(phone);
    assert.equal(await phone.locator("#rankBody .rank-row").count(), 4, "4 righe in Migliori");
    const first = await text(phone, "#rankBody .rank-row >> nth=0");
    assert.match(first, /^1\b/, "numero 1");
    assert.match(first, /Frieren/);
    assert.match(first, /9,1/, "voto medio con una cifra decimale");
    assert.match(first, /AniList 9,0 · Media siti 9,1/);
    assert.match(await text(phone, '#rankBody .rank-row[data-rid="mal-9253"]'), /Visto/, "stato dell'anime già nella lista");
    assert.doesNotMatch(await text(phone, '#rankBody .rank-row[data-rid="al-777"]'), /Media siti/, "senza media dei siti mostra solo AniList");
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "niente scorrimento orizzontale con un titolo lunghissimo");
    if (OUT) await phone.screenshot({ path: path.join(OUT, "rank-top-iphone.png") });

    await phone.click('#rankBody [data-rtab="genres"]');
    assert.match(await text(phone, "#rankBody .rank-chip.active"), /Azione/, "genere di partenza: Azione");
    await phone.click('#rankBody .rank-chip[data-genre="Romance"]');
    assert.deepEqual(await phone.$$eval("#rankBody .rank-row", (rows) => rows.map((r) => r.dataset.rid)), ["mal-31000"]);
    assert.match(await text(phone, "#rankBody .rank-chip.active"), /Sentimentale/);
    if (OUT) await phone.screenshot({ path: path.join(OUT, "rank-genres-iphone.png") });

    await phone.click('#rankBody [data-rtab="year"]');
    assert.equal(await text(phone, "#rankBody .rank-chip.active"), "2025", "con meno di 10 titoli nell'anno più recente si parte dal precedente");
    assert.equal(await phone.locator("#rankBody .rank-row").count(), 20);
    await phone.click('#rankBody .rank-chip[data-year="2026"]');
    assert.equal(await phone.locator("#rankBody .rank-row").count(), 3);
    await phone.click('#rankBody .rank-chip[data-year="2024"]');
    assert.match(await text(phone, "#rankBody"), /Nessun titolo/);

    // tocco su una riga: si apre la scheda sopra le classifiche
    await phone.click('#rankBody [data-rtab="top"]');
    await phone.click('#rankBody .rank-row[data-rid="mal-52991"]');
    await phone.waitForSelector("#detailSheet.open");
    assert.match(await text(phone, ".detail-title"), /Frieren/);
    assert.match(await text(phone, ".alt-title"), /Sousou no Frieren/, "dati presi dal database dell'app");
    assert.ok(await phone.evaluate(() => document.querySelector("#rankSheet").compareDocumentPosition(document.querySelector("#detailSheet")) & Node.DOCUMENT_POSITION_FOLLOWING), "scheda sopra le classifiche");
    if (OUT) await phone.screenshot({ path: path.join(OUT, "rank-detail-iphone.png") });
    await phone.keyboard.press("Escape");
    await phone.waitForSelector("#detailSheet:not(.open)");
    // anime che non è nel database dell'app: la scheda si apre con i dati della classifica
    await phone.click('#rankBody .rank-row[data-rid="al-777"]');
    await phone.waitForSelector("#detailSheet.open");
    assert.match(await text(phone, ".detail-title"), /Un titolo lunghissimo/);
    assert.deepEqual(phone.errors, [], "nessun errore nella pagina (iPhone)");

    // file mancante o di formato sconosciuto
    for (const body of [null, { version: 99 }]) {
      const p = await open(browser, "iPhone 13", body);
      await openRankings(p);
      assert.match(await text(p, "#rankBody"), /Le classifiche arrivano con il prossimo aggiornamento/);
      assert.deepEqual(p.errors, []);
      await p.context().close();
    }
    // media dei siti non disponibile questa settimana
    const noSites = await open(browser, "iPhone 13", rankingsFixture({ sources: { sites: false }, sitesUpdated: null }));
    await openRankings(noSites);
    assert.match(await text(noSites, "#rankBody"), /Questa settimana solo AniList/);
    await noSites.context().close();

    // iPad
    const pad = await open(browser, "iPad Pro 11", rankingsFixture());
    assert.notEqual(await pad.evaluate(() => getComputedStyle(document.querySelector(".brand-name")).display), "none", "su iPad la scritta resta");
    await openRankings(pad);
    assert.equal(await pad.locator("#rankBody .rank-row").count(), 4);
    if (OUT) await pad.screenshot({ path: path.join(OUT, "rank-top-ipad.png") });
    assert.deepEqual(pad.errors, []);
    console.log("Classifiche nel browser: tutte le prove superate");
  } catch (err) {
    console.error("FALLITO:", err.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();

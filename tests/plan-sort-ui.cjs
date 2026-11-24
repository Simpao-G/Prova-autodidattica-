// Prova nel browser dell'ordinamento di "Da vedere" (T4.1). Avvio: node tests/plan-sort-ui.cjs [cartella-screenshot]
// Serve l'app dalla cartella del progetto con un data/anime.json finto; nessuna rete, nessun account.
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");

const ROOT = path.join(__dirname, "..");
const OUT = process.argv[2] || null;
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

// Alpha non ha il voto nella lista: lo prende dal database (70 -> 7,0)
const DB = {
  version: 1,
  updated: "2026-11-16",
  coverPrefix: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/",
  shards: 64,
  fields: ["anilistId", "malId", "title", "altTitle", "type", "year", "episodes", "cover", "score", "popularity", "isSeason", "duration"],
  items: [[1, 1, "Alpha Lunga", "", "TV", 2010, 50, "", 70, 100000, 1, 24]],
};
const plan = (id, title, extra) => ({ id, title, status: "plan", ep: 0, type: "TV", ...extra });
const SEED = [
  plan("mal-1", "Alpha Lunga", { episodes: 50, duration: 24, year: 2010, addedAt: 1000, updatedAt: 5000 }),
  plan("mal-2", "Beta Breve", { episodes: 12, duration: 24, score: "8.5", year: 2020, addedAt: 3000, updatedAt: 4000 }),
  plan("mal-3", "Gamma Film", { type: "Film", episodes: 1, duration: 100, score: "9.0", year: 2015, addedAt: 2000, updatedAt: 3000 }),
  plan("mal-4", "Delta Ignoto", { addedAt: 4000, updatedAt: 6000 }),
  { id: "mal-5", title: "Epsilon In Corso", status: "watching", ep: 3, type: "TV", episodes: 12, addedAt: 10, updatedAt: 10 },
  { id: "mal-6", title: "Zeta Visto", status: "done", ep: 12, type: "TV", episodes: 12, addedAt: 20, updatedAt: 20 },
];

async function open(browser, deviceName, seed) {
  const ctx = await browser.newContext({ ...devices[deviceName], serviceWorkers: "block" });
  await ctx.route("https://app.test/**", (route) => {
    let p = new URL(route.request().url()).pathname;
    if (p === "/") p = "/index.html";
    if (p === "/config.js") return route.fulfill({ contentType: "application/javascript", body: "window.ANIMETECA_CONFIG={};" });
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
  page.on("console", (m) => m.type() === "error" && !/404/.test(m.text()) && page.errors.push(m.text()));
  await page.goto("https://app.test/");
  await page.evaluate((list) => localStorage.setItem("animeteca.v1", JSON.stringify(list)), seed);
  await page.reload();
  return page;
}

const titles = (page) => page.$$eval("#grid .card .title", (els) => els.map((e) => e.textContent.trim()));
const subs = (page) => page.$$eval("#grid .card", (els) => Object.fromEntries(els.map((e) => [e.querySelector(".title").textContent.trim(), e.querySelector(".sub").textContent.replace(/\s+/g, " ").trim()])));
const store = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
async function toPlan(page) {
  await page.click('.tab[data-tab="plan"]');
  await page.waitForSelector("#grid .card");
  // il database arriva dopo: attende che il tempo totale sia calcolato
  await page.waitForFunction(() => /ep\./.test(document.querySelector("#grid").textContent));
}
async function pick(page, mode) {
  await page.click(`#grid [data-sort="${mode}"]`);
  await page.waitForSelector(`#grid [data-sort="${mode}"].active`);
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const device of ["iPhone SE", "iPad (gen 7)"]) {
      const page = await open(browser, device, SEED);
      assert.equal(await page.locator(".sort-row").count(), 0, `${device}: nessuna riga di ordinamento in In corso`);
      await toPlan(page);
      const listBefore = await store(page, "animeteca.v1");

      // ordine di sempre (ultima modifica) e riga di chip
      assert.equal(await page.locator("#grid .sort-row [data-sort]").count(), 5, `${device}: 5 modi di ordinare`);
      assert.match(await page.textContent("#grid .sort-row .active"), /Recenti/);
      assert.deepEqual(await titles(page), ["Delta Ignoto", "Alpha Lunga", "Beta Breve", "Gamma Film"], `${device}: Recenti`);

      // tempo totale stimato sotto i poster
      const s = await subs(page);
      assert.equal(s["Beta Breve"], "12 ep. · 4 h 48 min", "serie con episodi e durata");
      assert.equal(s["Alpha Lunga"], "50 ep. · 20 h", "numero di episodi e durata dal database");
      assert.equal(s["Gamma Film"], "Film · 1 h 40 min", "film: formato e durata");
      assert.equal(s["Delta Ignoto"], "TV", "senza episodi: resta il formato");

      await pick(page, "added");
      assert.deepEqual(await titles(page), ["Delta Ignoto", "Beta Breve", "Gamma Film", "Alpha Lunga"], `${device}: Aggiunti`);
      await pick(page, "score");
      assert.deepEqual(await titles(page), ["Gamma Film", "Beta Breve", "Alpha Lunga", "Delta Ignoto"], `${device}: Voto (senza voto in fondo, voto dal database)`);
      await pick(page, "short");
      assert.deepEqual(await titles(page), ["Gamma Film", "Beta Breve", "Alpha Lunga", "Delta Ignoto"], `${device}: Più brevi`);
      await pick(page, "year");
      assert.deepEqual(await titles(page), ["Beta Breve", "Gamma Film", "Alpha Lunga", "Delta Ignoto"], `${device}: Anno`);
      assert.ok(await noOverflow(page), `${device}: niente scorrimento orizzontale`);
      if (OUT) await page.screenshot({ path: path.join(OUT, `plan-sort-${device.replace(/\W+/g, "-")}.png`) });

      // la lista dell'utente non cambia: l'ordine è solo una preferenza locale
      assert.equal(await store(page, "animeteca.v1"), listBefore, `${device}: animeteca.v1 invariata`);
      assert.deepEqual(JSON.parse(await store(page, "animeteca.prefs.v1")), { planSort: "year" });

      // l'ordine scelto resta dopo aver ricaricato l'app
      await page.reload();
      await toPlan(page);
      assert.match(await page.textContent("#grid .sort-row .active"), /Anno/, `${device}: scelta ricordata`);
      assert.deepEqual(await titles(page), ["Beta Breve", "Gamma Film", "Alpha Lunga", "Delta Ignoto"]);

      // le altre schede non cambiano
      await page.click('.tab[data-tab="done"]');
      assert.equal(await page.locator(".sort-row").count(), 0, "nessuna riga in Visti");
      assert.deepEqual(await titles(page), ["Zeta Visto"]);
      await page.click('.tab[data-tab="watching"]');
      assert.equal(await page.locator(".sort-row").count(), 0, "nessuna riga in In corso");
      assert.deepEqual(await titles(page), ["Epsilon In Corso"]);
      assert.deepEqual(page.errors, [], `${device}: nessun errore in console`);
      await page.context().close();
    }

    // preferenza rovinata o valore sconosciuto: si torna a Recenti, senza errori
    const bad = await open(browser, "iPhone SE", SEED);
    await bad.evaluate(() => localStorage.setItem("animeteca.prefs.v1", '{"planSort":"boh"}'));
    await bad.reload();
    await toPlan(bad);
    assert.match(await bad.textContent("#grid .sort-row .active"), /Recenti/);
    await bad.evaluate(() => localStorage.setItem("animeteca.prefs.v1", "[1,2"));
    await bad.reload();
    await toPlan(bad);
    assert.deepEqual(await titles(bad), ["Delta Ignoto", "Alpha Lunga", "Beta Breve", "Gamma Film"]);
    assert.deepEqual(bad.errors, [], "nessun errore con preferenze rovinate");
    await bad.context().close();

    // un solo anime da vedere: niente riga di ordinamento
    const one = await open(browser, "iPhone SE", [SEED[0]]);
    await one.click('.tab[data-tab="plan"]');
    await one.waitForSelector("#grid .card");
    assert.equal(await one.locator(".sort-row").count(), 0, "con un solo anime niente ordinamento");
    await one.context().close();

    console.log("Da vedere (ordinamento): tutte le prove superate");
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Prova nel browser della scheda Scopri (filtri). Avvio: node tests/discover-ui.cjs [cartella-screenshot]
// Serve l'app dalla cartella del progetto con un data/anime.json finto (130 anime); nessuna rete, nessun account.
// Tre varianti dell'indice: "full" (con genres, status, start), "noStatus" (come i dati reali arricchiti in locale), "old" (12 colonne).
const { chromium, devices } = require("playwright");
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");

const ROOT = path.join(__dirname, "..");
const OUT = process.argv[2] || null;
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const GENRES = ["Action", "Adventure", "Comedy", "Drama", "Ecchi", "Fantasy", "Horror", "Mahou Shoujo", "Mecha", "Music", "Mystery", "Psychological", "Romance", "Sci-Fi", "Slice of Life", "Sports", "Supernatural", "Thriller"];
const STATUS_NAMES = ["FINISHED", "RELEASING", "NOT_YET_RELEASED", "CANCELLED", "HIATUS"];
const TYPE_LIST = ["TV", "Film", "OVA", "ONA", "Special"];
const bit = (g) => 1 << GENRES.indexOf(g);

// 130 anime con dati che variano in modo regolare: così i conteggi attesi si calcolano qui, a parte
const FX = Array.from({ length: 130 }, (_, i) => {
  const type = TYPE_LIST[i % 5];
  return {
    al: 1000 + i,
    title: `Anime ${i}`,
    type,
    year: 1985 + ((i * 7) % 42),
    episodes: type === "Film" ? 1 : 1 + ((i * 5) % 60),
    score: 55 + ((i * 3) % 40),
    pop: 200000 - i * 1500,
    genres: (1 << (i % 18)) | (1 << ((i * 5 + 3) % 18)),
    status: i % 5,
    start: i % 3 === 0 ? 0 : 1,
  };
});
const count = (pred) => FX.filter(pred).length;
const has = (a, g) => (a.genres & bit(g)) === bit(g);

function dbFixture(variant) {
  const base = ["anilistId", "malId", "title", "altTitle", "type", "year", "episodes", "cover", "score", "popularity", "isSeason", "duration"];
  const extra = variant === "old" ? [] : variant === "noStatus" ? ["genres", "start"] : ["genres", "status", "start"];
  const db = {
    version: 1,
    updated: "2026-11-16",
    coverPrefix: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/",
    shards: 64,
    fields: [...base, ...extra],
    items: FX.map((a) => {
      const row = [a.al, a.al, a.title, "", a.type, a.year, a.episodes, "", a.score, a.pop, a.type === "TV" || a.type === "ONA" ? 1 : 0, 24];
      const by = { genres: a.genres, status: a.status, start: a.start };
      return [...row, ...extra.map((n) => by[n])];
    }),
  };
  if (variant !== "old") db.genreNames = GENRES;
  if (variant === "full") db.statusNames = STATUS_NAMES;
  return db;
}

async function open(browser, deviceName, variant = "full", seed = null) {
  const ctx = await browser.newContext({ ...devices[deviceName], serviceWorkers: "block" });
  await ctx.route("https://app.test/**", (route) => {
    let p = new URL(route.request().url()).pathname;
    if (p === "/") p = "/index.html";
    if (p === "/config.js") return route.fulfill({ contentType: "application/javascript", body: "window.ANIMETECA_CONFIG={};" });
    if (p === "/data/anime.json") {
      return variant === "missing" ? route.fulfill({ status: 404, body: "" }) : route.fulfill({ contentType: "application/json", body: JSON.stringify(dbFixture(variant)) });
    }
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
  if (seed) {
    await page.evaluate((list) => localStorage.setItem("animeteca.v1", JSON.stringify(list)), seed);
    await page.reload();
  }
  return page;
}

const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, " ").trim());
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
const store = (page, key) => page.evaluate((k) => localStorage.getItem(k), key);
const countText = (page) => text(page, "#rankBody .disc-count");
const rowTitles = (page) => page.$$eval("#rankBody .rank-row .r-title", (els) => els.map((e) => e.textContent.trim()));

async function openScopri(page) {
  await page.click("#rankBtn");
  await page.waitForSelector("#rankSheet.open");
  await page.waitForSelector('#rankBody [data-rtab="discover"]');
  await page.click('#rankBody [data-rtab="discover"]');
  await page.waitForFunction(() => !document.querySelector("#rankBody .spinner") && document.querySelector("#rankBody .disc-bar, #rankBody .empty"));
}
async function openFilters(page) {
  await page.click("#rankBody [data-dopen]");
  await page.waitForSelector("#filterSheet.open");
  await page.waitForSelector("#filterBody .filt-group");
  // il pannello sale con un'animazione di 0,32 s: si misura a movimento finito
  await page.waitForFunction(() => {
    const p = document.querySelector("#filterSheet .sheet-panel");
    return getComputedStyle(p).transform === "none" || getComputedStyle(p).transform === "matrix(1, 0, 0, 1, 0, 0)";
  });
}
const chip = (page, group, value) => page.click(`#filterSheet [data-fgroup="${group}"][data-fval="${value}"]`);
const closeFilters = async (page) => {
  await page.click("#filterFoot [data-fdone]");
  await page.waitForSelector("#filterSheet:not(.open)");
};
const expectCount = async (page, n, msg) => assert.match(await countText(page), new RegExp(`^${n.toLocaleString("it-IT").replace(/\./g, "\\.")} anime`), msg);

(async () => {
  const browser = await chromium.launch();
  try {
    for (const device of ["iPhone SE", "iPad (gen 7)"]) {
      const page = await open(browser, device);
      const listBefore = await store(page, "animeteca.v1");

      // senza rankings.json la riga delle schede c'è lo stesso e Scopri è raggiungibile
      await page.click("#rankBtn");
      await page.waitForSelector("#rankSheet.open");
      await page.waitForSelector("#rankBody .seg");
      assert.equal(await page.locator("#rankBody .seg-btn").count(), 4, `${device}: 4 schede`);
      assert.match(await text(page, "#rankBody"), /Classifiche in arrivo/);
      await page.click('#rankBody [data-rtab="discover"]');
      await page.waitForSelector("#rankBody .disc-bar");
      const segFits = await page.evaluate(() => {
        const panel = document.querySelector("#rankSheet .sheet-panel").getBoundingClientRect();
        return [...document.querySelectorAll("#rankBody .seg-btn")].every((b) => b.getBoundingClientRect().right <= panel.right && b.scrollWidth <= b.clientWidth + 1);
      });
      assert.ok(segFits, `${device}: le 4 schede entrano senza tagli`);

      // partenza: nessun filtro, tutti gli anime, 50 righe e "Mostra altri"
      await expectCount(page, 130, `${device}: tutti gli anime`);
      assert.doesNotMatch(await countText(page), /con questi filtri/);
      assert.equal(await page.locator("#rankBody .rank-row").count(), 50);
      assert.equal(await page.locator("#rankBody .disc-active").count(), 0, "nessun filtro attivo");
      assert.deepEqual((await rowTitles(page)).slice(0, 2), ["Anime 0", "Anime 1"], "ordine di partenza: popolarità");
      assert.match(await text(page, "#rankBody [data-dmore]"), /Mostra altri 50/);
      await page.click("#rankBody [data-dmore]");
      assert.equal(await page.locator("#rankBody .rank-row").count(), 100);
      await page.click("#rankBody [data-dmore]");
      assert.equal(await page.locator("#rankBody .rank-row").count(), 130);
      assert.equal(await page.locator("#rankBody [data-dmore]").count(), 0, "finiti i risultati niente altro da mostrare");
      assert.ok(await noOverflow(page), `${device}: niente scorrimento orizzontale`);
      if (OUT) await page.screenshot({ path: path.join(OUT, `scopri-${device.replace(/\W+/g, "-")}-1-lista.png`) });

      // pannello Filtri: tutti i gruppi, tocchi grandi, piede visibile
      await openFilters(page);
      const groups = await page.$$eval("#filterBody .filt-group .eyebrow", (els) => els.map((e) => e.textContent.trim()));
      assert.deepEqual(groups, ["Formato", "Anno di uscita", "Numero di episodi", "Voto minimo", "Generi", "Stato", "Notorietà", "Serie", "La mia lista"]);
      assert.ok(await page.evaluate(() => [...document.querySelectorAll("#filterBody .filt")].every((b) => b.getBoundingClientRect().height >= 40)), "chip alti almeno 40 px");
      assert.ok(await page.evaluate(() => document.querySelector("#filterFoot").getBoundingClientRect().bottom <= innerHeight + 1), `${device}: piede dei filtri dentro lo schermo`);
      assert.ok(await noOverflow(page), `${device}: filtri senza scorrimento orizzontale`);
      assert.equal(await page.locator("#filterBody .filt:disabled").count(), 0, "con status nel database nessun chip spento");
      if (OUT) await page.screenshot({ path: path.join(OUT, `scopri-${device.replace(/\W+/g, "-")}-2-filtri.png`) });

      // un filtro: il numero nel piede si aggiorna subito, la lista dietro solo alla chiusura
      await chip(page, "formats", "Film");
      const films = count((a) => a.type === "Film");
      assert.match(await text(page, "#filterFoot [data-fdone]"), new RegExp(`Mostra ${films} anime`));
      await expectCount(page, 130, "la lista dietro non cambia finché il pannello è aperto");
      await chip(page, "formats", "OVA");
      await closeFilters(page);
      const filmOva = count((a) => a.type === "Film" || a.type === "OVA");
      await expectCount(page, filmOva, `${device}: formati in alternativa (o)`);
      assert.match(await countText(page), /con questi filtri/);
      assert.equal(await text(page, "#rankBody .disc-open .seg-n"), "2", "badge con il numero di filtri");
      assert.deepEqual(await page.$$eval("#rankBody .disc-active .tag", (els) => els.map((e) => e.textContent.trim())), ["Film", "OVA"]);

      // combinazione: formato + decennio + genere + voto + inizio serie
      await openFilters(page);
      await chip(page, "year", "2010");
      await chip(page, "genres", "Action");
      await chip(page, "score", "60");
      await chip(page, "starts", "1");
      const combo = count((a) => (a.type === "Film" || a.type === "OVA") && a.year >= 2010 && a.year <= 2019 && has(a, "Action") && a.score >= 60 && a.start === 1);
      await closeFilters(page);
      await expectCount(page, combo, `${device}: combinazione di 5 filtri`);
      const chipsNow = await page.$$eval("#rankBody .disc-active .tag", (els) => els.map((e) => e.textContent.trim()));
      assert.deepEqual(chipsNow, ["Film", "OVA", "Anni 2010", "Voto 6+", "Azione", "Inizi di serie"]);
      if (OUT) {
        await page.waitForTimeout(500); // fine dell'animazione di chiusura del pannello Filtri
        await page.evaluate(() => (document.querySelector("#rankSheet .sheet-panel").scrollTop = 0));
        await page.screenshot({ path: path.join(OUT, `scopri-${device.replace(/\W+/g, "-")}-3-attivi.png`) });
      }

      // due generi: devono esserci tutti e due
      await openFilters(page);
      await chip(page, "formats", "Film");
      await chip(page, "formats", "OVA");
      await chip(page, "year", "2010");
      await chip(page, "score", "60");
      await chip(page, "starts", "1");
      await chip(page, "genres", "Comedy");
      const twoGenres = count((a) => has(a, "Action") && has(a, "Comedy"));
      await closeFilters(page);
      await expectCount(page, twoGenres, `${device}: due generi insieme`);

      // si toglie un filtro con la croce, poi si azzera tutto
      await page.click('#rankBody [data-dremove="genres"][data-dval="Comedy"]');
      await expectCount(page, count((a) => has(a, "Action")), `${device}: tolto Commedia`);
      await page.click("#rankBody .disc-active [data-dreset]");
      await expectCount(page, 130, `${device}: azzera tutto`);
      assert.equal(await page.locator("#rankBody .disc-active").count(), 0);
      assert.equal(await page.locator("#rankBody .disc-open .seg-n").count(), 0);

      // nessun risultato: messaggio e pulsante per azzerare
      await openFilters(page);
      await chip(page, "formats", "Special");
      await chip(page, "genres", "Mecha");
      await chip(page, "genres", "Music");
      await chip(page, "episodes", "27+");
      await chip(page, "score", "80");
      const none = count((a) => a.type === "Special" && has(a, "Mecha") && has(a, "Music") && a.episodes >= 27 && a.score >= 80);
      assert.equal(none, 0, "il caso di prova è davvero vuoto");
      assert.match(await text(page, "#filterFoot [data-fdone]"), /Nessun risultato/);
      await closeFilters(page);
      assert.match(await text(page, "#rankBody"), /Nessun anime con questi filtri/);
      assert.match(await countText(page), /^0 anime/);
      assert.equal(await page.locator("#rankBody .rank-row").count(), 0);
      await page.click("#rankBody .disc-none [data-dreset]");
      await expectCount(page, 130, `${device}: dal vuoto si torna a tutti`);

      // ordine: voto, più recenti
      await page.click('#rankBody [data-dsort="score"]');
      const best = Math.max(...FX.map((a) => a.score));
      const bestTitles = FX.filter((a) => a.score === best).sort((a, b) => b.pop - a.pop).map((a) => a.title);
      assert.equal((await rowTitles(page))[0], bestTitles[0], `${device}: Voto: in cima il più alto`);
      assert.equal((await page.locator("#rankBody .rank-row .rank-score").first().textContent()).trim(), (best / 10).toFixed(1).replace(".", ","));
      await page.click('#rankBody [data-dsort="new"]');
      const newest = Math.max(...FX.map((a) => a.year));
      const firstNew = FX.filter((a) => a.year === newest).sort((a, b) => b.pop - a.pop)[0].title;
      assert.equal((await rowTitles(page))[0], firstNew, `${device}: Più recenti`);
      await page.click('#rankBody [data-dsort="pop"]');

      // tocco su un risultato: scheda sopra; aggiunta a Da vedere; nella lista salvata niente campi interni "_"
      await page.click("#rankBody .rank-row >> nth=0");
      await page.waitForSelector("#detailSheet.open");
      assert.match(await text(page, ".detail-title"), /Anime 0/);
      assert.ok(await page.evaluate(() => document.querySelector("#filterSheet").compareDocumentPosition(document.querySelector("#detailSheet")) & Node.DOCUMENT_POSITION_FOLLOWING), "scheda sopra i filtri");
      await page.click('#detailSheet [data-status="plan"]');
      const saved = JSON.parse(await store(page, "animeteca.v1"));
      assert.equal(saved.length, 1);
      assert.deepEqual(Object.keys(saved[0]).filter((k) => k.startsWith("_")), [], `${device}: nella lista dell'utente niente campi interni`);
      await page.click("#detailSheet .close");
      assert.match(await text(page, "#rankBody .rank-row >> nth=0"), /Da vedere/, "la riga mostra lo stato nella tua lista");

      // "La mia lista": nasconde quelli già salvati
      await openFilters(page);
      await chip(page, "hideMine", "1");
      await closeFilters(page);
      await expectCount(page, 129, `${device}: nascosto quello già in lista`);
      assert.doesNotMatch((await rowTitles(page)).join("|"), /^Anime 0\|/);

      // le scelte restano dopo aver ricaricato l'app
      await page.reload();
      await openScopri(page);
      await expectCount(page, 129, `${device}: filtri ricordati dopo il ricaricamento`);
      assert.deepEqual(await page.$$eval("#rankBody .disc-active .tag", (els) => els.map((e) => e.textContent.trim())), ["Non nella mia lista"]);
      assert.deepEqual(JSON.parse(await store(page, "animeteca.prefs.v1")).discover.hideMine, true);

      assert.deepEqual(page.errors, [], `${device}: nessun errore in console`);
      // naviga e filtra senza toccare la lista: l'unica modifica è l'anime che abbiamo aggiunto noi
      assert.equal(JSON.parse(await store(page, "animeteca.v1")).length, 1);
      assert.equal(listBefore, null);
      await page.context().close();
    }

    // Esc chiude il pannello Filtri e la lista dietro si aggiorna
    {
      const page = await open(browser, "iPhone SE");
      await openScopri(page);
      await openFilters(page);
      await chip(page, "formats", "TV");
      await page.keyboard.press("Escape");
      await page.waitForSelector("#filterSheet:not(.open)");
      await expectCount(page, count((a) => a.type === "TV"), "Esc: lista aggiornata");
      assert.equal(await page.locator("#rankSheet.open").count(), 1, "le Classifiche restano aperte");
      await page.context().close();
    }

    // senza "status" (come i dati reali arricchiti in locale): Stato spento con la spiegazione, il resto funziona
    {
      const page = await open(browser, "iPhone SE", "noStatus");
      await openScopri(page);
      await expectCount(page, 130, "noStatus: tutti");
      await openFilters(page);
      const groups = await page.$$eval("#filterBody .filt-group .eyebrow", (els) => els.map((e) => e.textContent.trim()));
      assert.ok(groups.includes("Stato") && groups.includes("Generi") && groups.includes("Serie"), "Generi e Serie ci sono, Stato è mostrato");
      assert.equal(await page.locator('#filterBody [data-fgroup="status"]:disabled').count(), 5, "i 5 chip dello Stato sono spenti");
      assert.equal(await page.locator('#filterBody [data-fgroup="status"]:not(:disabled)').count(), 0);
      assert.match(await text(page, "#filterBody"), /Disponibile dopo il prossimo aggiornamento del database/);
      await page.click('#filterBody [data-fgroup="status"][data-fval="FINISHED"]', { force: true });
      assert.equal(await page.locator('#filterBody [data-fgroup="status"].active').count(), 0, "un chip spento non si attiva");
      await chip(page, "genres", "Horror");
      await chip(page, "starts", "1");
      await closeFilters(page);
      await expectCount(page, count((a) => has(a, "Horror") && a.start === 1), "noStatus: generi e inizi funzionano");
      assert.deepEqual(page.errors, [], "noStatus: nessun errore in console");
      await page.context().close();
    }

    // con "status": il filtro Stato funziona, in alternativa tra più stati
    {
      const page = await open(browser, "iPhone SE");
      await openScopri(page);
      await openFilters(page);
      await chip(page, "status", "RELEASING");
      await chip(page, "status", "HIATUS");
      await closeFilters(page);
      await expectCount(page, count((a) => a.status === 1 || a.status === 4), "Stato: In onda o In pausa");
      assert.match((await page.locator("#rankBody .rank-row .rank-src").first().textContent()).trim(), /In onda|In pausa/, "lo stato si vede nella riga");
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }

    // indice vecchio (12 colonne): niente Generi e Serie, Stato spento, i filtri di base funzionano
    {
      const page = await open(browser, "iPhone SE", "old");
      await openScopri(page);
      await expectCount(page, 130, "old: tutti");
      await openFilters(page);
      const groups = await page.$$eval("#filterBody .filt-group .eyebrow", (els) => els.map((e) => e.textContent.trim()));
      assert.deepEqual(groups, ["Formato", "Anno di uscita", "Numero di episodi", "Voto minimo", "Stato", "Notorietà", "La mia lista"], "gruppi non disponibili nascosti");
      assert.equal(await page.locator('#filterBody [data-fgroup="status"]:disabled').count(), 5);
      await chip(page, "formats", "TV");
      await chip(page, "episodes", "2-13");
      await chip(page, "fame", "known");
      await closeFilters(page);
      await expectCount(page, count((a) => a.type === "TV" && a.episodes >= 2 && a.episodes <= 13 && a.pop >= 10000), "old: filtri di base");
      assert.deepEqual(page.errors, [], "old: nessun errore in console");
      await page.context().close();
    }

    // preferenze salvate da un database più ricco: i gruppi che non esistono più vengono scartati senza errori
    {
      const page = await open(browser, "iPhone SE", "old");
      await page.evaluate(() => localStorage.setItem("animeteca.prefs.v1", JSON.stringify({ discover: { genres: ["Action"], status: ["FINISHED"], starts: true, formats: ["TV"], year: "boh" } })));
      await page.reload();
      await openScopri(page);
      await expectCount(page, count((a) => a.type === "TV"), "preferenze: restano solo i filtri validi");
      await page.evaluate(() => localStorage.setItem("animeteca.prefs.v1", "[1,2"));
      await page.reload();
      await openScopri(page);
      await expectCount(page, 130, "preferenze rovinate: si parte da zero");
      assert.deepEqual(page.errors, []);
      await page.context().close();
    }

    // database non disponibile: messaggio e "Riprova"
    {
      const page = await open(browser, "iPhone SE", "missing");
      await page.click("#rankBtn");
      await page.waitForSelector('#rankBody [data-rtab="discover"]');
      await page.click('#rankBody [data-rtab="discover"]');
      await page.waitForSelector("#rankBody [data-dretry]");
      assert.match(await text(page, "#rankBody"), /Database non disponibile/);
      assert.equal(await page.locator("#rankBody .disc-bar").count(), 0);
      await page.context().close();
    }

    console.log("Scopri (filtri): tutte le prove superate");
  } finally {
    await browser.close();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

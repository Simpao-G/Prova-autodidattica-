/* Animeteca - lista personale degli anime.
 * La tua lista è salvata nel dispositivo (localStorage).
 * La ricerca usa il database in data/ (costruito da GitHub Actions con i dati di AniList);
 * se non è disponibile, cerca online su AniList e MyAnimeList.
 */
(() => {
  "use strict";

  const API = "https://api.jikan.moe/v4";
  const ANILIST = "https://graphql.anilist.co";
  const STORAGE_KEY = "animeteca.v1";
  const LOG_KEY = "animeteca.log.v1";
  const REAL_KEY = "animeteca.real.v1";
  const DELETED_KEY = "animeteca.deleted.v1"; // cosa hai cancellato (serve alla sincronizzazione)
  // In ordine di "vita" di una serie: da vedere -> in corso -> visto
  const STATUS = {
    plan: "Da vedere",
    watching: "In corso",
    done: "Visto",
  };
  const TAB_LABEL = { watching: "In corso", plan: "Da vedere", done: "Visti" };

  // ---------- Stato ----------
  let list = load();
  let currentTab = "watching";
  let openItem = null; // anime mostrato nella scheda
  let showOriginal = null; // id dell'anime di cui mostrare la descrizione originale (inglese)
  let pendingDetailRender = false; // scheda da ridisegnare appena finisci di scrivere la nota

  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    } catch {
      toast("Memoria piena: impossibile salvare");
    }
    scheduleSync();
  }

  // Anime e tempi cancellati, con l'ora: così la cancellazione arriva anche sugli altri dispositivi
  let deleted = loadDeleted();
  function loadDeleted() {
    try {
      const d = JSON.parse(localStorage.getItem(DELETED_KEY));
      return { anime: d?.anime || {}, real: d?.real || {} };
    } catch {
      return { anime: {}, real: {} };
    }
  }
  function saveDeleted() {
    try {
      localStorage.setItem(DELETED_KEY, JSON.stringify(deleted));
    } catch {
      /* non grave */
    }
  }
  const findItem = (id) => list.find((a) => a.id === id);

  // Registro degli episodi segnati (data + quanti): serve per le statistiche
  // Tempo reale (letto da Tempo di Utilizzo dell'iPad), inserito a mano: [{t, m}]
  let real = loadReal();
  function loadReal() {
    try {
      const d = JSON.parse(localStorage.getItem(REAL_KEY));
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }
  function saveReal() {
    try {
      localStorage.setItem(REAL_KEY, JSON.stringify(real));
    } catch {
      toast("Memoria piena: impossibile salvare");
    }
    scheduleSync();
  }
  let log = loadLog();
  function loadLog() {
    try {
      const d = JSON.parse(localStorage.getItem(LOG_KEY));
      return Array.isArray(d) ? d : [];
    } catch {
      return [];
    }
  }
  function saveLog() {
    if (log.length > 5000) log = log.slice(-5000);
    try {
      localStorage.setItem(LOG_KEY, JSON.stringify(log));
    } catch {
      /* statistiche non salvate, non è grave */
    }
    scheduleSync();
  }

  // ---------- Utilità ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // Icone disegnate in index.html (<symbol id="i-...">)
  const icon = (name, cls = "") => `<svg class="ic${cls ? " " + cls : ""}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;

  // Generi di AniList / MyAnimeList in italiano
  const GENRE_IT = {
    Action: "Azione",
    Adventure: "Avventura",
    Comedy: "Commedia",
    Drama: "Drammatico",
    Fantasy: "Fantasy",
    Horror: "Horror",
    "Mahou Shoujo": "Majokko",
    Mecha: "Mecha",
    Music: "Musica",
    Mystery: "Mistero",
    Psychological: "Psicologico",
    Romance: "Sentimentale",
    "Sci-Fi": "Fantascienza",
    "Slice of Life": "Slice of life",
    Sports: "Sport",
    Supernatural: "Soprannaturale",
    Thriller: "Thriller",
    Ecchi: "Ecchi",
    Suspense: "Suspense",
    "Award Winning": "Premiato",
    "Avant Garde": "Sperimentale",
    Gourmet: "Cucina",
    "Boys Love": "Boys love",
    "Girls Love": "Girls love",
  };
  const genreLabel = (g) => GENRE_IT[g] || g;

  // Copertina di riserva: grafite con le iniziali
  function placeholder(title) {
    const letters = (title || "?").trim().slice(0, 2).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><rect width="200" height="300" fill="#1b1b1e"/><rect x="0" y="292" width="200" height="8" fill="#f5c542"/><text x="100" y="168" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="64" font-weight="800" fill="#4a4a4f" text-anchor="middle" letter-spacing="-2">${esc(letters)}</text></svg>`;
    return "data:image/svg+xml," + encodeURIComponent(svg);
  }
  const cover = (a) => a.image || placeholder(a.title);

  // Se una copertina non si carica, mostra quella generata
  document.addEventListener(
    "error",
    (e) => {
      const img = e.target;
      if (img.tagName === "IMG" && !img.src.startsWith("data:")) img.src = placeholder(img.dataset.t);
    },
    true
  );

  // ---------- Database locale ----------
  const norm = (s) =>
    String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

  let db = null;
  let dbPromise = null;
  const shardCache = new Map();

  function loadDB() {
    if (!dbPromise) {
      dbPromise = fetch("data/anime.json")
        .then((r) => {
          if (!r.ok) throw new Error("database non trovato");
          return r.json();
        })
        .then((json) => {
          const P = json.coverPrefix || "";
          const items = json.items.map(([al, mal, title, alt, type, year, eps, img, score, pop, isSeason, dur]) => ({
            id: mal ? "mal-" + mal : "al-" + al,
            alId: al,
            malId: mal || null,
            title,
            altTitle: alt,
            type,
            year: year || null,
            episodes: eps || null,
            image: img ? (img.startsWith("http") ? img : P + img) : "",
            score: score ? (score / 10).toFixed(1) : null,
            isSeason: !!isSeason,
            duration: dur || null,
            url: mal ? `https://myanimelist.net/anime/${mal}` : `https://anilist.co/anime/${al}`,
            _nt: norm(title),
            _na: norm(alt),
          }));
          db = {
            items,
            byAl: new Map(items.map((i) => [i.alId, i])),
            byId: new Map(items.map((i) => [i.id, i])),
            shards: json.shards || 64,
            updated: json.updated,
          };
          return db;
        })
        .catch((err) => {
          dbPromise = null;
          throw err;
        });
    }
    return dbPromise;
  }

  function localSearch(q) {
    const nq = norm(q);
    if (!nq) return [];
    const words = nq.split(" ");
    const hits = [];
    for (const it of db.items) {
      const t = it._nt;
      const a = it._na;
      const k = t + " " + a;
      let s;
      if (t === nq || a === nq) s = 5;
      else if (t.startsWith(nq) || a.startsWith(nq)) s = 4;
      else if ((" " + k).includes(" " + nq)) s = 3;
      else if (k.includes(nq)) s = 2;
      else if (words.length > 1 && words.every((w) => k.includes(w))) s = 1;
      else continue;
      hits.push([s, it]);
    }
    // gli anime sono già ordinati per popolarità: l'ordinamento stabile la mantiene
    return hits.sort((x, y) => y[0] - x[0]).slice(0, 40).map((h) => h[1]);
  }

  // Descrizione, generi e stagioni: caricati solo quando apri la scheda
  async function loadDetails(item) {
    if (!db) await loadDB().catch(() => {});
    if (!db) return;
    if (!item.alId) {
      const match = db.byId.get(item.id);
      if (!match) return;
      item.alId = match.alId;
    }
    const n = item.alId % db.shards;
    if (!shardCache.has(n)) {
      shardCache.set(
        n,
        fetch(`data/d/${n}.json`).then((r) => (r.ok ? r.json() : {})).catch(() => {
          shardCache.delete(n);
          return {};
        })
      );
    }
    const d = (await shardCache.get(n))[item.alId];
    if (!d) return;
    const before = JSON.stringify([item.synopsis, item.synopsisEn, item.synIt, item.genres, item.seasons]);
    if (d[3]) {
      // descrizione tradotta in italiano (vedi scripts/translate.py); l'originale resta consultabile
      item.synopsis = d[3];
      item.synopsisEn = d[0];
      item.synIt = true;
    } else if (!item.synopsis) {
      item.synopsis = d[0];
    }
    if (!item.genres?.length) item.genres = d[1];
    item.seasons = d[2];
    const changed = before !== JSON.stringify([item.synopsis, item.synopsisEn, item.synIt, item.genres, item.seasons]);
    if (changed && findItem(item.id) === item) save();
  }

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function epLabel(a) {
    return a.episodes ? `${a.ep} / ${a.episodes}` : `${a.ep}`;
  }
  function pct(a) {
    return a.episodes ? Math.min(100, Math.round((a.ep / a.episodes) * 100)) : 0;
  }

  // Converte un risultato di Jikan nel nostro formato
  function fromJikan(r) {
    return {
      id: "mal-" + r.mal_id,
      malId: r.mal_id,
      title: r.title_english || r.title,
      altTitle: r.title_english && r.title !== r.title_english ? r.title : "",
      image: r.images?.webp?.large_image_url || r.images?.jpg?.large_image_url || "",
      synopsis: (r.synopsis || "").replace(/\s*\[Written by MAL Rewrite\]\s*$/i, "").trim(),
      episodes: r.episodes || null,
      duration: parseInt(r.duration, 10) || null,
      year: r.year || r.aired?.prop?.from?.year || null,
      score: r.score || null,
      type: r.type || "",
      genres: (r.genres || []).map((g) => g.name).slice(0, 4),
      url: r.url || "",
    };
  }

  // Converte un risultato di AniList nel nostro formato.
  // Se l'anime esiste anche su MyAnimeList usa lo stesso id "mal-…",
  // così gli anime già salvati vengono riconosciuti.
  const FORMATS = { TV: "TV", TV_SHORT: "TV", MOVIE: "Film", SPECIAL: "Special", OVA: "OVA", ONA: "ONA", MUSIC: "Music" };
  function cleanText(html) {
    const d = document.createElement("div");
    d.innerHTML = String(html || "").replace(/<br\s*\/?>/gi, "\n");
    return (d.textContent || "").replace(/\n{3,}/g, "\n\n").replace(/\s*\(Source:[^)]*\)\s*$/i, "").trim();
  }
  function fromAniList(m) {
    return {
      id: m.idMal ? "mal-" + m.idMal : "al-" + m.id,
      malId: m.idMal || null,
      title: m.title?.english || m.title?.romaji || m.title?.native || "Senza titolo",
      altTitle: m.title?.english && m.title?.romaji !== m.title.english ? m.title.romaji : "",
      image: m.coverImage?.extraLarge || m.coverImage?.large || "",
      synopsis: cleanText(m.description),
      episodes: m.episodes || null,
      duration: m.duration || null,
      year: m.seasonYear || m.startDate?.year || null,
      score: m.averageScore ? (m.averageScore / 10).toFixed(1) : null,
      type: FORMATS[m.format] || m.format || "",
      genres: (m.genres || []).slice(0, 4),
      url: m.idMal ? `https://myanimelist.net/anime/${m.idMal}` : m.siteUrl || "",
    };
  }

  const ANILIST_QUERY = `query ($q: String) {
    Page(perPage: 15) {
      media(search: $q, type: ANIME, isAdult: false, sort: [SEARCH_MATCH, POPULARITY_DESC]) {
        id idMal title { romaji english native } coverImage { extraLarge large }
        description(asHtml: false) episodes duration seasonYear startDate { year }
        averageScore format genres siteUrl
      }
    }
  }`;

  // fetch con un tempo massimo: se il server non risponde non restiamo bloccati
  const TIMEOUT_MS = 8000;
  async function fetchWithTimeout(url, opts, signal, name) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal.addEventListener("abort", onAbort);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, TIMEOUT_MS);
    try {
      return await fetch(url, { ...opts, signal: ctrl.signal });
    } catch (err) {
      if (timedOut) throw new Error(`${name} non risponde`);
      if (signal.aborted) throw err;
      throw new Error(`${name} bloccato o irraggiungibile`);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    }
  }

  async function searchAniList(q, signal) {
    const res = await fetchWithTimeout(ANILIST, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: ANILIST_QUERY, variables: { q } }),
    }, signal, "AniList");
    if (!res.ok) throw new Error("AniList HTTP " + res.status);
    const json = await res.json();
    if (json.errors?.length) throw new Error("AniList: " + json.errors[0].message);
    return (json.data?.Page?.media || []).map(fromAniList);
  }

  async function searchJikan(q, signal) {
    const res = await fetchWithTimeout(
      `${API}/anime?q=${encodeURIComponent(q)}&limit=15&sfw=true&order_by=members&sort=desc`, {}, signal, "MyAnimeList");
    if (!res.ok) throw new Error("MyAnimeList HTTP " + res.status);
    const json = await res.json();
    return (json.data || []).map(fromJikan);
  }

  // Durata di un episodio in minuti (se non è nota, una stima in base al tipo)
  const DEFAULT_MIN = { TV: 24, ONA: 20, OVA: 30, Film: 100, Special: 24 };
  function durationOf(item) {
    if (item.duration) return item.duration;
    const fromDb = db?.byId.get(item.id)?.duration;
    if (fromDb) return fromDb;
    return DEFAULT_MIN[item.type] || 24;
  }

  // ---------- Azioni ----------
  function setStatus(anime, status) {
    let item = findItem(anime.id);
    const isNew = !item;
    if (isNew) {
      const clean = Object.fromEntries(Object.entries(anime).filter(([k]) => !k.startsWith("_")));
      item = { ...clean, ep: 0, addedAt: Date.now() };
      list.unshift(item);
    }
    item.status = status;
    if (status === "done" && item.episodes) item.ep = item.episodes;
    item.updatedAt = Date.now();
    save();
    toast(isNew ? `Aggiunto a ${TAB_LABEL[status]}` : `Spostato in ${TAB_LABEL[status]}`);
    openItem = item;
    renderAll();
  }

  function setEpisode(item, n) {
    const max = item.episodes || Infinity;
    const ep = Math.max(0, Math.min(max, n));
    if (ep === item.ep) return;
    log.push({ t: Date.now(), id: item.id, d: ep - item.ep, m: durationOf(item) });
    saveLog();
    item.ep = ep;
    if (ep > 0 && item.status === "plan") item.status = "watching";
    if (item.episodes && ep === item.episodes && item.status !== "done") {
      item.status = "done";
      toast(`Serie finita: ${item.title}`);
    } else if (item.status === "done" && item.episodes && ep < item.episodes) {
      item.status = "watching";
    }
    item.updatedAt = Date.now();
    save();
    renderAll();
  }

  function removeItem(item) {
    if (!confirm(`Rimuovere "${item.title}" dalla lista?`)) return;
    list = list.filter((a) => a.id !== item.id);
    deleted.anime[item.id] = Date.now();
    saveDeleted();
    save();
    closeSheet("#detailSheet");
    toast("Rimosso");
    renderAll();
  }

  // ---------- Disegno della lista ----------
  function renderCounts() {
    for (const s of Object.keys(STATUS)) {
      $(`[data-count="${s}"]`).textContent = list.filter((a) => a.status === s).length;
    }
  }

  // "Continua a guardare": l'anime in corso toccato più di recente, in grande
  function renderHero() {
    const box = $("#hero");
    const a =
      currentTab === "watching"
        ? list.filter((x) => x.status === "watching").sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))[0]
        : null;
    if (!a) {
      box.innerHTML = "";
      return;
    }
    const minutes = a.duration || db?.byId.get(a.id)?.duration;
    const meta = [a.episodes ? `Ep. ${a.ep} di ${a.episodes}` : `Ep. ${a.ep}`, minutes && `${minutes} min a episodio`]
      .filter(Boolean)
      .join(" · ");
    const finished = a.episodes && a.ep >= a.episodes;
    box.innerHTML = `
      <section class="hero-cw" data-hero="${esc(a.id)}">
        <img class="hero-bg" src="${esc(cover(a))}" data-t="${esc(a.title)}" alt="">
        <div class="hero-inner">
          <img class="hero-poster" src="${esc(cover(a))}" data-t="${esc(a.title)}" alt="">
          <div class="hero-text">
            <p class="eyebrow">Continua a guardare</p>
            <h2 class="hero-title display">${esc(a.title)}</h2>
            <p class="hero-meta tnum">${esc(meta)}</p>
            ${a.episodes ? `<div class="bar"><i style="width:${pct(a)}%"></i></div>` : ""}
            ${a.note ? `<p class="hero-note">${icon("pencil")}<span>${esc(a.note.split("\n")[0])}</span></p>` : ""}
          </div>
          <div class="hero-actions">
            ${finished ? "" : `<button class="btn btn-primary" data-hero-plus>${icon("check")}Ho visto l'ep. ${a.ep + 1}</button>`}
          </div>
        </div>
      </section>
      <p class="eyebrow section-label">Tutti in corso</p>`;
  }

  // ---------- Preferenze (solo su questo dispositivo: non si sincronizzano) ----------
  const PREFS_KEY = "animeteca.prefs.v1";
  const prefs = (() => {
    const p = readStore(PREFS_KEY);
    return p && typeof p === "object" && !Array.isArray(p) ? p : {};
  })();

  // ---------- Da vedere: ordinamento e tempo totale ----------
  // Recenti = ultima modifica (l'ordine di sempre); gli anime senza il dato richiesto vanno in fondo
  const PLAN_SORTS = [
    ["recent", "Recenti"],
    ["added", "Aggiunti"],
    ["score", "Voto"],
    ["short", "Più brevi"],
    ["year", "Anno"],
  ];
  const byRecent = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);

  // Dati utili a scegliere: dalla lista, con ripiego sul database dell'app
  function planInfo(a) {
    const d = db?.byId.get(a.id);
    const episodes = Number(a.episodes) || Number(d?.episodes) || 0;
    return {
      episodes,
      score: Number(a.score) || Number(d?.score) || 0,
      year: Number(a.year) || Number(d?.year) || 0,
      minutes: episodes ? episodes * durationOf(a) : 0, // stima: episodi x durata
    };
  }

  function sortPlan(items) {
    const mode = prefs.planSort;
    const rows = items.map((a) => ({ a, ...planInfo(a) }));
    const MISSING = 1e9;
    const order = {
      added: (x, y) => (y.a.addedAt || 0) - (x.a.addedAt || 0),
      score: (x, y) => (y.score || -1) - (x.score || -1),
      short: (x, y) => (x.minutes || MISSING) - (y.minutes || MISSING),
      year: (x, y) => (y.year || -1) - (x.year || -1),
    }[mode];
    if (!order) return items;
    return rows.sort((x, y) => order(x, y) || byRecent(x.a, y.a)).map((r) => r.a);
  }

  // Sotto il poster di un anime da vedere: "12 ep. · 4 h 48 min" (o "Film · 1 h 40 min")
  function planSub(a) {
    const { episodes, minutes } = planInfo(a);
    if (!episodes) return "";
    if (a.type === "Film" || episodes === 1) return [a.type || "Film", fmtTime(minutes)].join(" · ");
    return `${episodes} ep. · ${fmtTime(minutes)}`;
  }

  function sortRowHtml(items) {
    if (currentTab !== "plan" || items.length < 2) return "";
    const mode = PLAN_SORTS.some(([k]) => k === prefs.planSort) ? prefs.planSort : "recent";
    return `<div class="sort-row" role="group" aria-label="Ordina">${PLAN_SORTS.map(
      ([k, label]) => `<button class="rank-chip${k === mode ? " active" : ""}" data-sort="${k}" aria-pressed="${k === mode}">${label}</button>`
    ).join("")}</div>`;
  }

  // Voto e durata vengono dal database dell'app: se non è ancora caricato, si ridisegna appena arriva
  let planDbAsked = false;
  function renderGrid() {
    renderHero();
    const grid = $("#grid");
    let items = list.filter((a) => a.status === currentTab).sort(byRecent);
    if (currentTab === "plan" && items.length && !db && !planDbAsked) {
      planDbAsked = true;
      loadDB()
        .then(() => currentTab === "plan" && renderGrid())
        .catch(() => (planDbAsked = false));
    }
    if (currentTab === "plan") items = sortPlan(items);

    if (!items.length) {
      const [ic, title, text] = {
        watching: ["play", "Niente in corso", "Quando inizi una serie, segnala come “In corso”: la ritrovi qui, con l'episodio a cui sei arrivato."],
        plan: ["bookmark", "Nessuna serie da vedere", "Salva qui le serie che vuoi iniziare, così non te le dimentichi."],
        done: ["check", "Nessuna serie finita", "Le serie che completi arrivano qui, con tutti gli episodi visti."],
      }[currentTab];
      grid.innerHTML = `<div class="empty">${icon(ic)}<h3 class="display">${title}</h3><p>${text}</p>
        <button class="btn btn-ghost" data-action="search">${icon("search")}Cerca un anime</button></div>`;
      return;
    }

    grid.innerHTML = sortRowHtml(items) + items
      .map((a) => {
        let corner = "";
        let bar = "";
        let sub = [a.type, a.year].filter(Boolean).join(" · ");
        if (a.status === "watching") {
          corner = `<span class="quick-plus" role="button" data-plus="${esc(a.id)}" aria-label="Segna l'episodio successivo">+1</span>`;
          sub = `Ep. ${epLabel(a)}`;
          if (a.episodes) bar = `<div class="bar"><i style="width:${pct(a)}%"></i></div>`;
        } else if (a.status === "done") {
          corner = `<span class="badge-done" aria-label="Visto">${icon("check")}</span>`;
        } else if (a.status === "plan") {
          sub = planSub(a) || sub;
        }
        // il tuo voto sotto il poster, al posto di tipo e anno (come su Letterboxd)
        const subHtml = a.status !== "watching" && a.rating ? starsSmall(a.rating) : esc(sub);
        return `<button class="card" data-open="${esc(a.id)}">
          <div class="poster-wrap">
            <img class="cover" src="${esc(cover(a))}" data-t="${esc(a.title)}" alt="" loading="lazy">
            ${corner}${bar}
          </div>
          <div class="info"><div class="title">${esc(a.title)}</div><div class="sub">${subHtml}${a.note ? icon("pencil", "note-ic") : ""}</div></div>
        </button>`;
      })
      .join("");
  }

  // ---------- Scheda anime ----------
  function renderDetail() {
    // mentre scrivi (nota o recensione) la scheda non si ridisegna (perderesti la tastiera): lo fa dopo
    const typing = document.activeElement && ["noteInput", "reviewInput"].includes(document.activeElement.id);
    if (typing) {
      pendingDetailRender = true;
      return;
    }
    pendingDetailRender = false;
    const a = openItem;
    if (!a) return;
    const saved = findItem(a.id);
    const item = saved || a;
    const status = saved?.status;

    const minutes = item.duration || db?.byId.get(item.id)?.duration;
    const meta = [item.type, item.year, item.episodes && `${item.episodes} ep.`, minutes && `${minutes} min`]
      .filter(Boolean)
      .map((x) => `<span>${esc(x)}</span>`)
      .join("");
    const score = item.score ? `<span class="score">${icon("star", "fill")}${esc(String(item.score).replace(".", ","))}</span>` : "";
    const genres = (item.genres || []).map(genreLabel).join(" · ");

    const episodes = saved
      ? `<div class="episodes">
          <div>
            <div class="label">Episodio</div>
            <div class="count display">${esc(item.ep)}${item.episodes ? `<small> / ${esc(item.episodes)}</small>` : ""}</div>
            ${item.episodes ? `<div class="bar"><i style="width:${pct(item)}%"></i></div>` : ""}
          </div>
          <div class="stepper">
            <button data-ep="-1" aria-label="Episodio precedente">${icon("minus")}</button>
            <button data-ep="1" class="plus" aria-label="Episodio successivo">${icon("plus")}</button>
          </div>
        </div>`
      : "";

    const loading = item.synopsis === undefined && item.alId;
    const translated = item.synIt && item.synopsisEn;
    const showEn = translated && showOriginal === item.id;
    const synopsis =
      (showEn ? item.synopsisEn : item.synopsis) || (loading ? "Caricamento della descrizione…" : "Nessuna descrizione disponibile.");
    const long = synopsis.length > 280;
    const synMeta = translated
      ? `<p class="syn-meta">${showEn ? "Testo originale" : "Traduzione automatica"} · <button class="syn-toggle" id="synToggle">${
          showEn ? "Mostra in italiano" : "Mostra l'originale"
        }</button></p>`
      : "";
    const wiki = item.url
      ? `<a class="wiki-link" href="${esc(item.url)}" target="_blank" rel="noopener">${icon("external")}Scheda completa su ${item.url.includes("anilist") ? "AniList" : "MyAnimeList"}</a>`
      : "";

    // Stagioni e film della stessa serie, da sfogliare
    let seasonsHtml = "";
    const chain = db && item.seasons?.length > 1 ? item.seasons.map((al) => db.byAl.get(al)).filter(Boolean) : [];
    if (chain.length > 1) {
      const mainSeasons = chain.filter((s) => s.isSeason);
      const totalEps = mainSeasons.reduce((n, s) => n + (s.episodes || 0), 0);
      const summary = [
        mainSeasons.length && `${mainSeasons.length} ${mainSeasons.length === 1 ? "stagione" : "stagioni"}`,
        totalEps && `${totalEps} episodi`,
        chain.length > mainSeasons.length && `${chain.length - mainSeasons.length} tra film e speciali`,
      ].filter(Boolean).join(" · ");
      let n = 0;
      const rows = chain
        .map((s) => {
          const label = s.isSeason ? `Stagione ${++n}` : s.type || "Extra";
          const here = s.alId === item.alId;
          const mine = findItem(s.id);
          const sub = [label, s.year, s.episodes && `${s.episodes} ep.`].filter(Boolean).join(" · ");
          return `<button class="season ${here ? "current" : ""}" data-season="${s.alId}" ${here ? "disabled" : ""}>
            <img src="${esc(cover(s))}" data-t="${esc(s.title)}" alt="" loading="lazy">
            <div class="s-title">${esc(s.title)}</div>
            <div class="s-sub">${esc(sub)}</div>
            ${here ? `<span class="s-tag">Questa</span>` : mine ? `<span class="s-tag ok">${esc(STATUS[mine.status])}</span>` : ""}
          </button>`;
        })
        .join("");
      seasonsHtml = `<p class="eyebrow section-title">Stagioni e film</p><p class="season-sum">${esc(summary)}</p><div class="seasons">${rows}</div>`;
    }

    $("#detail").innerHTML = `
      <div class="hero">
        <img class="bg" src="${esc(cover(item))}" data-t="${esc(item.title)}" alt="">
        <button class="close" data-close aria-label="Chiudi">${icon("close")}</button>
      </div>
      <div class="detail-head">
        <img class="poster" src="${esc(cover(item))}" data-t="${esc(item.title)}" alt="Copertina di ${esc(item.title)}">
        <div class="head-text">
          <h2 class="detail-title display">${esc(item.title)}</h2>
          ${item.altTitle ? `<p class="alt-title">${esc(item.altTitle)}</p>` : ""}
          <div class="meta-line">${meta}${score}</div>
        </div>
      </div>
      <div class="detail-body">
        <div class="status-row" role="group" aria-label="Stato">
          ${Object.entries(STATUS)
            .map(([key, label]) => `<button class="status-btn ${status === key ? "active" : ""}" data-status="${key}">${label}</button>`)
            .join("")}
        </div>
        ${episodes}
        ${saved ? ratingSection(item) : ""}
        ${saved ? notesSection(item) : ""}
        ${recommendButton()}
        ${friendsSection(item)}
        <p class="synopsis ${long ? "clamp" : ""}" id="synopsis">${esc(synopsis)}</p>
        ${long ? `<button class="more" id="moreBtn">Leggi tutto</button>` : ""}
        ${synMeta}
        ${genres ? `<p class="genres">${esc(genres)}</p>` : ""}
        ${wiki}
        ${seasonsHtml}
        ${saved ? `<button class="remove-btn" id="removeBtn">${icon("trash")}Rimuovi dalla lista</button>` : ""}
      </div>`;
    autosize($("#noteInput"));
    autosize($("#reviewInput"), 64);
  }

  // ---------- Note personali ----------
  function notesSection(item) {
    return `<section class="notes">
        <div class="notes-head"><p class="eyebrow">Le tue note</p><span class="note-state" id="noteState">${
          item.note ? `Salvata ${ago(item.noteAt || Date.now())}` : ""
        }</span></div>
        <textarea id="noteInput" class="note-input" rows="3" maxlength="5000" placeholder="Cosa ne pensi, a che punto sei, chi te l'ha consigliato…">${esc(item.note || "")}</textarea>
      </section>`;
  }

  // la casella cresce con il testo
  function autosize(ta, min = 88) {
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.max(ta.scrollHeight + 2, min) + "px";
  }

  let noteTimer = null;
  function saveNote(id, text) {
    clearTimeout(noteTimer);
    noteTimer = null;
    const item = findItem(id); // sempre l'oggetto attuale (una sincronizzazione può averlo sostituito)
    if (!item) return;
    const value = String(text).replace(/\s+$/, "").slice(0, 5000);
    if ((item.note || "") !== value) {
      item.note = value;
      item.noteAt = Date.now(); // le note si sincronizzano con la loro data (vince l'ultima scritta)
      save();
    }
    const state = $("#noteState");
    if (state) state.textContent = item.note ? "Salvata" : "";
  }
  // salva subito nota e recensione in sospeso (per esempio se esci dall'app mentre scrivi)
  function flushNote() {
    const ta = $("#noteInput");
    if (noteTimer && ta && openItem) saveNote(openItem.id, ta.value);
    const rv = $("#reviewInput");
    if (reviewTimer && rv && openItem) saveReview(openItem.id, rv.value);
  }

  // ---------- Il tuo voto (da ½ a 5 stelle) e la recensione per gli amici ----------
  const fmtRating = (r) => String(r).replace(".", ",");

  // Stelline da mostrare (solo quelle piene e l'eventuale mezza, come su Letterboxd)
  function starsSmall(r) {
    r = Number(r) || 0;
    if (!r) return "";
    let html = "";
    for (let i = 1; i <= Math.ceil(r); i++) html += `<span class="st${r >= i ? "" : " half"}">${icon("star", "fill")}</span>`;
    return `<span class="stars" role="img" aria-label="${fmtRating(r)} stelle su 5">${html}</span>`;
  }

  // Le 5 stelle da toccare: la metà sinistra di una stella vale mezzo punto
  function ratingSection(item) {
    const r = Number(item.rating) || 0;
    let stars = "";
    for (let i = 1; i <= 5; i++) {
      const fill = r >= i ? 100 : r >= i - 0.5 ? 50 : 0;
      stars += `<span class="st">${icon("star", "fill")}<span class="st-fill" style="width:${fill}%">${icon("star", "fill")}</span>
        <button type="button" class="st-hit l" data-rate="${i - 0.5}" aria-label="${fmtRating(i - 0.5)} su 5"></button>
        <button type="button" class="st-hit r" data-rate="${i}" aria-label="${i} su 5"></button></span>`;
    }
    const social = profileReady();
    return `<section class="rate-box">
        <div class="notes-head"><p class="eyebrow">Il tuo voto</p><span class="note-state">${r ? `${fmtRating(r)} su 5` : "Tocca una stella"}</span></div>
        <div class="stars big" role="group" aria-label="Il tuo voto, da mezza stella a 5">${stars}</div>
        ${
          social
            ? `<textarea id="reviewInput" class="note-input review-input" rows="2" maxlength="1000" placeholder="Una recensione per i tuoi amici (facoltativa)">${esc(item.review || "")}</textarea>
        <p class="rate-hint">Voto e recensione li vedono i tuoi amici. Le note qui sotto restano solo tue.</p>`
            : ""
        }
      </section>`;
  }

  // Tocchi la stella del voto che hai già dato: il voto si toglie
  function setRating(value) {
    const item = openItem && findItem(openItem.id);
    if (!item) return;
    const v = Number(value);
    item.rating = Number(item.rating) === v ? null : v;
    item.ratingAt = Date.now(); // si sincronizza come le note: vince l'ultimo voto dato
    save();
    renderDetail();
    renderGrid();
  }

  let reviewTimer = null;
  function saveReview(id, text) {
    clearTimeout(reviewTimer);
    reviewTimer = null;
    const item = findItem(id);
    if (!item) return;
    const value = String(text).replace(/\s+$/, "").slice(0, 1000);
    if ((item.review || "") !== value) {
      item.review = value;
      item.ratingAt = Date.now();
      save();
    }
  }

  function showDetail(anime) {
    const item = findItem(anime.id) || anime;
    openItem = item;
    renderDetail();
    $("#detail").scrollTop = 0;
    openSheet("#detailSheet");
    loadDetails(item).then(() => {
      if (openItem === item) renderDetail();
    });
  }

  function renderAll() {
    renderCounts();
    renderGrid();
    if ($("#detailSheet").classList.contains("open")) renderDetail();
    // classifiche aperte sotto la scheda: lo stato degli anime appena aggiunti si vede subito
    if (rankings && $("#rankSheet").classList.contains("open")) renderRankings();
  }

  // ---------- Pannelli ----------
  function openSheet(sel) {
    const s = $(sel);
    s.classList.add("open");
    s.setAttribute("aria-hidden", "false");
  }
  function closeSheet(sel) {
    const s = $(sel);
    s.classList.remove("open");
    s.setAttribute("aria-hidden", "true");
  }
  document.querySelectorAll(".sheet").forEach((sheet) => {
    sheet.addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) closeSheet("#" + sheet.id);
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = [...document.querySelectorAll(".sheet.open")].pop();
    if (open) closeSheet("#" + open.id);
  });

  // ---------- Ricerca ----------
  let searchTimer;
  let searchCtrl;
  let lastResults = [];

  function renderResults(results) {
    const box = $("#searchResults");
    lastResults = results;
    if (!results.length) {
      box.innerHTML = `<p class="status-msg">Nessun risultato.</p>${manualButton()}`;
      return;
    }
    box.innerHTML =
      results
        .map((r, i) => {
          const saved = findItem(r.id);
          const sub = [r.type, r.year, r.episodes && `${r.episodes} ep.`].filter(Boolean).join(" · ");
          return `<button class="result" data-result="${i}">
            <img src="${esc(cover(r))}" data-t="${esc(r.title)}" alt="" loading="lazy">
            <div class="r-main"><div class="r-title">${esc(r.title)}</div><div class="r-sub">${esc(sub)}</div></div>
            ${saved ? `<span class="r-tag">${esc(STATUS[saved.status])}</span>` : icon("chevron-right", "chev")}
          </button>`;
        })
        .join("") + manualButton();
  }
  const manualButton = () => `<button class="manual-btn" id="manualBtn">${icon("plus")}Non lo trovi? Aggiungilo a mano</button>`;

  async function search(q) {
    const box = $("#searchResults");
    searchCtrl?.abort();
    if (q.length < 2) {
      box.innerHTML = `<p class="status-msg">Scrivi il nome di un anime, per esempio “Frieren” o “One Piece”.</p>`;
      return;
    }
    searchCtrl = new AbortController();
    const signal = searchCtrl.signal;

    // 1) Database dentro l'app: veloce e funziona anche offline
    if (!db) box.innerHTML = `<div class="spinner"></div>`;
    try {
      await loadDB();
    } catch {
      /* database non disponibile: si cerca online */
    }
    if (signal.aborted) return;
    if (db) {
      const local = localSearch(q);
      if (local.length) return renderResults(local);
    }

    // 2) Ricerca online: prima AniList, se non risponde (o non trova nulla) MyAnimeList
    box.innerHTML = `<div class="spinner"></div>`;
    const errors = [];
    for (const source of [searchAniList, searchJikan]) {
      try {
        const found = await source(q, signal);
        if (signal.aborted) return;
        if (!found.length) continue;
        // Le API possono restituire duplicati: li togliamo
        const seen = new Set();
        renderResults(found.filter((r) => !seen.has(r.id) && seen.add(r.id)));
        return;
      } catch (err) {
        if (signal.aborted) return; // nuova ricerca partita nel frattempo
        errors.push(err.message || String(err));
      }
    }
    if (errors.length < 2 || db) return renderResults([]);
    const offline = !navigator.onLine;
    box.innerHTML = `<p class="status-msg">${
      offline ? "Sei offline: collegati a internet per cercare." : "Ricerca non disponibile in questo momento. Riprova tra poco."
    }<br><small>${esc(errors.join(" · "))}</small></p>${manualButton()}`;
  }

  function addManual() {
    const title = prompt("Titolo dell'anime:", $("#searchInput").value.trim());
    if (!title || !title.trim()) return;
    const eps = parseInt(prompt("Numero di episodi (lascia vuoto se non lo sai):", "") || "", 10);
    const anime = {
      id: "manual-" + Date.now(),
      title: title.trim(),
      image: "",
      synopsis: "",
      episodes: eps > 0 ? eps : null,
      genres: [],
    };
    closeSheet("#searchSheet");
    showDetail(anime);
  }

  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => search(q), 450);
  });
  $("#searchInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchTimer);
      search(e.target.value.trim());
      e.target.blur();
    }
  });
  $("#searchResults").addEventListener("click", (e) => {
    if (e.target.closest("#manualBtn")) return addManual();
    const r = e.target.closest("[data-result]");
    if (r) showDetail(lastResults[+r.dataset.result]);
  });

  $("#addBtn").addEventListener("click", () => {
    openSheet("#searchSheet");
    loadDB().catch(() => {});
    const input = $("#searchInput");
    if (!input.value) search("");
    setTimeout(() => input.focus(), 300);
  });

  // ---------- Eventi principali ----------
  document.querySelectorAll(".tab").forEach((tab) =>
    tab.addEventListener("click", () => {
      currentTab = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      renderGrid();
      window.scrollTo({ top: 0, behavior: "smooth" });
    })
  );

  $("#hero").addEventListener("click", (e) => {
    const hero = e.target.closest("[data-hero]");
    const item = hero && findItem(hero.dataset.hero);
    if (!item) return;
    if (e.target.closest("[data-hero-plus]")) {
      setEpisode(item, item.ep + 1);
      if (item.status === "watching") toast(`${item.title} · ep. ${epLabel(item)}`);
      return;
    }
    showDetail(item);
  });

  $("#grid").addEventListener("click", (e) => {
    if (e.target.closest('[data-action="search"]')) return $("#addBtn").click();
    const sortBtn = e.target.closest("[data-sort]");
    if (sortBtn) {
      if (!PLAN_SORTS.some(([k]) => k === sortBtn.dataset.sort)) return;
      const keep = sortBtn.parentElement.scrollLeft; // la riga di chip resta dov'era
      prefs.planSort = sortBtn.dataset.sort;
      writeStore(PREFS_KEY, prefs);
      renderGrid();
      const row = $(".sort-row");
      if (row) row.scrollLeft = keep;
      return;
    }
    const plus = e.target.closest("[data-plus]");
    if (plus) {
      e.stopPropagation();
      const item = findItem(plus.dataset.plus);
      if (item) {
        setEpisode(item, item.ep + 1);
        if (item.status === "watching") toast(`${item.title}: ep. ${epLabel(item)}`);
      }
      return;
    }
    const card = e.target.closest("[data-open]");
    if (card) showDetail(findItem(card.dataset.open));
  });

  $("#detail").addEventListener("input", (e) => {
    if (!openItem) return;
    const id = openItem.id;
    if (e.target.id === "reviewInput") {
      autosize(e.target, 64);
      clearTimeout(reviewTimer);
      reviewTimer = setTimeout(() => saveReview(id, e.target.value), 700);
      return;
    }
    if (e.target.id !== "noteInput") return;
    autosize(e.target);
    const state = $("#noteState");
    if (state) state.textContent = "…";
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => saveNote(id, e.target.value), 700);
  });
  $("#detail").addEventListener("focusout", (e) => {
    if (!openItem) return;
    if (e.target.id === "noteInput") saveNote(openItem.id, e.target.value);
    else if (e.target.id === "reviewInput") saveReview(openItem.id, e.target.value);
    else return;
    renderGrid(); // aggiorna la matita sul poster e la nota in "Continua a guardare"
    // ridisegno rimandato: aspetta che un eventuale tocco su un pulsante arrivi a destinazione
    if (pendingDetailRender) setTimeout(() => pendingDetailRender && renderDetail(), 350);
  });

  $("#detail").addEventListener("click", (e) => {
    const rate = e.target.closest("[data-rate]");
    if (rate) return setRating(rate.dataset.rate);
    if (e.target.closest("#recommendBtn")) return openRecommend(openItem);
    const friend = e.target.closest("[data-friend]");
    if (friend) {
      // la pagina dell'amico, nel pannello Community (sotto la scheda)
      closeSheet("#detailSheet");
      openSheet("#communitySheet");
      openFriend(friend.dataset.friend);
      return refreshCommunity();
    }
    if (e.target.closest("#synToggle")) {
      showOriginal = showOriginal === openItem.id ? null : openItem.id;
      return renderDetail();
    }
    const st = e.target.closest("[data-status]");
    if (st) return setStatus(openItem, st.dataset.status);
    const season = e.target.closest("[data-season]");
    if (season && db) {
      const s = db.byAl.get(+season.dataset.season);
      if (s) showDetail(s);
      return;
    }
    const ep = e.target.closest("[data-ep]");
    if (ep) {
      const item = findItem(openItem.id);
      if (item) setEpisode(item, item.ep + Number(ep.dataset.ep));
      return;
    }
    if (e.target.closest("#moreBtn")) {
      $("#synopsis").classList.remove("clamp");
      e.target.remove();
      return;
    }
    if (e.target.closest("#removeBtn")) removeItem(findItem(openItem.id));
  });

  // ---------- Statistiche ----------
  const fmtTime = (min) => {
    min = Math.round(min);
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h ? `${h} h${m ? " " + m + " min" : ""}` : `${m} min`;
  };

  function renderStats() {
    const box = $("#stats");
    // Totale: episodi segnati x durata (conta anche quello che avevi già segnato prima)
    let totalMin = 0;
    let totalEps = 0;
    const genreEps = new Map();
    for (const a of list) {
      if (!a.ep) continue;
      totalEps += a.ep;
      totalMin += a.ep * durationOf(a);
      for (const g of a.genres || []) genreEps.set(g, (genreEps.get(g) || 0) + a.ep);
    }
    const done = list.filter((a) => a.status === "done").length;
    const watching = list.filter((a) => a.status === "watching").length;

    // Periodi: dal registro degli episodi segnati
    const today = new Date();
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      days.push({ start: d.getTime(), label: d.toLocaleDateString("it-IT", { weekday: "short" }).replace(".", ""), min: 0, isToday: i === 0 });
    }
    let monthMin = 0;
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).getTime();
    for (const e of log) {
      const min = (e.d || 0) * (e.m || 0);
      if (e.t >= monthStart) monthMin += min;
      const day = days.find((x) => e.t >= x.start && e.t < x.start + 86400000);
      if (day) day.min += min;
    }
    days.forEach((d) => (d.min = Math.max(0, d.min)));
    const weekMin = days.reduce((n, d) => n + d.min, 0);
    const todayMin = days[6].min;
    const maxDay = Math.max(1, ...days.map((d) => d.min));

    if (!totalEps) {
      box.innerHTML = `<div class="empty">${icon("chart")}<h3 class="display">Ancora nessun dato</h3><p>Segna gli episodi che guardi: qui vedrai quanto tempo passi sugli anime.</p></div>`;
      return;
    }

    const hours = totalMin / 60;
    const dd = Math.floor(hours / 24);
    const hh = Math.floor(hours % 24);
    const big =
      hours >= 24
        ? `${dd}<small>${dd === 1 ? "giorno" : "giorni"}</small>${hh ? `${hh}<small>${hh === 1 ? "ora" : "ore"}</small>` : ""}`
        : `${Math.floor(hours)}<small>${Math.floor(hours) === 1 ? "ora" : "ore"}</small>${Math.round(totalMin % 60)}<small>min</small>`;
    const cap = hours >= 24 ? `Passati a guardare anime: ${Math.round(hours)} ore in tutto (stima)` : "Passati a guardare anime (stima)";

    const topGenres = [...genreEps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxG = topGenres[0]?.[1] || 1;

    box.innerHTML = `
      <div class="big-stat"><div class="num display">${big}</div><div class="cap">${esc(cap)}</div></div>
      <div class="stat-grid">
        <div class="stat-box"><b>${totalEps}</b><span>episodi visti</span></div>
        <div class="stat-box"><b>${done}</b><span>serie finite</span></div>
        <div class="stat-box"><b>${watching}</b><span>in corso</span></div>
      </div>
      <div class="stat-grid">
        <div class="stat-box"><b>${fmtTime(todayMin)}</b><span>oggi</span></div>
        <div class="stat-box"><b>${fmtTime(weekMin)}</b><span>ultimi 7 giorni</span></div>
        <div class="stat-box"><b>${fmtTime(monthMin)}</b><span>questo mese</span></div>
      </div>
      <p class="eyebrow stats-sec">Ultimi 7 giorni</p>
      <div class="bars">${days
        .map(
          (d) => `<div class="day ${d.isToday ? "today" : ""}">
            <span class="v">${d.min ? String(Math.round(d.min / 6) / 10).replace(".", ",") + " h" : ""}</span>
            <i style="height:${d.min ? Math.max(6, (d.min / maxDay) * 92) : 3}px"></i>
            <em>${esc(d.label)}</em></div>`
        )
        .join("")}</div>
      ${topGenres.length ? `<p class="eyebrow stats-sec">Generi più visti</p>${topGenres
        .map(([g, n]) => `<div class="genre-row"><span class="g-name">${esc(genreLabel(g))}</span><span class="g-bar"><i style="width:${(n / maxG) * 100}%"></i></span><span class="g-val">${n} ep.</span></div>`)
        .join("")}` : ""}
      <p class="stats-note">Tempo stimato: ogni episodio segnato conta per la sua durata (di solito 23–24 minuti). Oggi, settimana e mese dipendono da quando hai segnato gli episodi.</p>`;
  }

  $("#statsBtn").addEventListener("click", () => {
    loadDB().catch(() => {}).then(() => {
      renderStats();
    });
    renderStats();
    openSheet("#statsSheet");
  });

  // Indirizzo dell'app (serve al link d'invito della Community)
  const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");

  // Se esci dall'app mentre scrivi una nota o una recensione, si salva subito
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) flushNote();
  });
  window.addEventListener("pagehide", flushNote);

  // ---------- Account e sincronizzazione ----------
  // Con l'account (Supabase) la lista è la stessa su iPhone, iPad, ecc.
  // Ogni dispositivo tiene la sua copia (funziona anche offline) e, quando può,
  // la unisce con quella online: vedi sync-core.js.
  const CONFIG = window.ANIMETECA_CONFIG || {};
  const Sync = window.AnimetecaSync;
  const LAST_SYNC_KEY = "animeteca.lastsync.v1";
  const cloud =
    Sync && CONFIG.supabaseUrl && CONFIG.supabaseKey
      ? Sync.createClient({ url: CONFIG.supabaseUrl, key: CONFIG.supabaseKey, storage: localStorage })
      : null;
  let syncTimer = null;
  let syncing = false;
  let syncAgain = false;
  let applyingRemote = false;
  let syncState = { status: "idle", error: "" };
  let lastSync = Number(localStorage.getItem(LAST_SYNC_KEY)) || 0;

  const localState = () => ({ list, log, real, deleted });

  // Le modifiche fatte su questo dispositivo partono dopo 2 secondi (più modifiche insieme = un invio)
  function scheduleSync() {
    if (!cloud || applyingRemote || !cloud.user()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => syncNow(), 2000);
  }

  // Dati arrivati dagli altri dispositivi: li salva qui senza farli ripartire subito
  function applyLocal(d) {
    applyingRemote = true;
    try {
      list = d.list;
      log = d.log;
      real = d.real;
      deleted = d.deleted;
      save();
      saveLog();
      saveReal();
      saveDeleted();
    } finally {
      applyingRemote = false;
    }
    renderAll();
    if ($("#statsSheet").classList.contains("open")) renderStats();
  }

  async function syncNow({ force = false } = {}) {
    if (!cloud || !cloud.user()) return;
    if (syncing) {
      syncAgain = true;
      return;
    }
    clearTimeout(syncTimer);
    syncing = true;
    syncState = { status: "syncing", error: "" };
    renderAccount();
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const remote = await cloud.getRemote();
        const merged = force || !remote ? Sync.normalize(localState()) : Sync.merge(localState(), remote.data);
        if (!Sync.same(merged, localState())) applyLocal(merged);
        if (remote && !force && Sync.same(merged, remote.data)) break; // già uguali
        const rev = Date.now() * 1000 + Math.floor(Math.random() * 1000);
        const ok = remote ? await cloud.updateRemote(Sync.slim(merged), remote.rev, rev) : await cloud.insertRemote(Sync.slim(merged), rev);
        if (ok) break;
        // un altro dispositivo ha scritto proprio adesso: rilegge e riunisce
        force = false;
      }
      lastSync = Date.now();
      localStorage.setItem(LAST_SYNC_KEY, String(lastSync));
      syncState = { status: "ok", error: "" };
      communityAfterSync(); // la lista che vedono gli amici si aggiorna dopo ogni sincronizzazione
    } catch (err) {
      syncState = { status: err.offline ? "offline" : "error", error: err.message || String(err) };
      if (err.loggedOut) toast("Sessione scaduta: accedi di nuovo dal menu");
    } finally {
      syncing = false;
      renderAccount();
      if (syncAgain) {
        syncAgain = false;
        scheduleSync();
      }
    }
  }

  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return "adesso";
    if (s < 3600) return `${Math.round(s / 60)} min fa`;
    if (s < 86400) return `${Math.round(s / 3600)} h fa`;
    return new Date(t).toLocaleDateString("it-IT");
  };

  let accountMsg = "";
  function renderAccount() {
    const box = $("#accountBox");
    if (!box) return;
    const note = $("#storageNote");
    if (!cloud) {
      box.innerHTML = `<div class="acc-card"><div class="acc-head"><span class="avatar off">${icon("user")}</span><div><b>Account</b><p class="acc-sub">La sincronizzazione tra dispositivi non è configurata.</p></div></div></div>`;
      return;
    }
    const user = cloud.user();
    if (note) {
      note.textContent = user
        ? "I tuoi dati sono salvati su questo dispositivo e nel tuo account."
        : "I dati restano salvati solo su questo dispositivo. Fai ogni tanto un backup.";
    }
    if (!user) {
      box.innerHTML = `
        <form class="acc-card" id="accForm" autocomplete="on">
          <div class="acc-head"><span class="avatar off">${icon("user")}</span><div><b>Account</b><p class="acc-sub">Accedi per avere la stessa lista su iPhone e iPad.</p></div></div>
          <input type="email" name="email" placeholder="Email" autocomplete="username" required>
          <input type="password" name="password" placeholder="Password (almeno 6 caratteri)" autocomplete="current-password" minlength="6" required>
          ${accountMsg ? `<p class="acc-msg">${esc(accountMsg)}</p>` : ""}
          <div class="acc-actions">
            <button type="submit" class="real-add" data-acc="login">Accedi</button>
            <button type="submit" class="s-secondary" data-acc="signup">Crea account</button>
          </div>
        </form>`;
      return;
    }
    const state = syncState.status === "idle" && lastSync ? "ok" : syncState.status;
    const status = {
      syncing: "Sincronizzazione in corso…",
      ok: `Sincronizzato ${lastSync ? ago(lastSync) : ""}`.trim(),
      offline: "Offline: riprovo quando torna la connessione",
      error: syncState.error,
      idle: "In attesa di sincronizzare",
    }[state];
    box.innerHTML = `
      <div class="acc-card">
        <div class="acc-head"><span class="avatar">${esc(user.email.charAt(0))}</span><div><b>${esc(user.email)}</b><p class="acc-status" data-s="${state}">${esc(status)}</p></div></div>
        <div class="acc-actions">
          <button type="button" class="s-secondary" id="accSync">${icon("sync")}Sincronizza</button>
          <button type="button" class="s-secondary" id="accLogout">${icon("logout")}Esci</button>
        </div>
      </div>`;
  }

  $("#accountBox").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const action = e.submitter?.dataset.acc || "login";
    const email = form.email.value.trim();
    const password = form.password.value;
    form.querySelectorAll("button").forEach((b) => (b.disabled = true));
    try {
      if (action === "signup") {
        const r = await cloud.signUp(email, password);
        if (r.needsConfirmation) {
          accountMsg = "Ti abbiamo mandato un'email: apri il link per confermare l'account, poi torna qui e accedi.";
          return renderAccount();
        }
        toast("Account creato");
      } else {
        await cloud.signIn(email, password);
        toast("Accesso effettuato");
      }
      accountMsg = "";
      await syncNow();
      toast("Lista sincronizzata");
    } catch (err) {
      accountMsg = err.message || String(err);
      renderAccount();
    }
  });

  $("#accountBox").addEventListener("click", async (e) => {
    if (e.target.closest("#accSync")) return syncNow();
    if (e.target.closest("#accLogout")) {
      if (!confirm("Uscire dall'account? La lista resta su questo dispositivo, ma non si sincronizza più.")) return;
      await cloud.signOut();
      syncState = { status: "idle", error: "" };
      resetCommunity();
      renderAccount();
      toast("Sei uscito dall'account");
    }
  });

  // Quando torni nell'app o torna internet, prende le modifiche fatte sugli altri dispositivi
  let lastFocusSync = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || Date.now() - lastFocusSync < 20 * 1000) return;
    lastFocusSync = Date.now();
    syncNow();
  });
  window.addEventListener("online", () => syncNow());
  window.addEventListener("hashchange", () => handleAuthRedirect()); // link aperto in una pagina già aperta

  // Link dell'email di conferma: arriva qui con #access_token=...
  async function handleAuthRedirect() {
    if (!cloud || !/access_token=|error_description=/.test(location.hash)) return;
    const hash = location.hash;
    history.replaceState(null, "", location.pathname + location.search);
    try {
      if (await cloud.fromUrlHash(hash)) {
        toast("Email confermata, accesso effettuato");
        await syncNow();
      }
    } catch (err) {
      toast(err.message || "Link non valido");
    }
  }

  // ---------- Community: amici, voti e consigli ----------
  // Sul server (supabase/community.sql) ci sono: il profilo con il nome utente, le amicizie,
  // la "lista condivisa" che vedono gli amici (stato, episodio, voto e recensione: mai le note)
  // e i consigli. Le regole del database fanno vedere tutto questo solo agli amici accettati.
  const PROFILE_KEY = "animeteca.profile.v1";
  const PUB_KEY = "animeteca.pub.v1"; // cosa è già stato pubblicato per gli amici (per mandare solo le novità)
  const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
  const USERNAME_HELP = "Da 3 a 20 caratteri: lettere minuscole, numeri, punto e trattino basso.";

  function readStore(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  }
  function writeStore(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* non grave: si rifà la prossima volta */
    }
  }

  const me = () => (cloud && cloud.user() ? cloud.user().id : null);
  let profile = readStore(PROFILE_KEY); // { uid, username, display_name } del tuo account
  const profileReady = () => Boolean(profile && profile.uid && profile.uid === me());

  const comm = { gen: 0, at: 0, tried: 0, loading: null, error: "", missing: false, profileChecked: null, friendships: [], people: new Map(), feed: [], recs: [] };
  // msg / profileMsg: messaggi dei moduli, tenuti qui così non spariscono se il pannello si ridisegna
  const view = { tab: "feed", friend: null, friendRows: null, friendTab: null, msg: "", profileMsg: "", prefill: "", fresh: new Set() };
  const friendViews = new Map(); // cosa pensano gli amici di un anime: id -> { at, rows }
  let pendingCommRender = false;

  const communityOpen = () => $("#communitySheet").classList.contains("open");
  const isMissing = (err) => ["PGRST205", "42P01"].includes(err && err.code) || /could not find the table|does not exist/i.test(err && err.raw);
  const accepted = () => comm.friendships.filter((f) => f.status === "accepted");
  const otherOf = (f) => (f.requester === me() ? f.addressee : f.requester);
  const friendIds = () => accepted().map(otherOf);
  const personName = (p) => (p && (p.display_name || p.username)) || "Qualcuno";
  function hueOf(id) {
    let h = 7;
    for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }
  const avatarOf = (p, id, cls = "") =>
    `<span class="avatar p${cls ? " " + cls : ""}" style="--h:${hueOf(id)}" aria-hidden="true">${esc([...personName(p)][0])}</span>`;
  const when = (iso) => ago(Date.parse(iso) || Date.now());
  const validImage = (src) => (typeof src === "string" && /^https:\/\//.test(src) && src.length <= 500 ? src : null);
  // Copertine che arrivano dagli amici: solo dai siti degli anime (niente immagini "spia" da altri siti)
  const animeImg = (src) => typeof src === "string" && /^https:\/\/([a-z0-9-]+\.)*(anilist\.co|myanimelist\.net)\//i.test(src);
  const friendCover = (r) => (animeImg(r.image) ? r.image : placeholder(r.title));

  function statusText(r) {
    if (r.status === "done") return "Visto";
    if (r.status === "plan") return "Da vedere";
    return r.episodes ? `In corso · ep. ${r.ep} di ${r.episodes}` : `In corso · ep. ${r.ep}`;
  }

  // ----- Dati dal server
  async function fetchProfile() {
    const uid = me();
    const rows = await cloud.rest(`profiles?select=id,username,display_name&id=eq.${uid}`);
    profile = rows && rows[0] ? { uid, username: rows[0].username, display_name: rows[0].display_name || "" } : null;
    writeStore(PROFILE_KEY, profile);
    comm.profileChecked = uid; // ora si sa se il profilo c'è (se no, si mostra "Scegli il tuo nome utente")
    return profile;
  }

  // Amicizie, nomi, attività degli amici e consigli ricevuti (al massimo ogni 30 secondi)
  async function refreshCommunity({ force = false } = {}) {
    if (!cloud || !me()) return renderBadge(); // per esempio sessione scaduta: niente pallino

    if (comm.loading) return comm.loading;
    if (!force && Date.now() - comm.tried < 30 * 1000) return;
    comm.tried = Date.now();
    const gen = comm.gen;
    comm.loading = (async () => {
      try {
        if (!profileReady()) await fetchProfile();
        if (gen !== comm.gen) return;
        if (!profile) {
          comm.error = "";
          comm.missing = false;
          return;
        }
        const uid = profile.uid;
        const fs = await cloud.rest("friendships?select=id,requester,addressee,status,created_at&order=created_at.desc");
        const others = [...new Set(fs.map((f) => (f.requester === uid ? f.addressee : f.requester)))];
        const [people, feed, recs] = await Promise.all([
          others.length ? cloud.rest(`profiles?select=id,username,display_name&id=in.(${others.join(",")})`) : [],
          cloud.rest(
            `library?select=user_id,anime_id,al_id,title,image,status,ep,episodes,rating,review,updated_at&user_id=neq.${uid}&order=updated_at.desc&limit=60`
          ),
          cloud.rest(
            `recommendations?select=id,from_user,anime_id,al_id,title,image,message,created_at,seen_at&to_user=eq.${uid}&order=created_at.desc&limit=50`
          ),
        ]);
        if (gen !== comm.gen) return;
        Object.assign(comm, { friendships: fs, people: new Map(people.map((p) => [p.id, p])), feed, recs });
        comm.at = Date.now();
        comm.error = "";
        comm.missing = false;
      } catch (err) {
        if (gen !== comm.gen) return;
        comm.missing = isMissing(err);
        comm.error = err.message || String(err);
        if (err.offline && comm.at) comm.error = ""; // offline: restano i dati di prima
      } finally {
        if (gen === comm.gen) {
          comm.loading = null;
          renderBadge();
          if (communityOpen()) renderCommunity();
          if ($("#detailSheet").classList.contains("open")) renderDetail(); // nomi degli amici nella scheda
        }
      }
    })();
    return comm.loading;
  }

  function communityAfterSync() {
    refreshCommunity().then(() => publishLibrary());
  }

  function resetCommunity() {
    comm.gen++;
    profile = null;
    writeStore(PROFILE_KEY, null);
    Object.assign(comm, { at: 0, tried: 0, loading: null, error: "", missing: false, profileChecked: null, friendships: [], people: new Map(), feed: [], recs: [] });
    Object.assign(view, { tab: "feed", friend: null, friendRows: null, friendTab: null, msg: "", profileMsg: "" });
    view.fresh.clear();
    friendViews.clear();
    pubChecked = false;
    renderBadge();
    if (communityOpen()) renderCommunity();
  }

  // ----- La tua lista come la vedono gli amici (tabella library)
  function libraryRow(a, uid) {
    const t = Math.max(a.updatedAt || 0, a.ratingAt || 0, a.addedAt || 0) || Date.now();
    const int = (n) => (Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.floor(Number(n)) : null);
    const r = Number(a.rating);
    return {
      user_id: uid,
      anime_id: String(a.id).slice(0, 40),
      al_id: int(a.alId),
      title: String(a.title || "?").slice(0, 300),
      image: validImage(a.image),
      status: a.status,
      ep: int(a.ep) || 0,
      episodes: int(a.episodes) || null,
      rating: r >= 0.5 && r <= 5 && r * 2 === Math.floor(r * 2) ? r : null,
      review: a.review ? String(a.review).slice(0, 1000) : null,
      updated_at: new Date(t).toISOString(),
    };
  }
  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return (h >>> 0).toString(36);
  }

  let publishing = false;
  let publishAgain = false;
  let pubChecked = false; // una volta per avvio confronta con ciò che c'è davvero sul server
  async function publishLibrary() {
    if (!cloud || !profileReady()) return;
    if (publishing) {
      publishAgain = true;
      return;
    }
    publishing = true;
    const uid = profile.uid;
    try {
      let snap = readStore(PUB_KEY);
      if (!snap || snap.uid !== uid || !snap.rows) snap = { uid, rows: {} };
      const rows = list.filter((a) => a && a.id && STATUS[a.status]).map((a) => libraryRow(a, uid));
      const now = {};
      for (const r of rows) now[r.anime_id] = hashStr(JSON.stringify(r));
      if (!pubChecked) {
        const onServer = await cloud.rest(`library?select=anime_id&user_id=eq.${uid}`);
        const there = new Set(onServer.map((r) => r.anime_id));
        for (const id of Object.keys(snap.rows)) if (!there.has(id)) delete snap.rows[id];
        for (const id of there) if (!(id in snap.rows)) snap.rows[id] = "?";
        pubChecked = true;
      }
      const changed = rows.filter((r) => snap.rows[r.anime_id] !== now[r.anime_id]);
      const gone = Object.keys(snap.rows).filter((id) => !(id in now));
      for (let i = 0; i < changed.length; i += 200) {
        const part = changed.slice(i, i + 200);
        await cloud.rest("library?on_conflict=user_id,anime_id", {
          method: "POST",
          body: part,
          prefer: "resolution=merge-duplicates,return=minimal",
        });
        for (const r of part) snap.rows[r.anime_id] = now[r.anime_id];
        writeStore(PUB_KEY, snap);
      }
      for (let i = 0; i < gone.length; i += 100) {
        const part = gone.slice(i, i + 100);
        const ids = encodeURIComponent(part.map((id) => `"${id.replace(/["\\]/g, "")}"`).join(","));
        await cloud.rest(`library?user_id=eq.${uid}&anime_id=in.(${ids})`, { method: "DELETE", prefer: "return=minimal" });
        for (const id of part) delete snap.rows[id];
        writeStore(PUB_KEY, snap);
      }
    } catch (err) {
      if (isMissing(err)) comm.missing = true; // riprova alla prossima sincronizzazione
    } finally {
      publishing = false;
      if (publishAgain) {
        publishAgain = false;
        publishLibrary();
      }
    }
  }

  // ----- Pallino sul pulsante: richieste di amicizia e consigli nuovi
  function renderBadge() {
    const b = $("#commBadge");
    if (!b) return;
    let n = 0;
    if (profileReady()) {
      n += comm.friendships.filter((f) => f.status === "pending" && f.addressee === profile.uid).length;
      n += comm.recs.filter((r) => !r.seen_at).length;
    }
    b.textContent = n > 9 ? "9+" : String(n);
    b.hidden = !n;
    $("#commBtn").setAttribute("aria-label", n ? `Amici: ${n} novità` : "Amici e consigli");
  }

  // ----- Cosa ne pensano gli amici (nella scheda dell'anime)
  async function loadFriendViews(id) {
    const prev = friendViews.get(id);
    friendViews.set(id, { at: Date.now(), rows: prev ? prev.rows : [] });
    try {
      const rows = await cloud.rest(
        `library?select=user_id,status,ep,episodes,rating,review,updated_at&anime_id=eq.${encodeURIComponent(id)}&user_id=neq.${me()}&order=updated_at.desc`
      );
      friendViews.set(id, { at: Date.now(), rows: rows || [] });
      if (openItem && openItem.id === id && $("#detailSheet").classList.contains("open")) renderDetail();
    } catch {
      /* senza opinioni degli amici la scheda funziona lo stesso */
    }
  }

  function friendsSection(item) {
    if (!profileReady() || comm.missing) return "";
    const fv = friendViews.get(item.id);
    if (!fv || Date.now() - fv.at > 60 * 1000) loadFriendViews(item.id);
    const rows = fv ? fv.rows : [];
    // chi te l'ha consigliato
    const tips = comm.recs
      .filter((r) => r.anime_id === item.id)
      .map((r) => {
        const p = comm.people.get(r.from_user);
        return `<div class="fs-tip">${icon("send")}<p>Te l'ha consigliato <b>${esc(personName(p))}</b>${r.message ? `: “${esc(r.message)}”` : ""}</p></div>`;
      })
      .join("");
    if (!rows.length && !tips) return "";
    return `<section class="friends-say"><p class="eyebrow">I tuoi amici</p>${tips}${rows
      .map((r) => {
        const p = comm.people.get(r.user_id);
        return `<button class="fs-row" data-friend="${esc(r.user_id)}">${avatarOf(p, r.user_id)}
          <div class="fs-main">
            <div class="fs-top"><b>${esc(personName(p))}</b>${starsSmall(r.rating)}</div>
            <div class="fs-sub">${esc(statusText(r))} · ${esc(when(r.updated_at))}</div>
            ${r.review ? `<p class="fs-review">${esc(r.review)}</p>` : ""}
          </div></button>`;
      })
      .join("")}</section>`;
  }

  function recommendButton() {
    return profileReady() && !comm.missing ? `<button class="line-btn" id="recommendBtn">${icon("send")}Consiglia a un amico</button>` : "";
  }

  // ----- Pannello "Amici"
  async function openCommunity(tab) {
    if (!tab && profileReady()) {
      // con il pallino acceso si va dritti alla novità: consigli nuovi o richieste di amicizia
      if (comm.recs.some((r) => !r.seen_at)) tab = "recs";
      else if (comm.friendships.some((f) => f.status === "pending" && f.addressee === profile.uid)) tab = "friends";
    }
    if (tab) {
      view.tab = tab;
      view.friend = null;
    }
    view.fresh.clear();
    openSheet("#communitySheet");
    renderCommunity();
    refreshCommunity({ force: Date.now() - comm.at > 10 * 1000 });
  }
  $("#commBtn").addEventListener("click", () => openCommunity());

  function renderCommunity() {
    const box = $("#commBody");
    // mentre scrivi in un campo non ridisegna (perderesti la tastiera): lo fa quando hai finito
    if (document.activeElement && box.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      pendingCommRender = true;
      return;
    }
    pendingCommRender = false;
    const keep = {};
    box.querySelectorAll("input[id]").forEach((el) => (keep[el.id] = el.value));
    const showingRecs = communityOpen() && profileReady() && !view.friend && view.tab === "recs";
    if (showingRecs) for (const r of comm.recs) if (!r.seen_at) view.fresh.add(r.id);
    box.innerHTML = communityHtml();
    for (const [id, v] of Object.entries(keep)) {
      const el = document.getElementById(id);
      if (el && v) el.value = v;
    }
    const fi = $("#friendInput");
    if (fi && view.prefill) {
      fi.value = view.prefill;
      view.prefill = "";
    }
    if (showingRecs) markRecsSeen();
  }

  const spinner = `<div class="spinner"></div>`;
  const emptyComm = (ic, title, text, action = "") =>
    `<div class="empty comm-empty">${icon(ic)}<h3 class="display">${title}</h3><p>${text}</p>${action}</div>`;

  function communityHtml() {
    if (!cloud) return emptyComm("users", "Community non disponibile", "Su questa versione dell'app l'account non è configurato.");
    if (!me()) {
      return `<div class="comm-intro">
          <h3 class="display">Gli anime, con gli amici</h3>
          <p>Vota quello che guardi da mezza a 5 stelle, scopri cosa guardano i tuoi amici e consigliagli le serie da non perdere.</p>
          <p>Serve un account: lo stesso che tiene insieme la lista su iPhone e iPad.</p>
          <button class="btn btn-primary" data-comm="login">${icon("user")}Accedi o crea un account</button>
        </div>`;
    }
    if (comm.missing) {
      return `<div class="comm-intro">
          <h3 class="display">Quasi pronto</h3>
          <p>La community non è ancora attiva sul server. Va fatto una volta sola: in Supabase apri <b>SQL Editor</b>, incolla il contenuto di <b>supabase/community.sql</b> e premi <b>Run</b>.</p>
          <button class="btn btn-ghost" data-comm="retry">${icon("sync")}Riprova</button>
        </div>`;
    }
    if (!profileReady()) {
      if (comm.error && !comm.loading) {
        return `<div class="comm-intro"><p class="acc-msg">${esc(comm.error)}</p><button class="btn btn-ghost" data-comm="retry">${icon("sync")}Riprova</button></div>`;
      }
      if (comm.profileChecked !== me()) return spinner;
      return profileFormHtml();
    }
    if (view.friend) return friendPageHtml();
    const reqs = comm.friendships.filter((f) => f.status === "pending" && f.addressee === profile.uid).length;
    const unseen = comm.recs.filter((r) => !r.seen_at && !view.fresh.has(r.id)).length;
    const tabs = [
      ["feed", "Attività", 0],
      ["recs", "Consigliati", unseen],
      ["friends", "Amici", reqs],
    ];
    return `<div class="seg" role="tablist">${tabs
      .map(
        ([k, label, n]) =>
          `<button role="tab" class="seg-btn${view.tab === k ? " active" : ""}" data-ctab="${k}" aria-selected="${view.tab === k}">${label}${
            n ? `<b class="seg-n">${n}</b>` : ""
          }</button>`
      )
      .join("")}</div>
      ${comm.error ? `<p class="acc-msg">${esc(comm.error)}</p>` : ""}
      ${view.tab === "recs" ? recsHtml() : view.tab === "friends" ? friendsHtml() : feedHtml()}`;
  }

  function profileFormHtml() {
    return `<form class="comm-intro" id="profileForm" autocomplete="off" novalidate>
        <h3 class="display">Scegli il tuo nome utente</h3>
        <p>I tuoi amici ti trovano con questo nome: dev'essere solo tuo.</p>
        <label class="at-field"><span>@</span><input id="pfUser" name="username" placeholder="nome_utente" maxlength="21" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="next"></label>
        <input id="pfName" class="plain-input" name="display" placeholder="Il tuo nome (facoltativo)" maxlength="40" enterkeyhint="done">
        <p class="hint">${USERNAME_HELP}</p>
        <p class="form-msg" id="profileMsg">${esc(view.profileMsg)}</p>
        <button type="submit" class="btn btn-primary">Continua</button>
        <div class="privacy">
          <p class="eyebrow">Cosa vedono i tuoi amici</p>
          <ul><li>gli anime della tua lista, con stato ed episodio;</li><li>i tuoi voti e le tue recensioni.</li></ul>
          <p>Le note personali restano solo tue. Chi non è tuo amico non vede niente.</p>
        </div>
      </form>`;
  }

  function feedHtml() {
    if (!comm.at) return spinner;
    if (!friendIds().length) {
      return emptyComm(
        "users",
        "Ancora nessun amico",
        "Aggiungi i tuoi amici con il loro nome utente: qui vedrai cosa guardano, i voti e le recensioni.",
        `<button class="btn btn-ghost" data-ctab="friends">${icon("plus")}Aggiungi un amico</button>`
      );
    }
    if (!comm.feed.length) return emptyComm("play", "Ancora niente", "Quando i tuoi amici aggiungono anime alla lista o li votano, lo vedi qui.");
    return comm.feed
      .map((r, i) => {
        const p = comm.people.get(r.user_id);
        const verb = r.status === "done" ? "ha visto" : r.status === "plan" ? "vuole vedere" : "sta guardando";
        const ep = r.status === "watching" ? (r.episodes ? `ep. ${r.ep} di ${r.episodes}` : `ep. ${r.ep}`) : "";
        return `<div class="feed-item" role="button" tabindex="0" data-row="feed:${i}">
            <img class="fi-poster" src="${esc(friendCover(r))}" data-t="${esc(r.title)}" alt="" loading="lazy">
            <div class="fi-main">
              <p class="fi-line"><button class="fi-who" data-friend="${esc(r.user_id)}">${esc(personName(p))}</button> ${verb} <b>${esc(r.title)}</b></p>
              <p class="fi-meta">${starsSmall(r.rating)}<span>${esc([ep, when(r.updated_at)].filter(Boolean).join(" · "))}</span></p>
              ${r.review ? `<p class="fi-review">${esc(r.review)}</p>` : ""}
            </div>
          </div>`;
      })
      .join("");
  }

  function recsHtml() {
    if (!comm.at) return spinner;
    if (!comm.recs.length) {
      return emptyComm(
        "send",
        "Nessun consiglio",
        "Quando un amico ti consiglia un anime, lo trovi qui. Per consigliarne uno tu, apri la sua scheda e tocca “Consiglia a un amico”."
      );
    }
    return comm.recs
      .map((r, i) => {
        const p = comm.people.get(r.from_user);
        const mine = findItem(r.anime_id);
        const fresh = view.fresh.has(r.id);
        return `<div class="feed-item rec-item${fresh ? " fresh" : ""}" role="button" tabindex="0" data-row="rec:${i}">
            <img class="fi-poster" src="${esc(friendCover(r))}" data-t="${esc(r.title)}" alt="" loading="lazy">
            <div class="fi-main">
              <p class="fi-line"><b>${esc(r.title)}</b></p>
              <p class="fi-meta"><span>da ${esc(personName(p))} · ${esc(when(r.created_at))}</span>${fresh ? `<span class="new-tag">Nuovo</span>` : ""}</p>
              ${r.message ? `<p class="fi-review">${esc(r.message)}</p>` : ""}
              <div class="rec-actions">
                ${
                  mine
                    ? `<span class="r-tag">${esc(STATUS[mine.status])}</span>`
                    : `<button class="mini-btn primary" data-addrec="${i}">${icon("plus")}Da vedere</button>`
                }
                <button class="mini-btn" data-delrec="${esc(r.id)}">Togli</button>
              </div>
            </div>
          </div>`;
      })
      .join("");
  }

  function personRow(id, sub, right, link) {
    const p = comm.people.get(id);
    const inner = `${avatarOf(p, id)}<span class="pe-main"><b>${esc(personName(p))}</b><span>${esc(sub)}</span></span>${right}`;
    return link ? `<button class="person" data-friend="${esc(id)}">${inner}</button>` : `<div class="person">${inner}</div>`;
  }

  function friendsHtml() {
    const uid = profile.uid;
    const incoming = comm.friendships.filter((f) => f.status === "pending" && f.addressee === uid);
    const outgoing = comm.friendships.filter((f) => f.status === "pending" && f.requester === uid);
    const friends = accepted();
    const at = (id) => "@" + (comm.people.get(id)?.username || "");
    return `<div class="me-card">
        <div><p class="eyebrow">Il tuo nome utente</p><b class="me-name">@${esc(profile.username)}</b></div>
        <button class="btn btn-ghost" data-comm="invite">${icon("send")}Invita</button>
      </div>
      <form class="add-friend" id="friendForm" autocomplete="off" novalidate>
        <label class="at-field"><span>@</span><input id="friendInput" name="username" placeholder="nome utente dell'amico" maxlength="21" autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="send"></label>
        <button type="submit" class="btn btn-primary">Aggiungi</button>
      </form>
      <p class="form-msg" id="friendMsg">${esc(view.msg)}</p>
      ${
        incoming.length
          ? `<p class="eyebrow comm-sec">Richieste ricevute</p>${incoming
              .map((f) =>
                personRow(
                  f.requester,
                  "vuole essere tuo amico",
                  `<span class="pe-actions"><button class="mini-btn primary" data-accept="${esc(f.id)}">Accetta</button><button class="mini-btn" data-decline="${esc(f.id)}">Rifiuta</button></span>`
                )
              )
              .join("")}`
          : ""
      }
      <p class="eyebrow comm-sec">I tuoi amici${friends.length ? ` · ${friends.length}` : ""}</p>
      ${
        friends.length
          ? friends.map((f) => personRow(otherOf(f), at(otherOf(f)), icon("chevron-right", "chev"), true)).join("")
          : `<p class="hint">Ancora nessuno. Scrivi qui sopra il nome utente di un amico, oppure mandagli un invito con il tuo.</p>`
      }
      ${
        outgoing.length
          ? `<p class="eyebrow comm-sec">Richieste inviate</p>${outgoing
              .map((f) => personRow(f.addressee, `${at(f.addressee)} · in attesa`, `<button class="mini-btn" data-cancel="${esc(f.id)}">Annulla</button>`))
              .join("")}`
          : ""
      }`;
  }

  function friendPageHtml() {
    const id = view.friend;
    const p = comm.people.get(id);
    const f = accepted().find((x) => otherOf(x) === id);
    const rows = view.friendRows;
    let body;
    if (!rows) body = spinner;
    else if (!rows.length) body = `<p class="hint">${esc(personName(p))} non ha ancora anime nella lista.</p>`;
    else {
      const by = { watching: [], done: [], plan: [] };
      rows.forEach((r, i) => (by[r.status] || by.plan).push([r, i]));
      const rated = rows.filter((r) => r.rating);
      const avg = rated.length ? rated.reduce((n, r) => n + Number(r.rating), 0) / rated.length : 0;
      const tab = view.friendTab || (by.watching.length ? "watching" : by.done.length ? "done" : "plan");
      const cards = by[tab]
        .map(([r, i]) => {
          const sub = r.rating ? starsSmall(r.rating) : r.status === "watching" ? esc(r.episodes ? `Ep. ${r.ep} / ${r.episodes}` : `Ep. ${r.ep}`) : "";
          return `<button class="card" data-row="friend:${i}">
              <div class="poster-wrap"><img class="cover" src="${esc(friendCover(r))}" data-t="${esc(r.title)}" alt="" loading="lazy"></div>
              <div class="info"><div class="title">${esc(r.title)}</div><div class="sub">${sub}</div></div>
            </button>`;
        })
        .join("");
      body = `<div class="stat-grid fp-stats">
          <div class="stat-box"><b>${by.done.length}</b><span>visti</span></div>
          <div class="stat-box"><b>${by.watching.length}</b><span>in corso</span></div>
          <div class="stat-box"><b>${avg ? fmtRating(avg.toFixed(1)) : "–"}</b><span>voto medio</span></div>
        </div>
        <div class="seg">${[
          ["watching", "In corso"],
          ["done", "Visti"],
          ["plan", "Da vedere"],
        ]
          .map(([k, label]) => `<button class="seg-btn${tab === k ? " active" : ""}" data-ftab="${k}">${label}<b class="seg-c">${by[k].length}</b></button>`)
          .join("")}</div>
        ${cards ? `<div class="mini-grid">${cards}</div>` : `<p class="hint">Niente qui.</p>`}`;
    }
    return `<button class="back-btn" data-comm="back">${icon("chevron-left")}Amici</button>
      <div class="fp-head">${avatarOf(p, id, "lg")}<div><h3 class="display">${esc(personName(p))}</h3><p>@${esc(p?.username || "")}</p></div></div>
      ${body}
      ${f ? `<button class="remove-btn" data-unfriend="${esc(f.id)}">${icon("close")}Togli dagli amici</button>` : ""}`;
  }

  async function openFriend(id) {
    Object.assign(view, { friend: id, friendRows: null, friendTab: null });
    renderCommunity();
    $("#communitySheet .sheet-panel").scrollTop = 0;
    try {
      const rows = await cloud.rest(
        `library?select=anime_id,al_id,title,image,status,ep,episodes,rating,review,updated_at&user_id=eq.${encodeURIComponent(id)}&order=updated_at.desc`
      );
      if (view.friend === id) view.friendRows = rows || [];
    } catch (err) {
      if (view.friend === id) view.friendRows = [];
      toast(err.message || String(err));
    }
    if (view.friend === id) renderCommunity();
  }

  // Apre la scheda di un anime visto nella community (dalla tua lista, dal database o com'è)
  async function openAnime(r) {
    if (!r) return;
    let anime = findItem(r.anime_id);
    if (!anime) {
      await loadDB().catch(() => {});
      anime = (db && db.byId.get(r.anime_id)) || {
        id: r.anime_id,
        alId: r.al_id || undefined,
        title: r.title,
        image: animeImg(r.image) ? r.image : "",
        episodes: r.episodes || null,
        genres: [],
      };
    }
    showDetail(anime);
  }

  // ----- Azioni
  async function createProfile(form) {
    const username = form.username.value.trim().toLowerCase().replace(/^@/, "");
    const display = form.display.value.trim().slice(0, 40);
    const msg = (t) => {
      view.profileMsg = t;
      const el = $("#profileMsg");
      if (el) el.textContent = t;
    };
    if (!USERNAME_RE.test(username)) return msg("Nome utente non valido. " + USERNAME_HELP);
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await cloud.rest("profiles", { method: "POST", body: { username, display_name: display || null }, prefer: "return=minimal" });
      profile = { uid: me(), username, display_name: display };
      writeStore(PROFILE_KEY, profile);
      view.profileMsg = "";
      toast(`Benvenuto nella community, @${username}`);
    } catch (err) {
      btn.disabled = false;
      if (/profiles_pkey/.test(err.raw || "")) await fetchProfile().catch(() => {}); // creato da un altro dispositivo
      if (!profileReady()) return msg(err.message || String(err));
    }
    view.tab = "friends";
    renderCommunity();
    if ($("#detailSheet").classList.contains("open")) renderDetail();
    publishLibrary();
    refreshCommunity({ force: true });
  }

  async function addFriend(raw) {
    const msg = (t) => {
      view.msg = t;
      const el = $("#friendMsg");
      if (el) el.textContent = t;
    };
    const username = String(raw || "").trim().toLowerCase().replace(/^@/, "");
    if (!username) return msg("Scrivi il nome utente del tuo amico.");
    if (!USERNAME_RE.test(username)) return msg("Questo nome utente non esiste: " + USERNAME_HELP.toLowerCase());
    if (username === profile.username) return msg("Questo è il tuo nome utente.");
    msg("Cerco…");
    try {
      const found = await cloud.rpc("find_user", { p_username: username });
      const other = found && found[0];
      if (!other) return msg(`Nessun utente si chiama @${username}: controlla di averlo scritto giusto.`);
      comm.people.set(other.id, other);
      const existing = comm.friendships.find((f) => otherOf(f) === other.id);
      if (existing && existing.status === "accepted") return msg(`Tu e ${personName(other)} siete già amici.`);
      if (existing && existing.requester === other.id) {
        // ti aveva già chiesto l'amicizia: la accetti
        await cloud.rest(`friendships?id=eq.${existing.id}`, {
          method: "PATCH",
          body: { status: "accepted", responded_at: new Date().toISOString() },
          prefer: "return=minimal",
        });
        toast(`Ora tu e ${personName(other)} siete amici`);
      } else if (existing) {
        return msg(`Hai già chiesto l'amicizia a ${personName(other)}: aspetta che la accetti.`);
      } else {
        await cloud.rest("friendships", { method: "POST", body: { addressee: other.id }, prefer: "return=minimal" });
        toast(`Richiesta mandata a @${other.username}`);
      }
      msg("");
      const input = $("#friendInput");
      if (input) {
        input.value = "";
        input.blur();
      }
      await refreshCommunity({ force: true });
    } catch (err) {
      msg(err.message || String(err));
    }
  }

  async function changeFriendship(id, accept, okMsg) {
    try {
      if (accept) {
        await cloud.rest(`friendships?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: { status: "accepted", responded_at: new Date().toISOString() },
          prefer: "return=minimal",
        });
      } else {
        await cloud.rest(`friendships?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal" });
      }
      toast(okMsg);
    } catch (err) {
      toast(err.message || String(err));
    }
    friendViews.clear();
    await refreshCommunity({ force: true });
  }

  async function unfriend(id) {
    const f = comm.friendships.find((x) => String(x.id) === String(id));
    const name = personName(f && comm.people.get(otherOf(f)));
    if (!confirm(`Togliere ${name} dagli amici? Non vedrete più la lista l'uno dell'altro.`)) return;
    Object.assign(view, { friend: null, friendRows: null, tab: "friends" });
    await changeFriendship(id, false, `${name} non è più tra i tuoi amici`);
  }

  async function markRecsSeen() {
    const unseen = comm.recs.filter((r) => !r.seen_at);
    if (!unseen.length) return;
    const now = new Date().toISOString();
    for (const r of unseen) r.seen_at = now;
    renderBadge();
    try {
      await cloud.rest(`recommendations?to_user=eq.${profile.uid}&seen_at=is.null`, {
        method: "PATCH",
        body: { seen_at: now },
        prefer: "return=minimal",
      });
    } catch {
      for (const r of unseen) r.seen_at = null; // riprova la prossima volta
      renderBadge();
    }
  }

  async function deleteRec(id) {
    try {
      await cloud.rest(`recommendations?id=eq.${encodeURIComponent(id)}`, { method: "DELETE", prefer: "return=minimal" });
      comm.recs = comm.recs.filter((r) => String(r.id) !== String(id));
      renderCommunity();
    } catch (err) {
      toast(err.message || String(err));
    }
  }

  async function addFromRec(r) {
    if (!r || findItem(r.anime_id)) return;
    await loadDB().catch(() => {});
    const anime = (db && db.byId.get(r.anime_id)) || {
      id: r.anime_id,
      alId: r.al_id || undefined,
      title: r.title,
      image: animeImg(r.image) ? r.image : "",
      episodes: null,
      genres: [],
    };
    setStatus(anime, "plan");
    renderCommunity();
  }

  async function shareInvite() {
    const url = `${appUrl()}?amico=${encodeURIComponent(profile.username)}`;
    const text = `Aggiungimi su Animeteca: il mio nome utente è @${profile.username}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: "Animeteca", text, url });
        return;
      } catch (err) {
        if (err && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      toast("Invito copiato: incollalo in un messaggio");
    } catch {
      prompt("Copia l'invito e mandalo al tuo amico:", `${text} ${url}`);
    }
  }

  // Link d'invito: ...?amico=nome -> apre "Amici" con il nome già scritto
  function readInvite() {
    const params = new URLSearchParams(location.search);
    const name = (params.get("amico") || "").trim().toLowerCase().replace(/^@/, "");
    if (!params.has("amico")) return;
    params.delete("amico");
    const qs = params.toString();
    history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash);
    if (!USERNAME_RE.test(name) || !cloud) return;
    Object.assign(view, { tab: "friends", friend: null, prefill: name, msg: `Per aggiungere @${name} agli amici tocca “Aggiungi”.` });
    setTimeout(() => openCommunity(), 300);
  }

  $("#communitySheet").addEventListener("submit", (e) => {
    e.preventDefault();
    if (e.target.id === "profileForm") createProfile(e.target);
    else if (e.target.id === "friendForm") addFriend(e.target.username.value);
  });

  $("#communitySheet").addEventListener("click", (e) => {
    const t = e.target;
    const tab = t.closest("[data-ctab]");
    if (tab) {
      Object.assign(view, { tab: tab.dataset.ctab, friend: null, msg: "" });
      if (view.tab !== "recs") view.fresh.clear();
      renderCommunity();
      $("#communitySheet .sheet-panel").scrollTop = 0;
      return;
    }
    const action = t.closest("[data-comm]");
    if (action) {
      const a = action.dataset.comm;
      if (a === "login") {
        closeSheet("#communitySheet");
        $("#menuBtn").click();
      } else if (a === "back") {
        Object.assign(view, { friend: null, friendRows: null, tab: "friends" });
        renderCommunity();
      } else if (a === "invite") shareInvite();
      else if (a === "retry") {
        comm.missing = false;
        comm.error = "";
        renderCommunity();
        refreshCommunity({ force: true });
      }
      return;
    }
    const ftab = t.closest("[data-ftab]");
    if (ftab) {
      view.friendTab = ftab.dataset.ftab;
      return renderCommunity();
    }
    const friend = t.closest("[data-friend]");
    if (friend) return openFriend(friend.dataset.friend);
    const acc = t.closest("[data-accept]");
    if (acc) return changeFriendship(acc.dataset.accept, true, "Ora siete amici");
    const dec = t.closest("[data-decline]");
    if (dec) return changeFriendship(dec.dataset.decline, false, "Richiesta rifiutata");
    const cancel = t.closest("[data-cancel]");
    if (cancel) return changeFriendship(cancel.dataset.cancel, false, "Richiesta annullata");
    const unf = t.closest("[data-unfriend]");
    if (unf) return unfriend(unf.dataset.unfriend);
    const add = t.closest("[data-addrec]");
    if (add) return addFromRec(comm.recs[Number(add.dataset.addrec)]);
    const del = t.closest("[data-delrec]");
    if (del) return deleteRec(del.dataset.delrec);
    const row = t.closest("[data-row]");
    if (row) {
      const [kind, i] = row.dataset.row.split(":");
      const src = kind === "feed" ? comm.feed : kind === "rec" ? comm.recs : view.friendRows || [];
      return openAnime(src[Number(i)]);
    }
  });
  $("#communitySheet").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.matches("[data-row]")) {
      e.preventDefault();
      e.target.click();
    }
  });
  $("#communitySheet").addEventListener("focusout", () => {
    if (pendingCommRender) setTimeout(() => pendingCommRender && renderCommunity(), 350);
  });

  // ----- Consiglia a un amico
  let recDraft = null; // { item, to: Set di amici scelti }
  async function openRecommend(item) {
    if (!item) return;
    recDraft = { item, to: new Set() };
    renderRecommend();
    openSheet("#recSheet");
    if (!comm.at) {
      await refreshCommunity({ force: true });
      if (recDraft && recDraft.item === item) renderRecommend();
    }
  }

  function renderRecommend() {
    const item = recDraft.item;
    const friends = friendIds();
    const sub = [item.type, item.year].filter(Boolean).join(" · ");
    let body;
    if (!comm.at && comm.loading) body = spinner;
    else if (!friends.length) {
      body = `<p class="hint">Per consigliare un anime aggiungi prima qualche amico.</p>
        <button class="s-secondary" data-rec="friends">${icon("users")}Aggiungi un amico</button>`;
    } else {
      body = `<p class="eyebrow comm-sec">A chi lo consigli?</p>
        <div class="pick-list">${friends
          .map((id) => {
            const p = comm.people.get(id);
            return `<label class="pick"><input type="checkbox" value="${esc(id)}"${recDraft.to.has(id) ? " checked" : ""}>${avatarOf(p, id)}
              <span class="pe-main"><b>${esc(personName(p))}</b><span>@${esc(p?.username || "")}</span></span><i class="tick">${icon("check")}</i></label>`;
          })
          .join("")}</div>
        <textarea id="recMsg" class="note-input rec-msg" rows="2" maxlength="280" placeholder="Perché dovrebbe guardarlo? (facoltativo)"></textarea>
        <button class="real-add" id="recSend"${recDraft.to.size ? "" : " disabled"}>${icon("send")}Invia il consiglio</button>`;
    }
    $("#recBody").innerHTML = `<div class="sheet-head"><h2 class="display">Consiglia</h2>
        <button class="sheet-close" data-close aria-label="Chiudi">${icon("close")}</button></div>
      <div class="rec-anime"><img src="${esc(cover(item))}" data-t="${esc(item.title)}" alt=""><div><b>${esc(item.title)}</b><span>${esc(sub)}</span></div></div>
      ${body}`;
  }

  $("#recSheet").addEventListener("change", (e) => {
    if (e.target.type !== "checkbox" || !recDraft) return;
    if (e.target.checked) recDraft.to.add(e.target.value);
    else recDraft.to.delete(e.target.value);
    $("#recSend").disabled = !recDraft.to.size;
  });
  $("#recSheet").addEventListener("input", (e) => {
    if (e.target.id === "recMsg") autosize(e.target, 64);
  });
  $("#recSheet").addEventListener("click", async (e) => {
    if (e.target.closest('[data-rec="friends"]')) {
      closeSheet("#recSheet");
      closeSheet("#detailSheet");
      return openCommunity("friends");
    }
    if (!e.target.closest("#recSend") || !recDraft || !recDraft.to.size) return;
    const { item } = recDraft;
    const to = [...recDraft.to];
    const message = $("#recMsg").value.trim().slice(0, 280);
    const btn = $("#recSend");
    btn.disabled = true;
    try {
      await cloud.rest("recommendations", {
        method: "POST",
        body: to.map((uid) => ({
          to_user: uid,
          anime_id: String(item.id).slice(0, 40),
          al_id: Number.isInteger(item.alId) ? item.alId : null,
          title: String(item.title || "?").slice(0, 300),
          image: validImage(item.image),
          message: message || null,
        })),
        prefer: "return=minimal",
      });
      closeSheet("#recSheet");
      recDraft = null;
      toast(to.length === 1 ? `Consiglio mandato a ${personName(comm.people.get(to[0]))}` : `Consiglio mandato a ${to.length} amici`);
    } catch (err) {
      btn.disabled = false;
      toast(err.message || String(err));
    }
  });

  // ---------- Classifiche ----------
  // data/rankings.json lo prepara ogni lunedì scripts/build-rankings.mjs: per ogni anime il voto è la
  // media tra AniList e la media dei siti (MyAnimeList, Kitsu, AniDB...) del database manami-project.
  // items[id] = [alId, malId, titolo, tipo, anno, episodi, copertina, voto, AniList, mediaSiti]
  const RANK_TABS = [
    ["top", "Migliori"],
    ["genres", "Generi"],
    ["year", "Anno"],
  ];
  const rank = { tab: "top", genre: null, year: null };
  let rankings = null;
  let rankingsPromise = null;

  function loadRankings() {
    if (!rankingsPromise) {
      rankingsPromise = fetch("data/rankings.json")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
        .then((json) => {
          rankings = json && json.version === 1 ? json : null;
          if (!rankings) rankingsPromise = null; // riprova alla prossima apertura
          return rankings;
        });
    }
    return rankingsPromise;
  }

  const oneDecimal = (v) => (Math.round(v * 10) / 10).toFixed(1).replace(".", ",");
  const dayIt = (iso) => (iso ? new Date(iso).toLocaleDateString("it-IT") : "?");

  function rankRow(id, n) {
    const it = rankings.items[id];
    if (!it) return "";
    const [, , title, type, year, episodes, cover, score, al, sites] = it;
    const img = cover ? (cover.startsWith("http") ? cover : rankings.coverPrefix + cover) : placeholder(title);
    const sub = [type, year, episodes && `${episodes} ep.`].filter(Boolean).join(" · ");
    const src = [al != null && `AniList ${oneDecimal(al)}`, sites != null && `Media siti ${oneDecimal(sites)}`].filter(Boolean).join(" · ");
    const mine = findItem(id);
    return `<button class="rank-row" data-rid="${esc(id)}">
        <span class="rank-n display">${n}</span>
        <img src="${esc(img)}" data-t="${esc(title)}" alt="" loading="lazy">
        <span class="r-main"><span class="r-title">${esc(title)}</span><span class="r-sub">${esc(sub)}</span><span class="rank-src">${esc(src)}</span></span>
        <span class="rank-side"><b class="rank-score">${oneDecimal(score)}</b>${mine ? `<span class="r-tag">${esc(STATUS[mine.status])}</span>` : ""}</span>
      </button>`;
  }

  function renderRankings() {
    const box = $("#rankBody");
    const r = rankings;
    // la riga dei generi/anni resta dov'era quando si ridisegna la stessa scheda
    const oldStrip = box.querySelector(".rank-chips");
    const keepScroll = oldStrip && box.dataset.tab === rank.tab ? oldStrip.scrollLeft : 0;
    box.dataset.tab = rank.tab;
    if (!r) {
      box.innerHTML = emptyComm(
        "trophy",
        "Classifiche in arrivo",
        "Le classifiche arrivano con il prossimo aggiornamento del database, che si fa da solo ogni lunedì."
      );
      return;
    }
    let chips = "";
    let ids = r.top;
    if (rank.tab === "genres") {
      const genres = Object.keys(r.genres).sort((a, b) => genreLabel(a).localeCompare(genreLabel(b), "it"));
      if (!genres.includes(rank.genre)) rank.genre = genres.includes("Action") ? "Action" : genres[0];
      chips = genres
        .map((g) => `<button class="rank-chip${g === rank.genre ? " active" : ""}" data-genre="${esc(g)}">${esc(genreLabel(g))}</button>`)
        .join("");
      ids = r.genres[rank.genre] || [];
    } else if (rank.tab === "year") {
      const years = Object.keys(r.years).sort((a, b) => b - a);
      // si parte dall'anno più recente; se ha ancora pochi titoli (es. a gennaio), dal precedente
      if (!years.includes(rank.year)) rank.year = (r.years[years[0]] || []).length >= 10 || years.length < 2 ? years[0] : years[1];
      chips = years.map((y) => `<button class="rank-chip${y === rank.year ? " active" : ""}" data-year="${y}">${y}</button>`).join("");
      ids = r.years[rank.year] || [];
    }
    box.innerHTML = `<div class="seg" role="tablist">${RANK_TABS.map(
      ([k, label]) => `<button role="tab" class="seg-btn${rank.tab === k ? " active" : ""}" data-rtab="${k}" aria-selected="${rank.tab === k}">${label}</button>`
    ).join("")}</div>
      ${chips ? `<div class="rank-chips">${chips}</div>` : ""}
      ${r.sources.sites ? "" : `<p class="rank-note">Questa settimana solo AniList: la media degli altri siti non era disponibile.</p>`}
      <div class="rank-list">${ids.length ? ids.map((id, i) => rankRow(id, i + 1)).join("") : `<p class="hint">Nessun titolo qui.</p>`}</div>
      <p class="stats-note">Voto: media tra AniList e la media dei siti (MyAnimeList, Kitsu, AniDB, Anime-Planet e altri) del database pubblico
        <a href="https://github.com/manami-project/anime-offline-database" target="_blank" rel="noopener">anime-offline-database</a>.
        Entrano solo anime con abbastanza voti. Aggiornate il ${dayIt(r.updated)}${r.sitesUpdated ? ` · media dei siti del ${dayIt(r.sitesUpdated)}` : ""}.</p>`;
    const strip = box.querySelector(".rank-chips");
    if (strip && keepScroll) strip.scrollLeft = keepScroll;
  }

  // Tocco su un anime: la sua scheda (dalla tua lista o dal database dell'app, altrimenti con i dati della classifica)
  async function openRanked(id) {
    const it = rankings && rankings.items[id];
    if (!it) return;
    const [alId, malId, title, type, year, episodes, cover] = it;
    let anime = findItem(id);
    if (!anime) {
      await loadDB().catch(() => {});
      // per id AniList prima: più voci possono avere lo stesso id MyAnimeList
      anime = (db && (db.byAl.get(alId) || db.byId.get(id))) || null;
      if (anime && findItem(anime.id)) anime = findItem(anime.id);
    }
    showDetail(
      anime || { id, alId, malId: malId || null, title, type, year: year || null, episodes: episodes || null, image: cover ? rankings.coverPrefix + cover : "", genres: [] }
    );
  }

  $("#rankBtn").addEventListener("click", async () => {
    openSheet("#rankSheet");
    if (!rankings) {
      $("#rankBody").innerHTML = spinner;
      await loadRankings();
    }
    renderRankings();
  });

  $("#rankSheet").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-rtab]");
    if (tab) {
      rank.tab = tab.dataset.rtab;
      renderRankings();
      $("#rankSheet .sheet-panel").scrollTop = 0;
      return;
    }
    const genre = e.target.closest("[data-genre]");
    if (genre) {
      rank.genre = genre.dataset.genre;
      return renderRankings();
    }
    const year = e.target.closest("[data-year]");
    if (year) {
      rank.year = year.dataset.year;
      return renderRankings();
    }
    const row = e.target.closest("[data-rid]");
    if (row) openRanked(row.dataset.rid);
  });

  // ---------- Backup ----------
  $("#menuBtn").addEventListener("click", () => {
    renderAccount();
    openSheet("#menuSheet");
    const info = $("#dbInfo");
    info.textContent = "Database anime: caricamento…";
    loadDB()
      .then((d) => {
        const when = d.updated ? new Date(d.updated).toLocaleDateString("it-IT") : "?";
        info.textContent = `Database anime: ${d.items.length.toLocaleString("it-IT")} titoli, aggiornato il ${when}`;
      })
      .catch(() => {
        info.textContent = "Database anime non ancora disponibile: la ricerca usa internet.";
      });
  });

  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "animeteca", version: 3, list, log, real }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `animeteca-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast("Backup esportato");
  });

  $("#importInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const items = Array.isArray(data) ? data : data.list;
      if (!Array.isArray(items) || !items.every((a) => a && a.id && a.title && STATUS[a.status])) {
        throw new Error("formato non valido");
      }
      if (!confirm(`Importare ${items.length} anime? La lista attuale verrà sostituita.`)) return;
      list = items;
      log = Array.isArray(data.log) ? data.log.filter((e) => e && e.t && e.id) : [];
      save();
      saveLog();
      real = Array.isArray(data.real) ? data.real.filter((e) => e && e.t && e.m > 0) : [];
      saveReal();
      deleted = { anime: {}, real: {} };
      saveDeleted();
      closeSheet("#menuSheet");
      renderAll();
      toast(`Importati ${items.length} anime`);
      syncNow({ force: true }); // con l'account, il backup sostituisce anche i dati online
    } catch (err) {
      toast("File non valido: " + err.message);
    }
  });

  // Niente zoom pizzicando lo schermo (Safari/Brave su iPhone e iPad)
  for (const type of ["gesturestart", "gesturechange"]) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  // ---------- Avvio ----------
  renderAll();
  readInvite();
  renderAccount();
  renderBadge();
  handleAuthRedirect().then(() => syncNow());

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();

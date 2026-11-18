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
    if (item.seasons && item.synopsis !== undefined) return;
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
    if (!item.synopsis) item.synopsis = d[0];
    if (!item.genres?.length) item.genres = d[1];
    item.seasons = d[2];
    if (findItem(item.id) === item) save();
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
    const timerOn = session && session.id === a.id;
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
          </div>
          <div class="hero-actions">
            ${finished ? "" : `<button class="btn btn-primary" data-hero-plus>${icon("check")}Ho visto l'ep. ${a.ep + 1}</button>`}
            <button class="btn btn-ghost" data-hero-timer>${icon("timer")}${timerOn ? "Timer attivo" : "Timer"}</button>
          </div>
        </div>
      </section>
      <p class="eyebrow section-label">Tutti in corso</p>`;
  }

  function renderGrid() {
    renderHero();
    const grid = $("#grid");
    const items = list
      .filter((a) => a.status === currentTab)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

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

    grid.innerHTML = items
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
        }
        return `<button class="card" data-open="${esc(a.id)}">
          <div class="poster-wrap">
            <img class="cover" src="${esc(cover(a))}" data-t="${esc(a.title)}" alt="" loading="lazy">
            ${corner}${bar}
          </div>
          <div class="info"><div class="title">${esc(a.title)}</div><div class="sub">${esc(sub)}</div></div>
        </button>`;
      })
      .join("");
  }

  // ---------- Scheda anime ----------
  function renderDetail() {
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
    const synopsis = item.synopsis || (loading ? "Caricamento della descrizione…" : "Nessuna descrizione disponibile.");
    const long = synopsis.length > 280;
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
        ${saved ? timerButton(item) : ""}
        <p class="synopsis ${long ? "clamp" : ""}" id="synopsis">${esc(synopsis)}</p>
        ${long ? `<button class="more" id="moreBtn">Leggi tutto</button>` : ""}
        ${genres ? `<p class="genres">${esc(genres)}</p>` : ""}
        ${wiki}
        ${seasonsHtml}
        ${saved ? `<button class="remove-btn" id="removeBtn">${icon("trash")}Rimuovi dalla lista</button>` : ""}
      </div>`;
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
    if (e.target.closest("[data-hero-timer]")) {
      if (session) openSessionSheet(false);
      else startSession(item);
      return renderHero();
    }
    showDetail(item);
  });

  $("#grid").addEventListener("click", (e) => {
    if (e.target.closest('[data-action="search"]')) return $("#addBtn").click();
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

  $("#detail").addEventListener("click", (e) => {
    if (e.target.closest("#timerDetail")) {
      if (session) openSessionSheet(false);
      else startSession(findItem(openItem.id));
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

  const localDate = (d = new Date()) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Riquadro "tempo reale": sessioni del timer + segnalibro + aggiunte a mano
  let manualOpen = false; // la sezione "a mano" resta aperta dopo un inserimento
  let bmOpen = false;
  function realSection() {
    const now = new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sum = (from) => real.filter((e) => e.t >= from).reduce((n, e) => n + e.m, 0);
    const total = real.reduce((n, e) => n + e.m, 0);
    const recent = [...real].sort((a, b) => b.t - a.t).slice(0, 6);
    const day = (t) => new Date(t).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
    const srcIcon = (s) => icon(s === "timer" ? "timer" : s === "saturn" ? "bookmark" : "pencil");
    return `
      <p class="eyebrow stats-sec">Tempo reale</p>
      <div class="big-stat real"><div class="num display">${esc(fmtTime(total))}</div><div class="cap">${
        real.length
          ? `${esc(fmtTime(sum(t0)))} oggi · ${esc(fmtTime(sum(t0 - 6 * 86400000)))} negli ultimi 7 giorni`
          : "Misurato con il timer o con il segnalibro di AnimeSaturn."
      }</div></div>
      ${
        session
          ? `<button class="timer-btn on" id="timerStats">${icon("timer")}Timer attivo${session.title ? ` · ${esc(session.title)}` : ""}</button>`
          : `<button class="timer-btn" id="timerStats">${icon("timer")}Avvia il timer</button>`
      }
      ${recent
        .map(
          (e) => `<div class="real-row">${srcIcon(e.s)}<span>${esc(day(e.t))}${e.title ? ` · ${esc(e.title)}` : ""}</span><b>${esc(fmtTime(e.m))}</b><button data-real-del="${e.t}" aria-label="Elimina">${icon("close")}</button></div>`
        )
        .join("")}
      <details class="manual bm" ${bmOpen ? "open" : ""}>
        <summary>Tempo automatico su AnimeSaturn${icon("chevron-down", "chev")}</summary>
        <ol class="steps">
          <li>Tocca <b>Copia segnalibro</b> qui sotto.</li>
          <li>In Brave salva nei segnalibri una pagina qualsiasi.</li>
          <li>Apri i <b>Segnalibri</b>, tocca la matita e poi il segnalibro nuovo: come nome scrivi <b>Anime</b>, nell'indirizzo cancella tutto e incolla.</li>
          <li>Su AnimeSaturn, quando inizi un episodio, apri i Segnalibri e tocca <b>Anime</b>: in basso compare un contatore che va solo mentre la pagina è davanti a te.</li>
          <li>Quando vuoi, tocca <b>Invia</b> sul contatore: il tempo arriva qui.</li>
        </ol>
        <button type="button" class="real-add" id="copyBm">${icon("bookmark")}Copia segnalibro</button>
        <textarea class="bm-code" id="bmCode" readonly rows="3">${esc(bookmarkletCode())}</textarea>
        <button type="button" class="link-btn" id="copyBmLong">Brave non salva il segnalibro? Prova la versione lunga</button>
      </details>
      <details class="manual" ${manualOpen ? "open" : ""}>
        <summary>Aggiungi tempo a mano${icon("chevron-down", "chev")}</summary>
        <form class="real-form" id="realForm">
          <label>Giorno<input type="date" name="day" value="${localDate()}" max="${localDate()}" required></label>
          <label>Ore<input type="number" name="h" min="0" max="24" inputmode="numeric" placeholder="0"></label>
          <label>Min<input type="number" name="min" min="0" max="59" inputmode="numeric" placeholder="0"></label>
          <button type="submit" class="real-add">Aggiungi</button>
        </form>
      </details>
      <p class="stats-note">Il timer: premi <b>Inizia a guardare</b> nella scheda di un anime, poi passa alla scheda dove guardi. L'app conta il tempo in cui sei fuori e, quando torni, ti chiede quanto hai visto.</p>`;
  }

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
      box.innerHTML = `<div class="empty">${icon("chart")}<h3 class="display">Ancora nessun dato</h3><p>Segna gli episodi che guardi: qui vedrai quanto tempo passi sugli anime.</p></div>${realSection()}`;
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
      ${realSection()}
      ${topGenres.length ? `<p class="eyebrow stats-sec">Generi più visti</p>${topGenres
        .map(([g, n]) => `<div class="genre-row"><span class="g-name">${esc(genreLabel(g))}</span><span class="g-bar"><i style="width:${(n / maxG) * 100}%"></i></span><span class="g-val">${n} ep.</span></div>`)
        .join("")}` : ""}
      <p class="stats-note">Tempo stimato: ogni episodio segnato conta per la sua durata (di solito 23–24 minuti). Oggi, settimana e mese dipendono da quando hai segnato gli episodi.</p>`;
  }

  $("#stats").addEventListener("submit", (e) => {
    if (e.target.id !== "realForm") return;
    e.preventDefault();
    const f = new FormData(e.target);
    const m = (parseInt(f.get("h"), 10) || 0) * 60 + (parseInt(f.get("min"), 10) || 0);
    const [y, mo, d] = String(f.get("day")).split("-").map(Number);
    if (!m || !y) return toast("Inserisci ore o minuti");
    const t = new Date(y, mo - 1, d, 12).getTime();
    // Un solo valore manuale per giorno: se esiste già, lo sostituisce (le sessioni del timer restano)
    real = real.filter((x) => x.s === "timer" || localDate(new Date(x.t)) !== localDate(new Date(t)));
    real.push({ t, m, s: "manual", u: Date.now() });
    saveReal();
    toast(`Aggiunto: ${fmtTime(m)}`);
    renderStats();
  });
  $("#stats").addEventListener(
    "toggle",
    (e) => {
      if (e.target.classList?.contains("bm")) bmOpen = e.target.open;
      else if (e.target.classList?.contains("manual")) manualOpen = e.target.open;
    },
    true
  );
  $("#stats").addEventListener("click", (e) => {
    if (e.target.closest("#copyBm")) return copyBookmarklet(false);
    if (e.target.closest("#copyBmLong")) return copyBookmarklet(true);
    if (e.target.closest("#timerStats")) {
      if (session) openSessionSheet(false);
      else startSession(null);
      return renderStats();
    }
    const del = e.target.closest("[data-real-del]");
    if (!del) return;
    for (const x of real) if (String(x.t) === del.dataset.realDel) deleted.real[`${x.s || "manual"}|${x.t}`] = Date.now();
    saveDeleted();
    real = real.filter((x) => String(x.t) !== del.dataset.realDel);
    saveReal();
    renderStats();
  });

  $("#statsBtn").addEventListener("click", () => {
    loadDB().catch(() => {}).then(() => {
      renderStats();
    });
    renderStats();
    openSheet("#statsSheet");
  });

  // ---------- Segnalibro per AnimeSaturn ----------
  // Il cronometro vero è in saturn.js. Il segnalibro "corto" lo carica dal sito
  // (Brave per iPad non salva segnalibri troppo lunghi); quello "lungo" lo contiene tutto.
  const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");

  function bookmarkletCode() {
    const code =
      "(function(){var s=document.createElement('script');s.src='" + appUrl() + "saturn.js?v='+Date.now();" +
      "(document.body||document.documentElement).appendChild(s);})()";
    return "javascript:" + encodeURIComponent(code);
  }

  function longBookmarkletCode() {
    if (!window.saturnBookmarklet) return "";
    // spazi compressi per un codice più corto (la funzione usa sempre il ";" e non ha commenti "//")
    const src = window.saturnBookmarklet.toString().replace(/\s+/g, " ");
    return "javascript:" + encodeURIComponent("(" + src + ")(" + JSON.stringify(appUrl()) + ");void 0");
  }

  function copyBookmarklet(long) {
    const code = long ? longBookmarkletCode() : bookmarkletCode();
    const fallback = () => {
      const ta = $("#bmCode");
      ta.value = code;
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, code.length);
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        /* nessuna copia automatica */
      }
      toast(ok ? "Segnalibro copiato!" : "Seleziona il testo qui sotto e copialo");
    };
    const done = () => toast(long ? "Versione lunga copiata!" : "Segnalibro copiato!");
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(done, fallback);
    else fallback();
  }

  // L'Animeteca aperta dal pulsante "Invia" del segnalibro: ?saturn={h: sito, d: {giorno: secondi}}
  function importSaturn() {
    const raw = new URLSearchParams(location.search).get("saturn");
    if (!raw) return;
    history.replaceState(null, "", location.pathname);
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return toast("Dati di AnimeSaturn non validi");
    }
    const host = String(data?.h || "animesaturn").slice(0, 80);
    let days = 0;
    let todayMin = 0;
    for (const [day, sec] of Object.entries(data?.d || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const m = Math.round(Number(sec) / 60);
      if (!(m > 0) || m > 1440) continue;
      const [y, mo, d] = day.split("-").map(Number);
      // Il segnalibro manda sempre il totale del giorno: sostituisce, non somma
      real = real.filter((x) => !(x.s === "saturn" && x.day === day && x.host === host));
      real.push({ t: new Date(y, mo - 1, d, 12).getTime(), m, s: "saturn", day, host, title: "AnimeSaturn", u: Date.now() });
      days++;
      if (day === localDate()) todayMin = m;
    }
    saveReal();
    toast(days ? `AnimeSaturn aggiornato · oggi ${fmtTime(todayMin)}` : "Nessun tempo da importare (serve almeno 1 minuto)");
    renderStats();
    openSheet("#statsSheet");
  }

  // ---------- Timer di visione ----------
  // L'app non può vedere cosa succede nelle altre schede di Brave, ma sa quando la lasci
  // e quando ci torni: il tempo passato fuori, durante una visione, è il tempo di visione.
  const SESSION_KEY = "animeteca.session.v1";
  const MIN_AWAY_MS = 60 * 1000; // uscite brevi (meno di 1 minuto) non contano
  const LONG_AWAY_MS = 3 * 3600 * 1000; // oltre 3 ore probabilmente il timer è stato dimenticato
  let session = loadSession();
  let sessionEps = 0;

  function loadSession() {
    try {
      const d = JSON.parse(localStorage.getItem(SESSION_KEY));
      return d && d.start ? d : null;
    } catch {
      return null;
    }
  }
  function saveSession() {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch {
      /* senza memoria il timer vale solo finché la pagina resta aperta */
    }
  }

  function timerButton(item) {
    if (!session) return `<button class="timer-btn" id="timerDetail">${icon("timer")}Inizia a guardare</button>`;
    if (session.id === item.id) return `<button class="timer-btn on" id="timerDetail">${icon("timer")}Timer attivo · Termina</button>`;
    return `<button class="timer-btn" id="timerDetail">${icon("timer")}Timer attivo su ${esc(session.title || "un altro anime")} · Chiudilo</button>`;
  }

  function startSession(item) {
    session = { start: Date.now(), id: item?.id || null, title: item?.title || "", awayMs: 0, hiddenAt: null, lastAway: 0 };
    saveSession();
    renderTimer();
    toast("Timer avviato. Ora vai a guardare.");
  }

  function endSession() {
    session = null;
    saveSession();
    closeSheet("#sessionSheet");
    renderTimer();
    renderAll();
    if ($("#statsSheet").classList.contains("open")) renderStats();
  }

  function onHide() {
    if (session && !session.hiddenAt) {
      session.hiddenAt = Date.now();
      saveSession();
    }
  }
  function onShow() {
    if (!session || !session.hiddenAt) return;
    const away = Date.now() - session.hiddenAt;
    session.hiddenAt = null;
    if (away >= MIN_AWAY_MS) {
      session.awayMs += away;
      session.lastAway = away;
      saveSession();
      renderTimer();
      openSessionSheet(true);
    } else {
      saveSession();
    }
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? onHide() : onShow()));
  window.addEventListener("pagehide", onHide);
  window.addEventListener("pageshow", () => {
    if (!document.hidden) onShow();
  });

  // Barra in basso "in riproduzione", visibile mentre il timer è attivo
  function renderTimer() {
    const bar = $("#timerBar");
    document.body.classList.toggle("timer-on", Boolean(session));
    if (!session) {
      bar.hidden = true;
      renderHero();
      return;
    }
    const item = session.id ? findItem(session.id) : null;
    const min = Math.round(session.awayMs / 60000);
    bar.hidden = false;
    bar.innerHTML = `${
      item
        ? `<img class="t-thumb" src="${esc(cover(item))}" data-t="${esc(item.title)}" alt="">`
        : `<span class="t-icon">${icon("timer")}</span>`
    }
      <div class="t-text"><b>${esc(session.title || "Timer di visione")}</b><span><i class="t-dot"></i>${
        min ? `${esc(fmtTime(min))} contati finora` : "In attesa: vai a guardare l'episodio"
      }</span></div>
      <button id="timerEnd" class="btn btn-primary">Termina</button>`;
    renderHero();
  }
  $("#timerBar").addEventListener("click", (e) => {
    if (e.target.closest("#timerEnd")) openSessionSheet(false);
  });

  // Riepilogo: quanto hai guardato e quanti episodi
  function openSessionSheet(fromReturn) {
    if (!session) return;
    const item = session.id ? findItem(session.id) : null;
    const total = Math.round(session.awayMs / 60000);
    const last = Math.round(session.lastAway / 60000);
    const forgot = session.lastAway > LONG_AWAY_MS;
    const remaining = item?.episodes ? item.episodes - item.ep : Infinity;
    sessionEps = item && !forgot ? Math.min(remaining, Math.round(total / durationOf(item))) : 0;

    let lead;
    if (!total) lead = "Non sei ancora uscito dall'app, quindi non c'è niente da contare. Se hai guardato, scrivi i minuti qui sotto.";
    else if (fromReturn && total !== last) lead = `Sei stato via <b>${esc(fmtTime(last))}</b>. In tutto, per questa visione: <b>${esc(fmtTime(total))}</b>.`;
    else lead = `${fromReturn ? "Sei stato via" : "Tempo contato"}: <b>${esc(fmtTime(total))}</b>.`;

    $("#sessionBody").innerHTML = `
      <h2 class="s-title display">${fromReturn ? "Bentornato" : "Fine visione"}</h2>
      <p class="s-lead">${lead}</p>
      ${forgot ? `<p class="s-warn">${icon("alert")}<span>Sei stato via parecchio: forse hai lasciato il timer acceso. Correggi i minuti qui sotto.</span></p>` : ""}
      <label class="s-field"><span class="eyebrow">Minuti guardati</span><input type="number" id="sessMin" min="0" max="1440" inputmode="numeric" value="${total || ""}" placeholder="0"></label>
      ${
        item
          ? `<div class="episodes s-eps">
              <div>
                <div class="label">Episodi di ${esc(item.title)}</div>
                <div class="count display" id="sessEps">${sessionEps}</div>
                <div class="eps-to" id="sessEpsTo"></div>
              </div>
              <div class="stepper">
                <button data-sess-ep="-1" aria-label="Un episodio in meno">${icon("minus")}</button>
                <button data-sess-ep="1" class="plus" aria-label="Un episodio in più">${icon("plus")}</button>
              </div>
            </div>`
          : ""
      }
      <button class="real-add" id="sessSave">Salva</button>
      <button class="s-secondary" id="sessContinue">Sto ancora guardando</button>
      <button class="remove-btn" id="sessDiscard">Scarta il timer</button>`;
    updateSessionEps();
    openSheet("#sessionSheet");
  }

  function updateSessionEps() {
    const item = session?.id ? findItem(session.id) : null;
    if (!item) return;
    $("#sessEps").textContent = sessionEps;
    const to = item.episodes ? Math.min(item.episodes, item.ep + sessionEps) : item.ep + sessionEps;
    $("#sessEpsTo").textContent = `ep. ${item.ep} → ${to}${item.episodes ? " / " + item.episodes : ""}`;
  }

  $("#sessionSheet").addEventListener("click", (e) => {
    if (!session) return;
    const item = session.id ? findItem(session.id) : null;
    const step = e.target.closest("[data-sess-ep]");
    if (step && item) {
      const remaining = item.episodes ? item.episodes - item.ep : Infinity;
      sessionEps = Math.max(0, Math.min(remaining, sessionEps + Number(step.dataset.sessEp)));
      return updateSessionEps();
    }
    if (e.target.closest("#sessContinue")) {
      closeSheet("#sessionSheet");
      return renderTimer();
    }
    if (e.target.closest("#sessDiscard")) {
      if (confirm("Scartare questo timer? Il tempo non verrà salvato.")) {
        endSession();
        toast("Timer scartato");
      }
      return;
    }
    if (e.target.closest("#sessSave")) {
      const m = Math.max(0, Math.min(1440, parseInt($("#sessMin").value, 10) || 0));
      if (m) {
        real.push({ t: Date.now(), m, s: "timer", id: session.id, title: session.title, u: Date.now() });
        saveReal();
      }
      const eps = item ? sessionEps : 0;
      if (eps) setEpisode(item, item.ep + eps);
      const parts = [m && fmtTime(m), eps && `+${eps} ${eps === 1 ? "episodio" : "episodi"}`].filter(Boolean);
      endSession();
      toast(parts.length ? `Salvato: ${parts.join(" · ")}` : "Timer chiuso");
    }
  });

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
    renderTimer();
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
  renderTimer();
  if (!document.hidden) onShow();
  importSaturn();
  renderAccount();
  handleAuthRedirect().then(() => syncNow());

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();

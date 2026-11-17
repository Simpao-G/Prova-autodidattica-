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
  const STATUS = {
    watching: "In corso",
    plan: "Da vedere",
    done: "Guardato",
  };

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
      toast("⚠️ Impossibile salvare i dati");
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
      toast("⚠️ Impossibile salvare i dati");
    }
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
  }

  // ---------- Utilità ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const esc = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function placeholder(title) {
    const letters = (title || "?").trim().slice(0, 2).toUpperCase();
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff5c9a"/><stop offset="1" stop-color="#8b5cf6"/></linearGradient></defs><rect width="200" height="300" fill="url(#g)"/><text x="100" y="170" font-family="sans-serif" font-size="72" font-weight="800" fill="#fff" text-anchor="middle">${esc(letters)}</text></svg>`;
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
    toast(isNew ? `Aggiunto a "${STATUS[status]}"` : `Spostato in "${STATUS[status]}"`);
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
      toast("Completato! 🎉");
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

  function renderGrid() {
    const grid = $("#grid");
    const items = list
      .filter((a) => a.status === currentTab)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    if (!items.length) {
      const msg = {
        watching: ["📺", "Nessun anime in corso.", "Aggiungine uno con il pulsante ＋"],
        plan: ["📝", "La lista dei desideri è vuota.", "Cerca un anime e premi “Da vedere”"],
        done: ["🏆", "Ancora nessun anime finito.", "Forza, puoi farcela!"],
      }[currentTab];
      grid.innerHTML = `<div class="empty"><div class="big">${msg[0]}</div><p><strong>${msg[1]}</strong></p><p>${msg[2]}</p></div>`;
      return;
    }

    grid.innerHTML = items
      .map((a) => {
        let corner = "";
        let sub = [a.type, a.year].filter(Boolean).join(" · ");
        if (a.status === "watching") {
          corner = `<span class="quick-plus" role="button" data-plus="${esc(a.id)}" aria-label="Episodio successivo">+1</span>`;
          sub = `Ep. ${epLabel(a)}`;
        } else if (a.status === "done") {
          corner = `<span class="badge-done">✓ Visto</span>`;
        }
        const bar = a.status === "watching" && a.episodes ? `<div class="progress"><i style="width:${pct(a)}%"></i></div>` : "";
        return `<button class="card" data-open="${esc(a.id)}">
          <img class="cover" src="${esc(cover(a))}" data-t="${esc(a.title)}" alt="" loading="lazy">
          ${corner}
          <div class="info"><div class="title">${esc(a.title)}</div><div class="sub">${esc(sub)}</div>${bar}</div>
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

    const chips = [
      item.type && `<span class="chip">${esc(item.type)}</span>`,
      item.year && `<span class="chip">${esc(item.year)}</span>`,
      item.episodes && `<span class="chip">${esc(item.episodes)} episodi</span>`,
      item.score && `<span class="chip star">★ ${esc(item.score)}</span>`,
      ...(item.genres || []).map((g) => `<span class="chip">${esc(g)}</span>`),
    ].filter(Boolean).join("");

    const episodes = saved
      ? `<div class="episodes">
          <div>
            <div class="label">Episodio a cui sei arrivato</div>
            <div class="count">${esc(item.ep)}${item.episodes ? ` <small>/ ${esc(item.episodes)}</small>` : ""}</div>
            ${item.episodes ? `<div class="progress"><i style="width:${pct(item)}%"></i></div>` : ""}
          </div>
          <div class="stepper">
            <button data-ep="-1" aria-label="Episodio precedente">−</button>
            <button data-ep="1" class="plus" aria-label="Episodio successivo">＋</button>
          </div>
        </div>`
      : "";

    const loading = item.synopsis === undefined && item.alId;
    const synopsis = item.synopsis || (loading ? "Caricamento descrizione…" : "Nessuna descrizione disponibile.");
    const long = synopsis.length > 280;
    const wiki = item.url
      ? `<a class="wiki-link" href="${esc(item.url)}" target="_blank" rel="noopener">Apri su ${item.url.includes("anilist") ? "AniList" : "MyAnimeList"} ↗</a>`
      : "";

    // Stagioni e film della stessa serie
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
            <div class="s-text"><div class="s-title">${esc(s.title)}</div><div class="s-sub">${esc(sub)}</div></div>
            ${here ? `<span class="s-tag">Questa</span>` : mine ? `<span class="s-tag ok">✓ ${esc(STATUS[mine.status])}</span>` : ""}
          </button>`;
        })
        .join("");
      seasonsHtml = `<h3 class="section-title">Stagioni e film</h3><p class="season-sum">${esc(summary)}</p><div class="seasons">${rows}</div>`;
    }

    $("#detail").innerHTML = `
      <div class="hero">
        <img class="bg" src="${esc(cover(item))}" data-t="${esc(item.title)}" alt="">
        <img class="poster" src="${esc(cover(item))}" data-t="${esc(item.title)}" alt="Copertina di ${esc(item.title)}">
        <button class="close" data-close aria-label="Chiudi">✕</button>
      </div>
      <div class="detail-body">
        <h2 class="detail-title"><mark>${esc(item.title)}</mark></h2>
        ${item.altTitle ? `<div style="text-align:center;color:var(--muted);font-size:13px">${esc(item.altTitle)}</div>` : ""}
        <div class="chips">${chips}</div>
        ${episodes}
        ${saved ? timerButton(item) : ""}
        <p class="synopsis ${long ? "clamp" : ""}" id="synopsis">${esc(synopsis)}</p>
        ${long ? `<button class="more" id="moreBtn">Leggi tutto</button><br>` : ""}
        ${wiki}
        <div class="status-row">
          ${Object.entries(STATUS)
            .map(([key, label]) => `<button class="status-btn ${status === key ? "active" : ""}" data-status="${key}">${label}</button>`)
            .join("")}
        </div>
        ${seasonsHtml}
        ${saved ? `<button class="remove-btn" id="removeBtn">Rimuovi dalla lista</button>` : ""}
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
            <div><div class="r-title">${esc(r.title)}</div><div class="r-sub">${esc(sub)}</div></div>
            ${saved ? `<span class="r-tag">✓ ${esc(STATUS[saved.status])}</span>` : ""}
          </button>`;
        })
        .join("") + manualButton();
  }
  const manualButton = () => `<button class="manual-btn" id="manualBtn">Non lo trovi? Aggiungilo a mano</button>`;

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

  $("#grid").addEventListener("click", (e) => {
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

  // Riquadro "tempo reale": sessioni del timer + eventuali aggiunte a mano
  let manualOpen = false; // la sezione "a mano" resta aperta dopo un inserimento
  let bmOpen = false;
  function realSection() {
    const now = new Date();
    const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const sum = (from) => real.filter((e) => e.t >= from).reduce((n, e) => n + e.m, 0);
    const total = real.reduce((n, e) => n + e.m, 0);
    const recent = [...real].sort((a, b) => b.t - a.t).slice(0, 6);
    const day = (t) => new Date(t).toLocaleDateString("it-IT", { weekday: "short", day: "numeric", month: "short" });
    return `
      <h3 class="stats-sec">Tempo reale di visione</h3>
      <div class="big-stat real"><div class="num">${esc(fmtTime(total))}</div><div class="cap">${
        real.length
          ? `${esc(fmtTime(sum(t0)))} oggi · ${esc(fmtTime(sum(t0 - 6 * 86400000)))} negli ultimi 7 giorni`
          : "misurato con il timer ⏱ o il segnalibro 🪐"
      }</div></div>
      ${
        session
          ? `<button class="timer-btn on" id="timerStats">⏱ Timer attivo${session.title ? ` · ${esc(session.title)}` : ""} · Fine visione</button>`
          : `<button class="timer-btn" id="timerStats">⏱ Avvia il timer</button>`
      }
      ${recent
        .map(
          (e) => `<div class="real-row"><span>${e.s === "timer" ? "⏱" : e.s === "saturn" ? "🪐" : "✍️"} ${esc(day(e.t))}${e.title ? ` · ${esc(e.title)}` : ""}</span><b>${esc(fmtTime(e.m))}</b><button data-real-del="${e.t}" aria-label="Elimina">✕</button></div>`
        )
        .join("")}
      <details class="manual bm" ${bmOpen ? "open" : ""}>
        <summary>🪐 Tempo automatico su AnimeSaturn</summary>
        <ol class="steps">
          <li>Tocca <b>Copia segnalibro</b> qui sotto.</li>
          <li>In Brave salva nei segnalibri una pagina qualsiasi.</li>
          <li>Apri i <b>Segnalibri</b>, tieni premuto quello nuovo e scegli <b>Modifica</b>: come nome scrivi <b>⏱ Anime</b>, nell'indirizzo cancella tutto e incolla.</li>
          <li>Su AnimeSaturn, quando inizi un episodio, apri i Segnalibri e tocca <b>⏱ Anime</b>: in basso compare un contatore che va solo mentre la pagina è aperta davanti a te. Se cambi episodio, toccalo di nuovo (il tempo già contato resta).</li>
          <li>Quando vuoi, tocca <b>Invia</b> sul contatore: si apre l'Animeteca con il tempo aggiornato.</li>
        </ol>
        <button type="button" class="real-add" id="copyBm">Copia segnalibro</button>
        <textarea class="bm-code" id="bmCode" readonly rows="3">${esc(bookmarkletCode())}</textarea>
        <p class="stats-note">Usa l'Animeteca in una scheda di Brave: se l'apri dall'icona sulla schermata Home, iPadOS le dà una memoria separata e il tempo inviato non arriva.</p>
      </details>
      <details class="manual" ${manualOpen ? "open" : ""}>
        <summary>Aggiungi tempo a mano</summary>
        <form class="real-form" id="realForm">
          <label>Giorno<input type="date" name="day" value="${localDate()}" max="${localDate()}" required></label>
          <label>Ore<input type="number" name="h" min="0" max="24" inputmode="numeric" placeholder="0"></label>
          <label>Min<input type="number" name="min" min="0" max="59" inputmode="numeric" placeholder="0"></label>
          <button type="submit" class="real-add">Aggiungi</button>
        </form>
      </details>
      <p class="stats-note">Come funziona: premi <b>⏱ Inizia a guardare</b> nella scheda di un anime (o il pulsante qui sopra), poi passa alla scheda di Brave dove guardi. L'app conta il tempo in cui sei fuori; quando torni ti chiede quanto hai guardato e aggiorna gli episodi.</p>`;
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

    // Periodi: dal registro degli episodi segnati
    const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const today = new Date();
    const t0 = dayStart(today);
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
      box.innerHTML = `<div class="empty"><div class="big">📊</div><p><strong>Ancora niente da mostrare.</strong></p><p>Segna gli episodi che guardi e qui vedrai quanto tempo ci passi.</p></div>${realSection()}`;
      return;
    }

    const hours = totalMin / 60;
    const dd = Math.floor(hours / 24);
    const big =
      hours >= 24
        ? `${dd}<small> ${dd === 1 ? "giorno" : "giorni"}</small> ${Math.floor(hours % 24)}<small> ${Math.floor(hours % 24) === 1 ? "ora" : "ore"}</small>`
        : `${Math.floor(hours)}<small> ore</small> ${Math.round(totalMin % 60)}<small> min</small>`;
    const cap = hours >= 24 ? `${Math.round(hours)} ore in totale, a guardare anime` : "il tempo passato davanti agli anime";

    const topGenres = [...genreEps.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxG = topGenres[0]?.[1] || 1;

    box.innerHTML = `
      <div class="big-stat"><div class="num">${big}</div><div class="cap">${esc(cap)}</div></div>
      <div class="stat-grid">
        <div class="stat-box"><b>${totalEps}</b><span>episodi visti</span></div>
        <div class="stat-box"><b>${done}</b><span>anime finiti</span></div>
        <div class="stat-box"><b>${list.filter((a) => a.status === "watching").length}</b><span>in corso</span></div>
      </div>
      <div class="stat-grid">
        <div class="stat-box"><b>${fmtTime(todayMin)}</b><span>oggi</span></div>
        <div class="stat-box"><b>${fmtTime(weekMin)}</b><span>ultimi 7 giorni</span></div>
        <div class="stat-box"><b>${fmtTime(monthMin)}</b><span>questo mese</span></div>
      </div>
      <h3 class="stats-sec">Ultimi 7 giorni</h3>
      <div class="bars">${days
        .map(
          (d) => `<div class="bar ${d.isToday ? "today" : ""}">
            <span class="v">${d.min ? String(Math.round(d.min / 6) / 10).replace(".", ",") + " h" : ""}</span>
            <i class="${d.min ? "" : "zero"}" style="height:${d.min ? Math.max(6, (d.min / maxDay) * 80) : 4}px"></i>
            <em>${esc(d.label)}</em></div>`
        )
        .join("")}</div>
      ${realSection()}
      ${topGenres.length ? `<h3 class="stats-sec">Generi che guardi di più</h3>${topGenres
        .map(([g, n]) => `<div class="genre-row"><span class="g-name">${esc(g)}</span><span class="g-bar"><i style="width:${(n / maxG) * 100}%"></i></span><span class="g-val">${n} ep.</span></div>`)
        .join("")}` : ""}
      <p class="stats-note">I numeri qui sopra sono una stima: l'app conta gli episodi che segni, ognuno per la sua durata (di solito circa 24 minuti). Oggi, settimana e mese si basano su quando li hai segnati.</p>`;
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
    real.push({ t, m, s: "manual" });
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
    if (e.target.closest("#copyBm")) return copyBookmarklet();
    if (e.target.closest("#timerStats")) {
      if (session) openSessionSheet(false);
      else startSession(null);
      return renderStats();
    }
    const del = e.target.closest("[data-real-del]");
    if (!del) return;
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
  // ATTENZIONE: dentro questa funzione niente commenti "//" e sempre il ";" (il codice viene compresso).
  // Questa funzione NON gira nell'app: diventa il codice del segnalibro e gira sulla
  // pagina di AnimeSaturn. Conta i secondi mentre la pagina è visibile, li salva nella
  // memoria del sito (giorno per giorno) e con "Invia" li manda all'Animeteca.
  function saturnBookmarklet(APP) {
    if (window.__animeteca) {
      window.__animeteca.flash();
      return;
    }
    var host = location.hostname;
    if (host.indexOf("animesaturn") < 0 && !confirm("Questa pagina non sembra AnimeSaturn. Vuoi contare il tempo lo stesso?")) return;
    var K = "animeteca_tempo";
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    var today = function () {
      var d = new Date();
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    };
    var read = function () {
      try {
        return JSON.parse(localStorage.getItem(K)) || {};
      } catch (e) {
        return {};
      }
    };
    var write = function (o) {
      try {
        localStorage.setItem(K, JSON.stringify(o));
      } catch (e) {}
    };
    var fmt = function (s) {
      var h = Math.floor(s / 3600);
      var m = Math.floor((s - h * 3600) / 60);
      return h + ":" + pad(m) + ":" + pad(Math.floor(s - h * 3600 - m * 60));
    };
    var box = document.createElement("div");
    var root = box.attachShadow ? box.attachShadow({ mode: "open" }) : box;
    root.innerHTML =
      "<style>" +
      ".b{position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;align-items:center;gap:8px;" +
      "padding:8px 8px 8px 12px;border-radius:16px;background:rgb(36,31,58);color:rgb(243,240,255);" +
      "border:1px solid rgb(74,222,128);box-shadow:0 8px 24px rgba(0,0,0,.5);" +
      "font:600 14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif}" +
      ".d{width:9px;height:9px;border-radius:50px;background:rgb(74,222,128)}" +
      "button{border:0;border-radius:11px;padding:7px 11px;font:700 13px -apple-system,system-ui,sans-serif;cursor:pointer}" +
      ".s{background:rgb(74,222,128);color:rgb(16,37,26)}.x{background:rgba(255,255,255,.12);color:rgb(243,240,255)}" +
      "</style><div class=b><span class=d></span><span class=t></span>" +
      "<button class=s>Invia</button><button class=x>✕</button></div>";
    (document.body || document.documentElement).appendChild(box);
    var bar = root.querySelector(".b");
    var label = root.querySelector(".t");
    var dot = root.querySelector(".d");
    var last = Date.now();
    var tick = function () {
      var now = Date.now();
      var dt = Math.min(now - last, 5000);
      last = now;
      var o = read();
      var k = today();
      if (document.visibilityState === "visible") {
        o[k] = (o[k] || 0) + dt / 1000;
        write(o);
        dot.style.opacity = "1";
      } else {
        dot.style.opacity = "0.3";
      }
      label.textContent = "⏱ AnimeSaturn · oggi " + fmt(o[k] || 0);
    };
    var timer = setInterval(tick, 1000);
    tick();
    root.querySelector(".s").onclick = function () {
      var o = read();
      var d = {};
      Object.keys(o).forEach(function (k) {
        if (o[k] >= 30) d[k] = Math.round(o[k]);
      });
      var url = APP + "?saturn=" + encodeURIComponent(JSON.stringify({ h: host, d: d }));
      var w = window.open(url, "_blank");
      if (!w) location.href = url;
    };
    root.querySelector(".x").onclick = function () {
      clearInterval(timer);
      box.remove();
      window.__animeteca = null;
    };
    window.__animeteca = {
      flash: function () {
        bar.style.transform = "scale(1.08)";
        setTimeout(function () {
          bar.style.transform = "";
        }, 250);
      },
    };
  }

  function bookmarkletCode() {
    const app = location.origin + location.pathname.replace(/index\.html$/, "");
    // spazi compressi per un codice più corto (la funzione usa sempre il ";" e non ha commenti "//")
    const src = saturnBookmarklet.toString().replace(/\s+/g, " ");
    return "javascript:" + encodeURIComponent("(" + src + ")(" + JSON.stringify(app) + ");void 0");
  }

  function copyBookmarklet() {
    const code = bookmarkletCode();
    const fallback = () => {
      const ta = $("#bmCode");
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
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(code).then(() => toast("Segnalibro copiato!"), fallback);
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
      real.push({ t: new Date(y, mo - 1, d, 12).getTime(), m, s: "saturn", day, host, title: "AnimeSaturn" });
      days++;
      if (day === localDate()) todayMin = m;
    }
    saveReal();
    toast(days ? `🪐 AnimeSaturn aggiornato · oggi ${fmtTime(todayMin)}` : "Nessun tempo da importare (serve almeno 1 minuto)");
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
    if (!session) return `<button class="timer-btn" id="timerDetail">⏱ Inizia a guardare</button>`;
    if (session.id === item.id) return `<button class="timer-btn on" id="timerDetail">⏱ Timer attivo · Fine visione</button>`;
    return `<button class="timer-btn" id="timerDetail">⏱ C'è un timer attivo${session.title ? ` per ${esc(session.title)}` : ""} · Chiudilo</button>`;
  }

  function startSession(item) {
    session = { start: Date.now(), id: item?.id || null, title: item?.title || "", awayMs: 0, hiddenAt: null, lastAway: 0 };
    saveSession();
    renderTimer();
    toast("Timer avviato: ora vai a guardare l'episodio");
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

  // Barra in basso visibile mentre il timer è attivo
  function renderTimer() {
    const bar = $("#timerBar");
    if (!session) {
      bar.hidden = true;
      return;
    }
    const min = Math.round(session.awayMs / 60000);
    bar.hidden = false;
    bar.innerHTML = `<span class="t-dot"></span>
      <div class="t-text"><b>${esc(session.title || "Timer di visione")}</b><span>${
        min ? `${esc(fmtTime(min))} contati finora` : "Vai a guardare: conto il tempo fuori dall'app"
      }</span></div>
      <button id="timerEnd">Fine</button>`;
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
    if (!total) lead = "Non sei ancora uscito dall'app, quindi non ho contato niente. Se hai guardato, scrivi i minuti qui sotto.";
    else if (fromReturn && total !== last) lead = `Sei stato via <b>${esc(fmtTime(last))}</b>. In tutto, per questa visione: <b>${esc(fmtTime(total))}</b>.`;
    else lead = `${fromReturn ? "Sei stato via" : "Tempo contato"}: <b>${esc(fmtTime(total))}</b>.`;

    $("#sessionBody").innerHTML = `
      <h2 class="s-title">${fromReturn ? "Bentornato! 👋" : "Fine visione"}</h2>
      <p class="s-lead">${lead}</p>
      ${forgot ? `<p class="s-warn">⚠️ È tanto: forse hai lasciato il timer acceso. Correggi i minuti qui sotto.</p>` : ""}
      <label class="s-field">Minuti guardati<input type="number" id="sessMin" min="0" max="1440" inputmode="numeric" value="${total || ""}" placeholder="0"></label>
      ${
        item
          ? `<div class="episodes s-eps">
              <div>
                <div class="label">Episodi di ${esc(item.title)} visti ora</div>
                <div class="count" id="sessEps">${sessionEps}</div>
                <div class="label" id="sessEpsTo"></div>
              </div>
              <div class="stepper">
                <button data-sess-ep="-1" aria-label="Un episodio in meno">−</button>
                <button data-sess-ep="1" class="plus" aria-label="Un episodio in più">＋</button>
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
        real.push({ t: Date.now(), m, s: "timer", id: session.id, title: session.title });
        saveReal();
      }
      const eps = item ? sessionEps : 0;
      if (eps) setEpisode(item, item.ep + eps);
      const parts = [m && fmtTime(m), eps && `+${eps} ${eps === 1 ? "episodio" : "episodi"}`].filter(Boolean);
      endSession();
      toast(parts.length ? `Salvato: ${parts.join(" · ")}` : "Timer chiuso");
    }
  });

  // ---------- Backup ----------
  $("#menuBtn").addEventListener("click", () => {
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
      closeSheet("#menuSheet");
      renderAll();
      toast(`Importati ${items.length} anime`);
    } catch (err) {
      toast("File non valido: " + err.message);
    }
  });

  // ---------- Avvio ----------
  renderAll();
  renderTimer();
  if (!document.hidden) onShow();
  importSaturn();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();

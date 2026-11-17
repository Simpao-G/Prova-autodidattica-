/* Animeteca - lista personale degli anime.
 * Dati salvati nel dispositivo (localStorage).
 * Ricerca anime tramite l'API pubblica Jikan (dati di MyAnimeList).
 */
(() => {
  "use strict";

  const API = "https://api.jikan.moe/v4";
  const ANILIST = "https://graphql.anilist.co";
  const STORAGE_KEY = "animeteca.v1";
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
        description(asHtml: false) episodes seasonYear startDate { year }
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

  // ---------- Azioni ----------
  function setStatus(anime, status) {
    let item = findItem(anime.id);
    const isNew = !item;
    if (isNew) {
      item = { ...anime, ep: 0, addedAt: Date.now() };
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
          <img class="cover" src="${esc(cover(a))}" alt="" loading="lazy">
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

    const synopsis = item.synopsis || "Nessuna descrizione disponibile.";
    const long = synopsis.length > 280;

    $("#detail").innerHTML = `
      <div class="hero">
        <img class="bg" src="${esc(cover(item))}" alt="">
        <img class="poster" src="${esc(cover(item))}" alt="Copertina di ${esc(item.title)}">
        <button class="close" data-close aria-label="Chiudi">✕</button>
      </div>
      <div class="detail-body">
        <h2 class="detail-title"><mark>${esc(item.title)}</mark></h2>
        ${item.altTitle ? `<div style="text-align:center;color:var(--muted);font-size:13px">${esc(item.altTitle)}</div>` : ""}
        <div class="chips">${chips}</div>
        ${episodes}
        <p class="synopsis ${long ? "clamp" : ""}" id="synopsis">${esc(synopsis)}</p>
        ${long ? `<button class="more" id="moreBtn">Leggi tutto</button><br>` : ""}
        ${item.url ? `<a class="wiki-link" href="${esc(item.url)}" target="_blank" rel="noopener">Apri su MyAnimeList ↗</a>` : ""}
        <div class="status-row">
          ${Object.entries(STATUS)
            .map(([key, label]) => `<button class="status-btn ${status === key ? "active" : ""}" data-status="${key}">${label}</button>`)
            .join("")}
        </div>
        ${saved ? `<button class="remove-btn" id="removeBtn">Rimuovi dalla lista</button>` : ""}
      </div>`;
  }

  function showDetail(anime) {
    openItem = findItem(anime.id) || anime;
    renderDetail();
    $("#detail").scrollTop = 0;
    openSheet("#detailSheet");
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
            <img src="${esc(cover(r))}" alt="" loading="lazy">
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
    box.innerHTML = `<div class="spinner"></div>`;
    searchCtrl = new AbortController();
    const signal = searchCtrl.signal;
    const errors = [];
    // Prima AniList, se non risponde (o non trova nulla) prova MyAnimeList
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
    if (errors.length < 2) return renderResults([]);
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
    const st = e.target.closest("[data-status]");
    if (st) return setStatus(openItem, st.dataset.status);
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

  // ---------- Backup ----------
  $("#menuBtn").addEventListener("click", () => openSheet("#menuSheet"));

  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ app: "animeteca", version: 1, list }, null, 2)], { type: "application/json" });
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
      save();
      closeSheet("#menuSheet");
      renderAll();
      toast(`Importati ${items.length} anime`);
    } catch (err) {
      toast("File non valido: " + err.message);
    }
  });

  // ---------- Avvio ----------
  renderAll();

  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
})();

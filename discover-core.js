/* Animeteca - filtri della scheda "Scopri" (nessuna interfaccia qui: solo la logica).
 *
 * Funziona sia nel browser (window.AnimetecaDiscover) sia in Node (per i test).
 *
 * Gli anime sono quelli del database dell'app (app.js, loadDB). Campi usati:
 *   type, year, episodes     (year/episodes: null se non noti)
 *   _score (0-100), _pop     voto AniList e popolarità
 *   _genres                  numero con un bit per genere (ordine = genreNames); null se il database non lo ha
 *   _status                  posizione in statusNames (-1 o null se non noto)
 *   _start                   1 = inizio della serie, 0 = stagione/seguito; null se il database non lo ha
 *
 * Regola per i dati mancanti: se un filtro è attivo, un anime senza quel dato NON compare.
 */
(function (root) {
  "use strict";

  const FORMATS = ["TV", "Film", "OVA", "ONA", "Special"];
  const YEARS = [
    ["last5", "Ultimi 5 anni"],
    ["2020", "Anni 2020"],
    ["2010", "Anni 2010"],
    ["2000", "Anni 2000"],
    ["1990", "Anni ’90"],
    ["1980", "Anni ’80"],
    ["old", "Prima del 1980"],
  ];
  const EPISODES = [
    ["1", "Film / 1 episodio"],
    ["2-13", "Brevi · 2-13"],
    ["14-26", "Medie · 14-26"],
    ["27+", "Lunghe · 27+"],
  ];
  const SCORES = [
    [60, "Voto 6+"],
    [70, "Voto 7+"],
    [75, "Voto 7,5+"],
    [80, "Voto 8+"],
  ];
  const FAME = [
    ["known", "Noti"],
    ["famous", "Molto noti"],
  ];
  const FAME_MIN = { known: 10000, famous: 100000 };
  const STATUSES = [
    ["FINISHED", "Concluso"],
    ["RELEASING", "In onda"],
    ["NOT_YET_RELEASED", "In arrivo"],
    ["HIATUS", "In pausa"],
    ["CANCELLED", "Cancellato"],
  ];
  const SORTS = [
    ["pop", "Popolarità"],
    ["score", "Voto"],
    ["new", "Più recenti"],
  ];

  const MULTI = ["formats", "genres", "status"]; // più scelte insieme
  const SINGLE = ["year", "episodes", "score", "fame"]; // una sola scelta (si tocca di nuovo per toglierla)
  const FLAGS = ["starts", "hideMine"]; // interruttori

  const DEFAULTS = Object.freeze({
    formats: [],
    year: "",
    episodes: "",
    score: 0,
    fame: "",
    genres: [],
    status: [],
    starts: false,
    hideMine: false,
    sort: "pop",
  });

  const has = (options, value) => options.some(([k]) => k === value);
  const fresh = () => ({ ...DEFAULTS, formats: [], genres: [], status: [] });

  // Ripulisce filtri arrivati da fuori (preferenze salvate, magari vecchie o rovinate).
  // caps = { genres, status, start: bool, genreNames: [...] }: cosa offre il database in uso.
  function normalize(input, caps = {}) {
    const f = fresh();
    if (!input || typeof input !== "object" || Array.isArray(input)) return f;
    if (Array.isArray(input.formats)) f.formats = FORMATS.filter((x) => input.formats.includes(x));
    if (has(YEARS, input.year)) f.year = input.year;
    if (has(EPISODES, input.episodes)) f.episodes = input.episodes;
    if (has(SCORES, input.score)) f.score = input.score;
    if (has(FAME, input.fame)) f.fame = input.fame;
    if (caps.genres && Array.isArray(caps.genreNames) && Array.isArray(input.genres)) {
      f.genres = caps.genreNames.filter((g) => input.genres.includes(g));
    }
    if (caps.status && Array.isArray(input.status)) f.status = STATUSES.map(([k]) => k).filter((k) => input.status.includes(k));
    f.starts = Boolean(caps.start) && input.starts === true;
    f.hideMine = input.hideMine === true;
    if (has(SORTS, input.sort)) f.sort = input.sort;
    return f;
  }

  // Un tocco su un chip: aggiunge/toglie (più scelte), cambia/toglie (una scelta), accende/spegne (interruttore)
  function toggle(f, group, value, caps = {}) {
    const next = { ...f, formats: [...f.formats], genres: [...f.genres], status: [...f.status] };
    if (MULTI.includes(group)) {
      next[group] = next[group].includes(value) ? next[group].filter((x) => x !== value) : [...next[group], value];
    } else if (SINGLE.includes(group)) {
      next[group] = next[group] === value ? DEFAULTS[group] : value;
    } else if (FLAGS.includes(group)) {
      next[group] = !next[group];
    } else if (group === "sort") {
      next.sort = value;
    }
    return normalize(next, caps);
  }

  // Toglie tutti i filtri (l'ordine scelto resta)
  const clear = (f) => ({ ...fresh(), sort: f.sort });

  // Elenco dei filtri attivi, per i chip "con la croce": { group, value, label }
  function activeFilters(f, { genreLabel = (g) => g } = {}) {
    const out = [];
    for (const x of f.formats) out.push({ group: "formats", value: x, label: x });
    const label = (options, v) => options.find(([k]) => k === v)?.[1] || String(v);
    if (f.year) out.push({ group: "year", value: f.year, label: label(YEARS, f.year) });
    if (f.episodes) out.push({ group: "episodes", value: f.episodes, label: label(EPISODES, f.episodes) });
    if (f.score) out.push({ group: "score", value: f.score, label: label(SCORES, f.score) });
    if (f.fame) out.push({ group: "fame", value: f.fame, label: label(FAME, f.fame) });
    for (const g of f.genres) out.push({ group: "genres", value: g, label: genreLabel(g) });
    for (const s of f.status) out.push({ group: "status", value: s, label: label(STATUSES, s) });
    if (f.starts) out.push({ group: "starts", value: true, label: "Inizi di serie" });
    if (f.hideMine) out.push({ group: "hideMine", value: true, label: "Non nella mia lista" });
    return out;
  }

  // Anime che rispettano tutti i filtri (in AND). Un solo passaggio, esce al primo criterio non rispettato.
  // opts = { genreNames, statusNames, mine: Set di id da nascondere, thisYear }
  function filterAnime(items, f, opts = {}) {
    const now = opts.thisYear || new Date().getFullYear();
    const genreNames = opts.genreNames || [];
    const statusNames = opts.statusNames || [];
    let need = 0;
    for (const g of f.genres) {
      const i = genreNames.indexOf(g);
      if (i < 0) return []; // genere che il database non conosce: nessun risultato
      need |= 1 << i;
    }
    const statuses = new Set(f.status.map((s) => statusNames.indexOf(s)));
    if (f.status.length && statuses.has(-1) && statuses.size === 1) return [];
    const formats = f.formats.length ? new Set(f.formats) : null;
    const famousMin = f.fame ? FAME_MIN[f.fame] : 0;
    const mine = f.hideMine ? opts.mine : null;
    const out = [];
    for (const it of items) {
      if (formats && !formats.has(it.type)) continue;
      if (f.year && !yearOk(f.year, it.year, now)) continue;
      if (f.episodes && !episodesOk(f.episodes, it.episodes)) continue;
      if (f.score && !(it._score >= f.score)) continue;
      if (famousMin && !(it._pop >= famousMin)) continue;
      if (need && (it._genres == null || (it._genres & need) !== need)) continue;
      if (f.status.length && !(it._status >= 0 && statuses.has(it._status))) continue;
      if (f.starts && it._start !== 1) continue;
      if (mine && mine.has(it.id)) continue;
      out.push(it);
    }
    return out;
  }

  function yearOk(range, y, now) {
    if (!y) return false;
    if (range === "last5") return y >= now - 4 && y <= now;
    if (range === "old") return y < 1980;
    const from = Number(range);
    return y >= from && y <= from + 9;
  }

  function episodesOk(range, e) {
    if (!e) return false;
    if (range === "1") return e === 1;
    if (range === "2-13") return e >= 2 && e <= 13;
    if (range === "14-26") return e >= 14 && e <= 26;
    return e >= 27; // "27+"
  }

  // Ordine dei risultati (modifica e restituisce la stessa lista); a parità, il più popolare
  function sortAnime(list, sort) {
    const pop = (a, b) => (b._pop || 0) - (a._pop || 0);
    const by = {
      pop,
      score: (a, b) => (b._score || -1) - (a._score || -1) || pop(a, b), // senza voto in fondo
      new: (a, b) => (b.year || 0) - (a.year || 0) || pop(a, b),
    }[sort];
    return list.sort(by || pop);
  }

  const exported = { FORMATS, YEARS, EPISODES, SCORES, FAME, STATUSES, SORTS, DEFAULTS, normalize, toggle, clear, activeFilters, filterAnime, sortAnime };
  if (typeof module === "object" && module.exports) module.exports = exported;
  else root.AnimetecaDiscover = exported;
})(typeof window !== "undefined" ? window : globalThis);

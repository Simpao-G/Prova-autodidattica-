/* Animeteca - sincronizzazione tra dispositivi (iPhone, iPad...).
 *
 * Due parti, indipendenti dall'interfaccia:
 *  1. merge(): unisce i dati di due dispositivi senza perdere niente
 *     - anime: per ognuno vince la modifica più recente (updatedAt);
 *       un anime rimosso resta rimosso, a meno che non sia stato modificato dopo;
 *     - registro episodi: unione senza doppioni;
 *     - tempi reali: unione; per la stessa voce vince la più recente (u).
 *  2. createClient(): parla con Supabase (account + tabella animeteca_data)
 *     usando direttamente le sue API web, senza librerie esterne.
 *
 * Funziona sia nel browser (window.AnimetecaSync) sia in Node (per i test).
 */
(function (root) {
  "use strict";

  // ---------- Unione dei dati ----------
  const stamp = (a) => a.updatedAt || a.addedAt || 0;
  // Campi che ogni dispositivo può riscaricare dal database dell'app: non vanno online
  const LOCAL_ONLY = ["synopsis", "synopsisEn", "synIt", "seasons"];
  const realKey = (e) => `${e.s || "manual"}|${e.t}`;
  const realStamp = (e) => e.u || e.t || 0;
  const logKey = (e) => `${e.t}|${e.id}|${e.d}`;

  // Porta i dati in una forma prevedibile (anche se vengono da versioni vecchie)
  function normalize(d) {
    d = d || {};
    return {
      list: Array.isArray(d.list) ? d.list.filter((a) => a && a.id) : [],
      log: Array.isArray(d.log) ? d.log.filter((e) => e && e.t && e.id) : [],
      real: Array.isArray(d.real) ? d.real.filter((e) => e && e.t && e.m > 0) : [],
      deleted: {
        anime: (d.deleted && d.deleted.anime) || {},
        real: (d.deleted && d.deleted.real) || {},
      },
    };
  }

  function maxMap(a, b) {
    const out = { ...a };
    for (const [k, v] of Object.entries(b || {})) if (!(out[k] >= v)) out[k] = v;
    return out;
  }

  // a = dati di questo dispositivo, b = dati sul server. A parità vince a.
  function merge(a, b) {
    a = normalize(a);
    b = normalize(b);
    const deleted = { anime: maxMap(a.deleted.anime, b.deleted.anime), real: maxMap(a.deleted.real, b.deleted.real) };

    const byId = new Map();
    for (const it of [...a.list, ...b.list]) {
      const cur = byId.get(it.id);
      if (!cur) {
        byId.set(it.id, it);
        continue;
      }
      let win = cur; // a parità vince il primo visto (questo dispositivo)
      if (stamp(it) > stamp(cur)) {
        // tiene descrizione/stagioni già scaricate se la versione più nuova non le ha
        const keep = {};
        for (const k of LOCAL_ONLY) if (it[k] === undefined && cur[k] !== undefined) keep[k] = cur[k];
        win = { ...it, ...keep };
      }
      // note e voti hanno una loro data: vince l'ultima modifica, su qualunque dispositivo
      const other = win === cur ? it : cur;
      if ((other.noteAt || 0) > (win.noteAt || 0)) win = { ...win, note: other.note, noteAt: other.noteAt };
      if ((other.ratingAt || 0) > (win.ratingAt || 0)) {
        win = { ...win, rating: other.rating, review: other.review, ratingAt: other.ratingAt };
      }
      byId.set(it.id, win);
    }
    const list = [...byId.values()].filter((it) => !(deleted.anime[it.id] >= stamp(it)));

    const logMap = new Map();
    for (const e of [...a.log, ...b.log]) if (!logMap.has(logKey(e))) logMap.set(logKey(e), e);
    const log = [...logMap.values()].sort((x, y) => x.t - y.t).slice(-5000);

    const realMap = new Map();
    for (const e of [...a.real, ...b.real]) {
      const k = realKey(e);
      const cur = realMap.get(k);
      if (!cur || realStamp(e) > realStamp(cur)) realMap.set(k, e);
    }
    const real = [...realMap.values()].filter((e) => !(deleted.real[realKey(e)] >= realStamp(e))).sort((x, y) => x.t - y.t);

    return { list, log, real, deleted };
  }

  // Versione da caricare sul server: senza i testi lunghi che l'app può riscaricare
  // dal suo database (descrizione e stagioni degli anime che hanno alId), in ordine fisso.
  function slim(d) {
    d = normalize(d);
    const list = d.list
      .map((it) => {
        if (!it.alId) return it;
        const rest = { ...it };
        for (const k of LOCAL_ONLY) delete rest[k];
        return rest;
      })
      .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
    return { list, log: d.log, real: d.real, deleted: d.deleted };
  }

  const same = (x, y) => JSON.stringify(slim(x)) === JSON.stringify(slim(y));

  // ---------- Client Supabase ----------
  const ITALIAN = [
    // community (supabase/community.sql)
    [/profiles_username_key/i, "Questo nome utente è già preso: scegline un altro."],
    [/profiles_username_check/i, "Nome utente non valido: da 3 a 20 caratteri tra lettere minuscole, numeri, punto e trattino basso."],
    [/friendships_pair_idx/i, "Tra voi c'è già una richiesta di amicizia."],
    [/row-level security policy for table "recommendations"/i, "Puoi consigliare anime solo ai tuoi amici."],
    [/invalid login credentials/i, "Email o password sbagliate."],
    [/already registered|already exists/i, "Esiste già un account con questa email: usa Accedi."],
    [/at least 6 characters|password should be/i, "La password deve avere almeno 6 caratteri."],
    [/email not confirmed/i, "Prima devi confermare l'email: apri il link che ti è arrivato."],
    [/unable to validate email|invalid format|invalid email/i, "Questa email non sembra valida."],
    [/rate limit|too many/i, "Troppi tentativi: aspetta un minuto e riprova."],
    [/signups not allowed|signup is disabled/i, "La creazione di nuovi account è disattivata."],
    [/failed to fetch|network|load failed/i, "Nessuna connessione a internet."],
    [/relation .* does not exist|could not find the table/i, "Manca la tabella sul server: va eseguito lo script di configurazione."],
  ];
  function italian(msg) {
    for (const [re, it] of ITALIAN) if (re.test(msg)) return it;
    return msg;
  }

  function createClient({ url, key, storage, fetchImpl }) {
    const base = String(url || "").replace(/\/+$/, "");
    const SESSION_KEY = "animeteca.auth.v1";
    const doFetch = fetchImpl || ((...args) => fetch(...args));
    const store = storage || {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    };
    let session = null;
    try {
      session = JSON.parse(store.getItem(SESSION_KEY));
    } catch {
      session = null;
    }
    let refreshing = null;

    function setSession(json, user) {
      const u = user || json.user;
      session = {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expires_at: Date.now() + (Number(json.expires_in) || 3600) * 1000,
        user: { id: u.id, email: u.email },
      };
      try {
        store.setItem(SESSION_KEY, JSON.stringify(session));
      } catch {
        /* la sessione vale solo finché la pagina resta aperta */
      }
    }
    function clearSession() {
      session = null;
      try {
        store.removeItem(SESSION_KEY);
      } catch {
        /* niente da cancellare */
      }
    }

    async function call(path, { method = "GET", body, token, headers = {} } = {}) {
      const h = { apikey: key, "Content-Type": "application/json", ...headers };
      if (token) h.Authorization = "Bearer " + token;
      let res;
      try {
        res = await doFetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (err) {
        throw Object.assign(new Error(italian(String(err && err.message) || "network")), { offline: true });
      }
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok) {
        const raw = (json && (json.msg || json.error_description || json.message || json.error)) || `Errore ${res.status}`;
        // code: codice di PostgreSQL/PostgREST (es. 23505 = valore già usato, PGRST205 = tabella mancante)
        const code = json && typeof json.code === "string" ? json.code : "";
        throw Object.assign(new Error(italian(String(raw))), { status: res.status, raw, code });
      }
      return json;
    }

    async function refresh() {
      if (!session) return null;
      if (!refreshing) {
        refreshing = call("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token } })
          .then((json) => {
            setSession(json, json.user || session.user);
            return session.access_token;
          })
          .catch((err) => {
            // refresh rifiutato (non per mancanza di rete): bisogna rientrare
            if (!err.offline && err.status >= 400 && err.status < 500) {
              clearSession();
              throw Object.assign(new Error("Sessione scaduta: accedi di nuovo."), { loggedOut: true });
            }
            throw err;
          })
          .finally(() => {
            refreshing = null;
          });
      }
      return refreshing;
    }

    async function accessToken() {
      if (!session) throw Object.assign(new Error("Non hai effettuato l'accesso."), { loggedOut: true });
      if (Date.now() > session.expires_at - 60 * 1000) return refresh();
      return session.access_token;
    }

    // Chiamata con l'utente: se il token risulta scaduto, lo rinnova e riprova una volta
    async function authed(path, opts = {}) {
      try {
        return await call(path, { ...opts, token: await accessToken() });
      } catch (err) {
        if (err.status === 401 && session) return call(path, { ...opts, token: await refresh() });
        throw err;
      }
    }

    const api = {
      configured: Boolean(base && key),
      user: () => (session ? session.user : null),

      async signUp(email, password) {
        const json = await call("/auth/v1/signup", { method: "POST", body: { email, password } });
        if (json && json.access_token) {
          setSession(json);
          return { loggedIn: true };
        }
        return { needsConfirmation: true };
      },

      async signIn(email, password) {
        const json = await call("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password } });
        setSession(json);
        return { loggedIn: true };
      },

      async signOut() {
        try {
          if (session) await call("/auth/v1/logout", { method: "POST", token: session.access_token });
        } catch {
          /* anche offline si esce da questo dispositivo */
        }
        clearSession();
      },

      // Link dell'email di conferma: #access_token=...&refresh_token=...&expires_in=...
      async fromUrlHash(hash) {
        const p = new URLSearchParams(String(hash || "").replace(/^#/, ""));
        if (p.get("error_description")) throw new Error(italian(p.get("error_description")));
        const access = p.get("access_token");
        if (!access) return false;
        const user = await call("/auth/v1/user", { token: access });
        setSession({ access_token: access, refresh_token: p.get("refresh_token"), expires_in: p.get("expires_in") }, user);
        return true;
      },

      async getRemote() {
        const uid = encodeURIComponent(session ? session.user.id : "");
        const rows = await authed(`/rest/v1/animeteca_data?select=data,rev&user_id=eq.${uid}`);
        return rows && rows[0] ? { data: rows[0].data, rev: rows[0].rev } : null;
      },

      // Primo salvataggio: se intanto un altro dispositivo l'ha già creato, risponde false
      async insertRemote(data, rev) {
        try {
          await authed("/rest/v1/animeteca_data", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: { user_id: session.user.id, data, rev },
          });
          return true;
        } catch (err) {
          if (err.status === 409) return false;
          throw err;
        }
      },

      // Aggiorna solo se nessun altro dispositivo ha scritto nel frattempo (stesso rev)
      async updateRemote(data, oldRev, newRev) {
        const uid = encodeURIComponent(session.user.id);
        const rows = await authed(`/rest/v1/animeteca_data?user_id=eq.${uid}&rev=eq.${encodeURIComponent(oldRev)}`, {
          method: "PATCH",
          headers: { Prefer: "return=representation" },
          body: { data, rev: newRev, updated_at: new Date().toISOString() },
        });
        return Array.isArray(rows) && rows.length > 0;
      },

      // Chiamata generica alle tabelle (community): rest("library?select=*", { method, body, prefer })
      rest(path, { method = "GET", body, prefer } = {}) {
        return authed("/rest/v1/" + path, { method, body, headers: prefer ? { Prefer: prefer } : {} });
      },
      // Funzione del database (es. find_user)
      rpc(name, args) {
        return authed("/rest/v1/rpc/" + name, { method: "POST", body: args || {} });
      },
    };
    return api;
  }

  const exported = { merge, slim, same, normalize, createClient, italian };
  if (typeof module === "object" && module.exports) module.exports = exported;
  else root.AnimetecaSync = exported;
})(typeof window !== "undefined" ? window : globalThis);

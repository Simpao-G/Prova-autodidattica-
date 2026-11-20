# Classifiche — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nuova sezione "Classifiche" (Migliori, Generi, Anno con episodi, Reddit) con voto medio AniList + MyAnimeList, calcolata ogni lunedì e aperta da un pulsante con la coppa.

**Architecture:** Uno script Node nel workflow settimanale legge il database già costruito (`data/anime.json`, `data/d/*.json`), aggiunge i voti MyAnimeList via Jikan e i vincitori degli r/anime Awards, e scrive `data/rankings.json` (autosufficiente: titoli e copertine inclusi). L'app carica quel file solo quando si apre la sezione e apre la scheda esistente al tocco. Calcolo puro separato dalla rete per poterlo testare.

**Tech Stack:** Node 20/22 (fetch integrato, `node:test`), JavaScript vanilla nell'app, Playwright già installato per la prova nel browser, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-20-classifiche-design.md`

## Global Constraints

- Testi dell'app in italiano; voti con la virgola e un decimale (`8,9`).
- Voto medio = media semplice di AniList (`averageScore / 10`) e MyAnimeList (`score`); se una fonte manca, l'altra.
- Quantità: 100 Migliori · 50 per genere · 50 per anno (anno in corso + 4 precedenti) · 30 episodi (anno in corso e precedente).
- Soglia voti: 20000 (votanti MAL `scored_by`; se MAL manca, popolarità AniList) per Migliori e Generi; 2000 per Anno.
- Tipi inclusi: `TV`, `Film`, `OVA`, `ONA`, `Special` (musica e titoli per adulti sono già esclusi dal database).
- Generi: quelli di AniList tranne Hentai: Action, Adventure, Comedy, Drama, Ecchi, Fantasy, Horror, Mahou Shoujo, Mecha, Music, Mystery, Psychological, Romance, Sci-Fi, Slice of Life, Sports, Supernatural, Thriller (etichette italiane da `GENRE_IT` in `app.js`).
- Id degli anime come nel database dell'app: `mal-<malId>` se c'è l'id MAL, altrimenti `al-<anilistId>`.
- Pulsante coppa subito dopo "Cerca"; sotto i 430 px di larghezza la scritta `.brand-name` si nasconde.
- `#rankSheet` prima di `#detailSheet` in `index.html` (la scheda anime si apre sopra).
- Nessuna nuova dipendenza. Il passo del workflow ha `continue-on-error: true`; se fallisce resta il `rankings.json` precedente.
- Versione app 17, cache del service worker `animeteca-v17`.

## Review Focus

1. **`data/rankings.json` mancante o di formato sconosciuto** (prima esecuzione del lunedì): la sezione mostra "Le classifiche arrivano con il prossimo aggiornamento" invece di rompersi → test in Task 4.
2. **Anime non nel database o vincitore degli Awards non riconosciuto**: la riga si vede lo stesso (titolo dal file); se non ha un id riconosciuto non è toccabile → test in Task 2 (id `null`) e Task 4 (riga disabilitata).
3. **Gennaio, anno nuovo con meno di 10 titoli**: si parte dall'anno precedente → test in Task 4.
4. **Jikan che risponde a metà (errori 500/429 su alcune pagine)**: le classifiche escono lo stesso con i voti disponibili; se non risponde mai, `sources.mal = false` e l'app scrive "questa settimana solo AniList" → test in Task 3 e Task 4.
5. **Titoli lunghissimi e tanti generi su iPhone (390 px)**: titoli su due righe al massimo, generi in una riga che scorre in orizzontale, niente scorrimento orizzontale della pagina → test in Task 4.

---

### Task 1: Verifica delle fonti dai server di GitHub

Da questa sessione Jikan e `r-anime.github.io` non sono raggiungibili: si verificano con un workflow temporaneo.

**Files:**
- Create (temporaneo, poi da cancellare): `.github/workflows/probe-sources.yml`
- Create: `docs/superpowers/plans/2026-11-20-classifiche-fonti.md` (cosa si è trovato)

**Interfaces:**
- Produces: per Task 3, le risposte reali di: `GET /v4/top/anime`, `GET /v4/anime?start_date=&end_date=&order_by=score&sort=desc&sfw=true`, `GET /v4/anime?genres=<id>&order_by=score&sort=desc&sfw=true`, `GET /v4/anime/{id}`, `GET /v4/anime/{id}/episodes` (c'è il campo `score`?), e dove/come sono pubblicati i risultati degli r/anime Awards (URL dei dati, formato, se ci sono id AniList/MAL).

- [ ] **Step 1:** Scrivere `probe-sources.yml` (`on: workflow_dispatch`, `runs-on: ubuntu-latest`) con un passo `run` che per ogni URL sopra fa `curl -s` (con `sleep 1` tra le chiamate Jikan) e stampa con `jq` i campi di `data[0]` e `pagination`; per gli Awards stampa i primi 3000 caratteri di `https://r-anime.github.io/animeawards/` e l'elenco dei file `.js`/`.json` citati nella pagina.
- [ ] **Step 2:** Commit + push, avviare il workflow (strumento GitHub `actions_run_trigger`), leggere il log (`get_job_logs`). Se i dati degli Awards stanno in file collegati, aggiungere al probe il download di uno di quei file e rieseguire (al massimo 3 giri).
- [ ] **Step 3:** Scrivere in `2026-11-20-classifiche-fonti.md`: forma esatta delle risposte Jikan; se `score` per episodio esiste; URL e forma dei dati Awards (anni, categorie, vincitore giuria/pubblico, id disponibili) oppure "non leggibili in automatico".
- [ ] **Step 4:** Cancellare `probe-sources.yml`, commit "Verifica fonti classifiche" + push.
- [ ] **Step 5:** Se gli Awards non sono leggibili o gli episodi non hanno voto: in Task 3 quelle parti producono liste vuote (l'app le nasconde) e lo si dice all'utente alla fine.

### Task 2: Calcolo delle classifiche (puro, senza rete)

**Files:**
- Create: `scripts/rankings-core.mjs`
- Test: `tests/rankings-core.test.mjs` (eseguito con `node --test tests/`)

**Interfaces:**
- Produces:
  - `export const GENRES: string[]` (i 18 generi dei Global Constraints) e `export const MAL_GENRE: Record<string, number>` = `{Action:1, Adventure:2, Comedy:4, Drama:8, Ecchi:9, Fantasy:10, Horror:14, "Mahou Shoujo":66, Mecha:18, Music:19, Mystery:7, Psychological:40, Romance:22, "Sci-Fi":24, "Slice of Life":36, Sports:30, Supernatural:37, Thriller:41}` (da correggere con Task 1 se serve).
  - `export function animeFromIndex(index): Anime[]` — da `data/anime.json` (`fields` + `items`) a `{id, alId, malId, title, altTitle, type, year, episodes, cover, popularity, alScore}`; `cover` resta relativa a `index.coverPrefix`.
  - `export function combineScore(alScore100: number, malScore: number|null): number|null` — 0 o `null` = fonte mancante; risultato arrotondato a 2 decimali.
  - `export function buildRankings({anime, genresByAl, mal, episodes, awards, now, coverPrefix}): Rankings` con `genresByAl: Map<number,string[]>`, `mal: Map<number,{score:number, votes:number}>`, `episodes: {malId, number, title, score, aired}[]`, `awards: {year, category, jury:{title, alId?, malId?}, public:{…}}[]`, `now: Date`.
  - Forma di `Rankings` (scritta così in `data/rankings.json`):
    ```js
    {
      version: 1, updated: "ISO", coverPrefix: "https://…",
      sources: { mal: boolean, episodes: boolean, reddit: boolean },
      items: { [id]: [alId, malId, title, type, year, episodes, cover, combined, al10OrNull, malOrNull] },
      top: [id, …], genres: { Action: [id, …], … }, years: { "2026": [id, …], … },
      episodes: { "2026": [[id, number, title, score], …], "2025": [...] },
      reddit: [ { year: 2025, awards: [ { cat: "Anime of the Year", jury: [idOrNull, title], public: [idOrNull, title] } ] } ]
    }
    ```

- [ ] **Step 1: Test che falliscono** in `tests/rankings-core.test.mjs`:
  - `combineScore(90, 8.8) === 8.9`; `combineScore(90, null) === 9`; `combineScore(0, 8.5) === 8.5`; `combineScore(0, null) === null`.
  - `animeFromIndex` su un indice di 2 righe: id `mal-20` per malId 20, `al-999` per malId 0.
  - `buildRankings` con 6 anime finti: chi ha meno di 20000 voti non entra in `top`; ordinamento per voto medio, a parità per voti; `top.length <= 100`; `genres.Action` contiene solo anime con genere Action; un `type` vuoto è escluso.
  - `years["2026"]` con `now = new Date("2026-11-20")`: solo `year === 2026` e soglia 2000; chiavi `"2026"…"2022"`.
  - episodi: raggruppati per anno di `aired`, ordinati per `score`, max 30, solo di anime presenti; `sources.episodes === false` se l'elenco è vuoto.
  - Awards: titolo uguale (ignorando maiuscole e punteggiatura) a `title` o `altTitle` → id; titolo sconosciuto → `[null, "Titolo"]`; `sources.reddit === false` se vuoti.
  - `sources.mal === false` se `mal` è vuota; ogni id citato in liste ha la sua riga in `items`.
- [ ] **Step 2:** `node --test tests/` → FAIL ("Cannot find module …/rankings-core.mjs").
- [ ] **Step 3:** Implementare `scripts/rankings-core.mjs` con le firme sopra (voti per la soglia: `mal.get(malId)?.votes` se c'è, altrimenti `popularity`).
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5:** Commit "Classifiche: calcolo (rankings-core)".

### Task 3: Script del lunedì: dati MyAnimeList, Awards, file `rankings.json`

**Files:**
- Create: `scripts/build-rankings.mjs`
- Modify: `.github/workflows/update-db.yml` (nuovo passo dopo "Scarica gli anime da AniList"; percorso dello script tra i `paths` del `push`)
- Test: `tests/build-rankings.test.mjs` + `tests/fixtures/rank-db/` (indice di ~12 anime e solo i blocchi `d/<n>.json` che servono)

**Interfaces:**
- Consumes: `animeFromIndex`, `buildRankings`, `GENRES`, `MAL_GENRE` (Task 2); forma delle risposte reali (Task 1).
- Produces: `export async function main(env = process.env): Promise<Rankings>` che scrive `<DATA_DIR>/rankings.json`. Variabili: `DATA_DIR` (predefinita `../data/` accanto allo script), `JIKAN_URL` (predefinita `https://api.jikan.moe/v4`), `AWARDS_URL` (da Task 1), `PAUSE_MS` (predefinita 1100), `NOW` (data ISO, per i test).

- [ ] **Step 1: Test che falliscono** in `tests/build-rankings.test.mjs`: un server `node:http` locale imita Jikan (top, ricerca per anno e per genere, `/anime/{id}`, episodi) e gli Awards; `main({DATA_DIR: copiaTemporaneaDelleFixture, JIKAN_URL, AWARDS_URL, PAUSE_MS: "0", NOW: "2026-11-20"})`:
  - il file scritto ha `sources.mal === true` e il voto medio di un anime noto (AniList 90, MAL 8,8 → `items[id][7] === 8.9`);
  - un anime in classifica senza voto MAL nelle liste viene chiesto a `/anime/{id}` (il server conta la richiesta);
  - secondo test: il server risponde 500 a ogni chiamata Jikan → `sources.mal === false`, `top` non vuota (solo AniList), nessuna eccezione;
  - terzo test: risposte 429 alla prima chiamata e poi 200 → il dato arriva (nuovo tentativo).
- [ ] **Step 2:** `node --test tests/` → FAIL.
- [ ] **Step 3:** Implementare `main`: legge indice e blocchi (un blocco mancante = anime senza generi); chiede a Jikan (una richiesta ogni `PAUSE_MS`, fino a 4 tentativi con attesa crescente su 429/5xx): `top/anime` pagine 1–40; per ognuno dei 5 anni e per ogni genere `MAL_GENRE` le prime 4 pagine ordinate per voto (`sfw=true`); poi i voti mancanti degli anime finiti in lista (al massimo 300 richieste); episodi degli anime nei primi 40 dell'anno in corso e del precedente (al massimo 3 pagine ciascuno); Awards come trovato in Task 1. Ogni parte che fallisce lascia la sua lista vuota. Scrive il file e stampa un riepilogo (quanti voti MAL, episodi, anni Awards).
- [ ] **Step 4:** `node --test tests/` → PASS.
- [ ] **Step 5:** Nel workflow, dopo "Scarica gli anime da AniList": passo `- name: Calcola le classifiche`, `continue-on-error: true`, `run: node scripts/build-rankings.mjs`; aggiungere `scripts/build-rankings.mjs` e `scripts/rankings-core.mjs` ai `paths` del `push`. Il passo di salvataggio esistente include già tutta la cartella `data/`.
- [ ] **Step 6:** Commit "Classifiche: script settimanale e workflow".

### Task 4: Sezione Classifiche nell'app

**Files:**
- Modify: `index.html` (simbolo `i-trophy`, pulsante `#rankBtn` dopo `#addBtn`, pannello `#rankSheet` con `.sheet-head` "Classifiche" e `<div id="rankBody">` subito prima di `#detailSheet`, "versione 17")
- Modify: `app.js` (nuova sezione "Classifiche" prima di "Community")
- Modify: `style.css` (righe di classifica, chip dei generi/anni, `@media (max-width: 429px) { .brand-name { display: none } }`)
- Modify: `sw.js` (`animeteca-v17`)
- Test: `tests/rankings-ui.cjs` (Playwright, iPhone 13 e iPad Pro 11) + `tests/fixtures/rank-app/rankings.json`, `tests/fixtures/rank-app/rankings-old.json`

**Interfaces:**
- Consumes: forma di `Rankings` (Task 2); da `app.js`: `showDetail(anime)`, `findItem(id)`, `loadDB()`/`db.byId`, `openSheet`, `STATUS`, `GENRE_IT`/`genreLabel`, `placeholder(title)`, `esc`, `icon`, `fmtRating`.
- Produces: `loadRankings(): Promise<Rankings|null>` (una sola richiesta a `data/rankings.json`; `null` se manca o `version !== 1`), `renderRankings()`, stato `rank = {tab: "top"|"genres"|"year"|"reddit", genre: "Action", year: null, yearMode: "anime"|"episodes", redditYear: null}`.

- [ ] **Step 1: Test che fallisce** `tests/rankings-ui.cjs` (serve l'app come i test esistenti, `/data/rankings.json` dalla fixture):
  - iPhone: `.brand-name` nascosta, tutti i pulsanti dentro la barra; tocco `#rankBtn` → `#rankSheet.open`, scheda "Migliori" con righe numerate, voto "8,9" e "AniList 9,0 · MAL 8,8";
  - un anime della fixture già nella lista (seed in `localStorage`) mostra "Visto";
  - "Generi" → riga di chip scorrevole; tocco su "Romantico" cambia la lista;
  - "Anno": fixture con 3 titoli 2026 e 20 titoli 2025, `now` = novembre 2026 → selezionato 2025; "Episodi" mostra "Ep. 12";
  - "Reddit": anno più recente, categoria con "Giuria" e "Pubblico"; un vincitore con id `null` è una riga non toccabile;
  - tocco su una riga → `#detailSheet.open` con il titolo giusto, sopra la classifica;
  - con `rankings-old.json` (`version: 99`) o file mancante → testo "Le classifiche arrivano con il prossimo aggiornamento";
  - `sources.mal === false` → nota "questa settimana solo AniList";
  - nessun `pageerror`; `document.documentElement.scrollWidth <= innerWidth` con un titolo di 200 caratteri.
- [ ] **Step 2:** `node tests/rankings-ui.cjs` → FAIL (manca `#rankBtn`).
- [ ] **Step 3:** HTML e CSS come sopra (righe sul modello di `.result` della ricerca: numero in `.display`, copertina 46×69, titolo su 2 righe, voto a destra).
- [ ] **Step 4:** In `app.js`: `loadRankings`, `renderRankings` (schede `[data-rtab]`, chip `[data-genre]`, `[data-year]`, `[data-ymode]`, righe `[data-rid]`); al tocco su una riga: `findItem(id)` oppure `db.byId.get(id)` (dopo `loadDB()`), altrimenti un oggetto `{id, alId, title, image: coverPrefix + cover, type, year, episodes, genres: []}` passato a `showDetail`. Le schede Reddit ed Episodi non compaiono se `sources.reddit`/`sources.episodes` sono `false`. In fondo: "Voti: media di AniList e MyAnimeList · aggiornato il <data>".
- [ ] **Step 5:** `node tests/rankings-ui.cjs` → PASS; screenshot iPhone e iPad controllati a vista.
- [ ] **Step 6:** Commit "Classifiche: sezione nell'app (versione 17)".

### Task 5: Prova completa, documentazione, prima esecuzione vera

**Files:**
- Modify: `README.md` (sezione "Classifiche", tabella file con i due script)

- [ ] **Step 1:** Rieseguire `node --test tests/`, `node tests/rankings-ui.cjs` e i test esistenti dell'app (lista, statistiche, database, sincronizzazione, note, community): tutti verdi, nessun `pageerror`.
- [ ] **Step 2:** README: cosa c'è nelle Classifiche, da dove vengono i voti (media AniList + MyAnimeList, soglie), Reddit = r/anime Awards, aggiornamento del lunedì. Commit + push.
- [ ] **Step 3:** Il push di Task 3 avvia già il workflow (lo script è tra i `paths`); se serve rifarlo, avvio manuale con `scarica: false` e `minuti: 1` (lo script usa il database già salvato). Nel log: riepilogo dello script; nel repository: `data/rankings.json` salvato, con `sources` come atteso e liste non vuote.
- [ ] **Step 4:** Aprire l'app pubblicata non è possibile da qui: chiedere all'utente di aprire la coppa e controllare.

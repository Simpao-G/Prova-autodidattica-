# Animeteca: contesto tecnico del progetto

Riassunto per chi riprende il lavoro (persona o assistente AI). Aggiornato al 20/11/2026, **versione 17**.

## 1. Cos'è

- **App web installabile (PWA)** per tenere traccia degli anime: *In corso* (con l'episodio a cui sei arrivato),
  *Da vedere*, *Visti*.
- Pensata per **iPhone e iPad con Brave**, funziona anche su computer. Interfaccia **solo in italiano**.
- Indirizzo pubblico: https://simpao-g.github.io/Prova-autodidattica-/
- Repository: `Simpao-G/Prova-autodidattica-`, branch **`claude/zealous-babbage-3wz0go`**. È il branch predefinito ed
  è anche quello pubblicato da GitHub Pages: ogni push va online in circa un minuto.
- Proprietario non tecnico: vuole risultati concreti, grafica curata che "non sembri fatta da un'AI", niente servizi a
  pagamento e niente procedure complicate (come segnalibri speciali).

## 2. Architettura

```
Browser (PWA)                          GitHub Actions (ogni lunedì)              Supabase (gratuito)
index.html + style.css + app.js  <--   data/anime.json, data/d/*.json   <--      AniList GraphQL
sync-core.js (unione + client)         data/rankings.json               <--      anime-offline-database (manami)
sw.js (offline)                        traduzioni EN->IT (OPUS-MT)
        |                                                                         |
        +------------------ REST (Auth + PostgREST con RLS) ---------------------+
```

- **Frontend**: HTML, CSS e JavaScript "vanilla" (niente framework, niente build). Tutta la logica sta in un unico
  `app.js` (una IIFE di circa 2.400 righe divisa in sezioni con commenti `// ---------- Nome ----------`).
  - L'interfaccia è fatta di **pannelli che salgono dal basso** (`.sheet`): ricerca, scheda anime, statistiche,
    Community, Classifiche, Consiglia, menu.
  - L'ordine dei pannelli nella pagina decide quale sta sopra (stesso z-index), quindi conta.
- **Dati salvati sul dispositivo** (localStorage):

  | Chiave | Contenuto |
  |---|---|
  | `animeteca.v1` | la lista degli anime |
  | `animeteca.log.v1` | registro degli episodi segnati, per le statistiche |
  | `animeteca.deleted.v1` | cancellazioni con la data, per la sincronizzazione |
  | `animeteca.real.v1` | tempi "reali" vecchi: si conservano e si sincronizzano, ma non si mostrano più |
  | `animeteca.auth.v1` | sessione Supabase |
  | `animeteca.lastsync.v1` | ora dell'ultima sincronizzazione |
  | `animeteca.profile.v1` | profilo Community |
  | `animeteca.pub.v1` | impronte della lista già pubblicata per gli amici |

- **Offline**: `sw.js` con cache `animeteca-v17`.
  - I file dell'app si chiedono prima alla rete, poi alla cache.
  - Le copertine di AniList e MyAnimeList si prendono prima dalla cache.
  - **Va alzato il numero della cache a ogni versione.**
- **Database degli anime dentro l'app**, costruito da GitHub Actions:
  - `data/anime.json`: indice di circa 17.600 anime da AniList. Campi: `anilistId, malId, title, altTitle, type, year,
    episodes, cover, score (0-100), popularity, isSeason, duration`. Le copertine sono relative a `coverPrefix`.
  - `data/d/<n>.json`: 64 blocchi (anime `id % 64`) con `[descrizione inglese, generi, catena delle stagioni,
    descrizione italiana]`.
  - Id degli anime nell'app: `mal-<idMAL>` se c'è l'id di MyAnimeList, altrimenti `al-<idAniList>`.
    Attenzione: più voci AniList possono avere lo stesso id MAL.
- **Workflow** `.github/workflows/update-db.yml`:
  - Quando parte: ogni lunedì alle 03:17 UTC, a ogni push degli script, oppure a mano (input `scarica`, `minuti`).
  - Passi, in ordine:
    1. `scripts/build-db.mjs` scarica tutto AniList, un anno alla volta.
    2. `scripts/build-rankings.mjs` calcola le classifiche (`continue-on-error`).
    3. `scripts/translate.py` traduce le descrizioni nuove (OPUS-MT con CTranslate2 4.6.0, modello in cache, preparato
       da `scripts/prepare-translator.sh`).
    4. Il passo di salvataggio fa il commit di `data/` con 3 tentativi.
- **Backend Supabase** (indirizzo e chiave pubblica in `config.js`; nessuna chiave segreta da nessuna parte):
  - `supabase/setup.sql`: tabella `animeteca_data` (una riga per utente: `data jsonb`, `rev bigint`) con RLS.
    Serve alla sincronizzazione tra dispositivi.
  - `supabase/community.sql`:
    - tabelle `profiles`, `friendships`, `library` (la lista vista dagli amici: stato, episodio, voto, recensione;
      mai le note) e `recommendations`;
    - RLS su tutte le tabelle, più funzioni nello schema `private` (`friend_ids`, `connected_ids`, `find_user`) e
      `public.find_user` per cercare un utente con il nome esatto;
    - permessi per colonna.
  - Entrambi gli script sono già stati eseguiti dal proprietario nel SQL Editor di Supabase.
- **`sync-core.js`** (funziona sia nel browser sia in Node):
  - `merge(a, b)` unisce i dati di due dispositivi:
    - per ogni anime vince l'`updatedAt` più recente;
    - note e voti si uniscono a parte (`noteAt`, `ratingAt`);
    - il registro degli episodi è un'unione senza doppioni;
    - le cancellazioni sono rispettate.
  - `slim()` toglie i testi lunghi che l'app può riscaricare.
  - `createClient()` parla con Supabase via REST: login e registrazione, `getRemote`, `insertRemote` e `updateRemote`
    con controllo del `rev` (concorrenza ottimistica), più `rest()` e `rpc()` generici.

## 3. Funzionalità attuali

1. **Lista**:
   - tre stati e pulsante **+1** sulla copertina;
   - "Continua a guardare" in grande;
   - stagioni e film della stessa serie;
   - anime aggiunti a mano.
2. **Ricerca**: prima nel database locale (istantanea, anche offline), poi su AniList e infine su Jikan/MyAnimeList.
3. **Descrizioni in italiano** (traduzione automatica), con il pulsante "Mostra l'originale".
4. **Note personali** per ogni anime: private, salvate da sole mentre scrivi e sincronizzate.
5. **Statistiche**:
   - il tempo è **stimato dagli episodi segnati** (episodi × durata);
   - totale, oggi, settimana e mese;
   - grafico degli ultimi 7 giorni e generi più visti.
6. **Account** (email e password) con la stessa lista su iPhone e iPad.
7. **Community** (dalla v15):
   - nome utente unico e amicizie con richiesta e accettazione;
   - **voti da ½ a 5 stelle** con recensione;
   - attività degli amici e pagina di ogni amico;
   - "Consiglia a un amico";
   - pallino sulle novità e link d'invito `?amico=nome`.
8. **Classifiche** (dalla v17):
   - si aprono con la coppa in alto, schede **Migliori** (100), **Generi** (18 × 50) e **Anno** (5 anni × 50);
   - il tocco su un anime apre la sua scheda;
   - il calcolo è descritto nella sezione 4.

**Tolti nella v16**, su richiesta del proprietario: il timer di visione, il segnalibro per AnimeSaturn e il tempo
inserito a mano.

## 4. Decisioni prese (e perché)

| Decisione | Motivo |
|---|---|
| JavaScript vanilla e GitHub Pages | gratis, semplice da modificare, funziona offline, nessuna build |
| Database degli anime costruito in CI | ricerca istantanea e offline; AniList limita le ricerche, quindi si scarica un anno alla volta |
| Traduzione con OPUS-MT dentro GitHub Actions | nessuna API a pagamento; CTranslate2 4.6.0 perché la 4.5 non parte sui runner (stack eseguibile); `fix_italian` corregge gli accenti scritti con l'apostrofo |
| Supabase per account e sincronizzazione | piano gratuito, Auth e Postgres con RLS; nel client c'è solo la chiave pubblica |
| Sincronizzazione "un documento JSON per utente" | semplice; l'unione avviene nel client; il `rev` evita sovrascritture tra dispositivi |
| Privacy della Community nel database (RLS), non solo nell'app | provata su un vero PostgreSQL (PGlite) con 50 controlli; le note non escono mai; nessun elenco degli utenti |
| Niente conteggio del tempo su AnimeSaturn | Brave su iOS non ha estensioni e non salva segnalibri con codice; Comandi Rapidi esiste solo su iOS; NextDNS è a pagamento; il lettore video di AnimeSaturn non si lascia incorporare in altri siti (`frame-ancestors`). Resta solo la stima dagli episodi |
| Classifiche: voto = media tra AniList e la "media dei siti" del database pubblico **manami-project/anime-offline-database** (licenza ODbL) | Jikan (MyAnimeList) non risponde ai server di GitHub |
| Classifiche: la media dei siti vale solo per anime già finiti; serve un voto AniList; soglie di popolarità AniList (20.000 per Migliori e Generi, 2.000 per Anno); una voce per id | evita gli anime non ancora usciti con voto 10 "di attesa" e i doppioni |
| Niente classifica degli episodi né di Reddit | non c'è una fonte raggiungibile per i voti degli episodi; gli r/anime Awards sono pubblicati in automatico solo per 2017-2018 e Reddit blocca l'accesso diretto |
| Scritta "animeteca" nascosta sotto i 480 px | con 5 pulsanti in alto non c'è posto (resta il logo) |

## 5. File principali

| File | A cosa serve |
|---|---|
| `index.html` | struttura, icone SVG (`<symbol id="i-...">`), pannelli; "versione N" in fondo al menu |
| `style.css` | grafica "streaming notturno": variabili in `:root` (`--bg #0b0b0c`, `--accent #f5c542`), font Archivo in `fonts/` |
| `app.js` | tutta la logica dell'app (lista, ricerca, scheda, note, voti, statistiche, account, Community, Classifiche, backup) |
| `sync-core.js` | unione dei dati e client Supabase |
| `config.js` | indirizzo e chiave pubblica di Supabase |
| `sw.js`, `manifest.webmanifest`, `icons/` | funzionamento offline e installazione |
| `scripts/build-db.mjs` | download da AniList, scrive `data/` |
| `scripts/translate.py`, `scripts/prepare-translator.sh` | traduzione delle descrizioni |
| `scripts/rankings-core.mjs` | calcolo delle classifiche (puro, testabile) |
| `scripts/build-rankings.mjs` | scarica la media dei siti e scrive `data/rankings.json` |
| `supabase/setup.sql`, `supabase/community.sql` | tabelle e regole di sicurezza (da eseguire nel SQL Editor di Supabase) |
| `.github/workflows/update-db.yml` | aggiornamento settimanale |
| `tests/` | prove automatiche delle classifiche |
| `docs/superpowers/` | progetto, piano e verifica delle fonti delle Classifiche |
| `.agents/skills/find-skills`, `.claude/skills/`, `skills-lock.json` | skill "find-skills" installata con `npx skills` |

**Come lavorare:**
- per provare l'app sul computer: `python3 -m http.server 8000`, poi apri http://localhost:8000;
- prove automatiche: `node --test tests/*.test.mjs` e `node tests/rankings-ui.cjs` (serve Playwright);
- per pubblicare basta fare push sul branch: a ogni versione alza il numero in `index.html` e la cache in `sw.js`.

## 6. Cosa resta da fare

**Da decidere con il proprietario:**
- Una scheda "Reddit" con i vincitori degli r/anime Awards 2017-2018 (gli unici disponibili in automatico), oppure
  una lista "Più seguiti dalla community" basata sulla popolarità AniList.
- Un **ingranaggio Impostazioni**, richiesto in passato per scegliere cosa condividere con gli amici. Non è mai stato
  fatto: era legato al tempo su AnimeSaturn, che poi è stato tolto.
- Un "ping" settimanale per evitare che Supabase metta in pausa il progetto gratuito dopo un periodo senza uso.
  Era stato proposto ma mai confermato.

**Piccoli miglioramenti rimandati dalla revisione delle Classifiche:**
1. Le parti di una serie con lo stesso id MAL possono mancare da una lista di genere o anno: oggi si tolgono i doppioni
   *prima* di filtrare (esempio: Steel Ball Run 2nd-3rd Stage manca da "Soprannaturale").
2. Un `rankings.json` malformato con `version: 1` lascerebbe la rotellina di caricamento all'infinito: va controllata
   la forma in `loadRankings`.
3. Il primo tocco su una riga aspetta il database (2 MB) senza un segnale: andrebbe caricato in anticipo quando si
   aprono le Classifiche.
4. Offline, il messaggio delle Classifiche non dice che sei offline.
5. Nella scheda di riserva (anime non presente nel database) mancano il link e il voto, e il prefisso della copertina
   è aggiunto sempre.
6. `sitesUpdated` andrebbe scritto solo se si è preso almeno un voto.
7. Il controllo "script avviato direttamente" (`file://${process.argv[1]}`) andrebbe fatto con `pathToFileURL`.
8. I pulsanti degli anni non passano per `esc()` (i valori vengono dal codice, nessun rischio oggi).
9. Mancano alcune prove (scorrimento dentro il pannello, nuovo tentativo dopo un errore, barra in alto a 430 px), e il
   commento in testa a `tests/rankings-core.test.mjs` indica ancora il comando vecchio.

**Altro:**
- Le prove automatiche più vecchie (lista, statistiche, sincronizzazione, note, Community con un finto Supabase su
  PGlite) sono state scritte in una cartella temporanea e **non sono nel repository**: andrebbero portate in `tests/`.
- Verificare su un iPhone e un iPad veri Community e Classifiche: sono state provate solo nell'emulazione di Chromium.
- La "media dei siti" del database manami era aggiornata al 4/7/2026: se il progetto smette di aggiornarsi, gli anime
  nuovi resteranno con il solo voto AniList.

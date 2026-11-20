# Animeteca

App per il telefono per tenere traccia dei tuoi anime:

- **In corso**: segna a che episodio sei arrivato (pulsante **+1** direttamente sulla copertina)
- **Da vedere**: la tua lista dei desideri
- **Guardati**: gli anime finiti (quando arrivi all'ultimo episodio ci finiscono da soli)

Cerchi un anime per nome e l'app mostra **copertina, titolo, descrizione, episodi, anno, voto, generi**
e l'elenco di **stagioni e film** della serie. Se un anime non si trova lo puoi aggiungere a mano.

## Grafica

Stile "streaming notturno": nero e grafite, un solo colore acceso (giallo `#f5c542`) per ciò che
conta, titoli in [Archivo](https://github.com/Omnibus-Type/Archivo) stretto (licenza OFL, incluso in
`fonts/` così funziona anche offline), icone disegnate a mano in `index.html` e logo a nastro
segnalibro. Colori e misure sono variabili all'inizio di `style.css`.

## Da dove arrivano gli anime

Il database è **dentro l'app** (cartella `data/`), così la ricerca è istantanea, funziona offline e
non può essere bloccata da browser o reti lente.

Lo costruisce in automatico **GitHub Actions** (`.github/workflows/update-db.yml`), che scarica
tutti gli anime da [AniList](https://anilist.co) con `scripts/build-db.mjs`:

- parte da solo quando lo script cambia e **ogni lunedì**, per aggiungere gli anime nuovi;
- puoi avviarlo anche a mano: tab **Actions** → *Aggiorna database anime* → **Run workflow**;
- ci mette circa 15–20 minuti.

Se il database non c'è ancora, l'app cerca online su AniList e MyAnimeList.

### Descrizioni in italiano

Dopo aver scaricato gli anime, lo stesso workflow traduce le descrizioni con `scripts/translate.py`,
usando un modello di traduzione automatica open source che gira su GitHub
(preparato da `scripts/prepare-translator.sh`)
([Helsinki-NLP/opus-mt-en-it](https://huggingface.co/Helsinki-NLP/opus-mt-en-it) con CTranslate2):
niente servizi esterni né limiti di richieste. Parte dagli anime più popolari, traduce solo le
descrizioni nuove o cambiate e, se non finisce entro 4 ore, riprende alla volta successiva
(*Actions → Aggiorna database anime → Run workflow* togliendo "Riscarica" traduce soltanto).
Nell'app, sotto ogni descrizione tradotta, "Mostra l'originale" fa vedere il testo inglese.

**Note personali**: nella scheda di ogni anime della tua lista c'è "Le tue note" (si salvano da sole
mentre scrivi e si sincronizzano tra i dispositivi; se scrivi su due dispositivi vince l'ultima nota).
La prima riga della nota compare anche in "Continua a guardare".

Con il pulsante delle **statistiche** vedi quanto tempo passi a guardare anime: totale, oggi,
settimana e mese, grafico degli ultimi 7 giorni, episodi visti e generi preferiti. Il tempo è
**stimato dagli episodi che segni**: ogni episodio conta per la sua durata (di solito 23–24 minuti).

È una **PWA** (Progressive Web App): si installa sulla schermata Home e si apre a schermo intero come
un'app normale, anche offline. I dati restano salvati sul telefono; dal menu **⋯** puoi esportare e
importare un backup.

## Account: stessa lista su iPhone e iPad

Dal menu **⋯ → Account** crei un account (email e password) e lo usi su tutti i dispositivi.
Ogni dispositivo tiene la sua copia (funziona anche offline) e la unisce con quella online:
per ogni anime vince la modifica più recente, episodi e tempi si sommano senza doppioni,
le cancellazioni arrivano anche sugli altri dispositivi.

Il server è un progetto gratuito di [Supabase](https://supabase.com). Per configurarlo (una volta):

1. crea il progetto su supabase.com;
2. in **SQL Editor** esegui `supabase/setup.sql` (crea la tabella e le regole: ognuno vede solo i suoi dati);
3. sempre in **SQL Editor** esegui `supabase/community.sql` (serve alla community, vedi sotto);
4. in **Authentication → URL Configuration** metti come *Site URL* l'indirizzo dell'app;
5. copia *Project URL* e *publishable key* in `config.js`.

La logica di unione e il collegamento a Supabase sono in `sync-core.js`.

## Classifiche

Il pulsante con la **coppa**, in alto, apre le **Classifiche**:

- **Migliori**: i 100 anime con il voto più alto, tutti i generi;
- **Generi**: i 50 migliori per ogni genere (Azione, Commedia, Sentimentale, …);
- **Anno**: i 50 migliori usciti in ognuno degli ultimi 5 anni.

Toccando un anime si apre la sua scheda, da cui lo aggiungi alla lista; se è già nella tua lista
vedi il suo stato. Il voto è la **media tra AniList e la media dei siti** (MyAnimeList, Kitsu, AniDB,
Anime-Planet e altri) del database pubblico
[anime-offline-database](https://github.com/manami-project/anime-offline-database) (licenza ODbL).
Per evitare titoli con pochissimi voti entrano solo anime con un voto AniList e abbastanza pubblico;
la media dei siti si usa solo per gli anime già finiti.

Le classifiche (`data/rankings.json`) le ricalcola ogni lunedì lo stesso workflow del database con
`scripts/build-rankings.mjs` (il calcolo vero è in `scripts/rankings-core.mjs`). Se la media dei siti
non si scarica, quella settimana le classifiche usano solo AniList e l'app lo scrive.

Niente classifica degli episodi né di Reddit: MyAnimeList (tramite Jikan) non risponde ai server di
GitHub, i risultati degli r/anime Awards sono pubblicati in automatico solo per il 2017 e il 2018 e
Reddit blocca l'accesso diretto ai suoi dati.

## Community: amici, voti e consigli

Il pulsante con le due persone, in alto, apre la **Community** (serve l'account):

- **nome utente**: la prima volta ne scegli uno (es. `@simo`); gli amici ti trovano solo con il nome
  esatto, non esiste un elenco di tutti gli utenti. Con **Invita** mandi un link che apre l'app con il
  tuo nome già scritto;
- **amici**: scrivi il nome utente di un amico e gli arriva la richiesta; finché non la accetta non
  vedete niente l'uno dell'altro. Puoi togliere un amico quando vuoi;
- **voti**: nella scheda di ogni anime della tua lista dai da **½ a 5 stelle** (tocca la metà sinistra
  di una stella per il mezzo voto, tocca di nuovo lo stesso voto per toglierlo) e, se vuoi, scrivi una
  recensione. Le stelle compaiono anche sotto i poster;
- **Attività**: cosa guardano, finiscono e votano i tuoi amici; toccando un amico vedi la sua lista e il
  suo voto medio. Nella scheda di un anime, "I tuoi amici" mostra chi l'ha visto e con che voto;
- **Consigliati**: "Consiglia a un amico" (nella scheda di un anime) manda l'anime con un messaggio;
  chi lo riceve lo aggiunge a "Da vedere" con un tocco. Il pallino giallo sul pulsante segnala
  richieste di amicizia e consigli nuovi.

**Privacy**: gli amici vedono gli anime della tua lista (stato ed episodio), i voti e le recensioni;
le **note personali restano solo tue**. Chi non è tuo amico non vede niente. Queste regole stanno nel
database (Row Level Security in `supabase/community.sql`), non solo nell'app.

## Metterla sul telefono

L'app va pubblicata online una volta sola. Il modo più semplice è GitHub Pages:

1. Su GitHub apri il repository → **Settings** → **Pages**
2. In *Build and deployment* scegli **Deploy from a branch**, seleziona il branch con l'app e la cartella `/ (root)`, poi **Save**
3. Dopo un minuto GitHub mostra l'indirizzo, tipo `https://<tuo-utente>.github.io/<repository>/`

> GitHub Pages gratuito funziona solo con repository **pubblici**.

Poi, sul telefono:

- **iPhone (Safari)**: apri l'indirizzo → pulsante **Condividi** → **Aggiungi alla schermata Home**
- **Android (Chrome)**: apri l'indirizzo → menu **⋮** → **Installa app**

## Provarla sul computer

```bash
python3 -m http.server 8000
```
e apri <http://localhost:8000>.

## File

| File | Cosa fa |
|---|---|
| `index.html` | struttura della pagina |
| `style.css` | grafica |
| `app.js` | logica: lista, ricerca, episodi, stagioni, voti, community, backup |
| `sync-core.js` | unione dei dati tra dispositivi e collegamento a Supabase |
| `config.js` | indirizzo e chiave pubblica del progetto Supabase |
| `supabase/` | script SQL da eseguire una volta su Supabase (`setup.sql`, `community.sql`) |
| `data/` | database degli anime (generato in automatico, non modificarlo a mano) |
| `scripts/build-db.mjs` | script che crea il database da AniList |
| `scripts/build-rankings.mjs`, `scripts/rankings-core.mjs` | classifiche settimanali (`data/rankings.json`) |
| `tests/` | prove automatiche: `node --test tests/*.test.mjs` e `node tests/rankings-ui.cjs` |
| `sw.js` | service worker per funzionare offline |
| `manifest.webmanifest`, `icons/` | nome e icona dell'app installata |

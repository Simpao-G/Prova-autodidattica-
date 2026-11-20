# Classifiche — progetto

Data: 2026-11-20 · App: Animeteca (versione 16 → 17)

## Perché

L'utente vuole **sfogliare classifiche di anime** e, toccando un titolo, **aprire la sua scheda**
(da cui può aggiungerlo alla lista). Le classifiche devono basarsi su **fonti affidabili** e su una
fonte della **community (Reddit)**, e il voto di ogni anime deve essere la **media delle fonti**.

## Cosa c'è

Una nuova sezione **Classifiche**, aperta da un pulsante con la **coppa** nella barra in alto
(scelta dell'utente: opzione 1). Dentro, quattro schede:

1. **Migliori**: i 100 migliori anime di sempre, tutti i generi.
2. **Generi**: una riga di generi da scegliere (Azione, Avventura, Commedia, …); per ognuno i 50 migliori.
3. **Anno**: i 50 migliori anime **usciti in quell'anno** (anno in corso e i 4 precedenti, da scegliere),
   e i **migliori episodi dell'anno** (interpretazione di "ep", da confermare con l'utente).
4. **Reddit**: i vincitori degli **r/anime Awards** per anno e per genere, sia della giuria sia del pubblico.

Ogni riga: posizione, copertina, titolo, tipo/anno/episodi, **voto medio** (es. 8,9) e sotto i voti delle
singole fonti (AniList 9,0 · MAL 8,8). Se l'anime è già nella lista dell'utente compare il suo stato
(In corso / Da vedere / Visto). Toccando la riga si apre la **scheda dell'anime** già esistente.
In fondo: fonti e data dell'ultimo aggiornamento.

## Obiettivi, non obiettivi, cose da evitare

- Obiettivi: le quattro schede sopra; tocco → scheda; aggiornamento automatico ogni lunedì; funziona offline
  dopo la prima apertura; app veloce come ora.
- Non obiettivi: classifica settimanale di Reddit (Reddit blocca l'accesso automatico ai suoi dati);
  classifiche di manga, personaggi o studi; consigli personalizzati; classifica dei voti degli amici
  (si può aggiungere in futuro).
- Da evitare: titoli sconosciuti con pochissimi voti in cima; rallentare l'avvio dell'app; far fallire
  l'aggiornamento del database se una fonte non risponde.

## Il voto: media delle fonti

- **AniList**: voto medio (0–100 → 0–10) e popolarità, già presenti nel database dell'app (`data/anime.json`).
- **MyAnimeList**: voto (0–10) e numero di votanti, presi con il servizio gratuito **Jikan** (nessuna chiave).
- **Voto medio** = media semplice dei due voti; se una fonte manca si usa l'altra.
- **Soglia di voti** per entrare in classifica (valori da tarare): per Migliori e Generi circa 20.000 votanti
  MyAnimeList (o popolarità AniList equivalente se manca MAL); per Anno soglia molto più bassa (titoli nuovi).
- Per ogni anime che entra in una classifica e ha un id MyAnimeList si usa il suo voto MAL: preso dalle liste
  già scaricate o, se manca, chiesto singolarmente (limitato a poche centinaia di richieste).
- Episodi: l'unica fonte affidabile per episodio sono i voti agli episodi di MyAnimeList (scala 1–5), quindi lì
  **niente media**; si considerano gli episodi degli anime più votati dell'anno, così ogni episodio ha abbastanza voti.

## Come si costruisce

- **Calcolo**: nuovo script `scripts/build-rankings.mjs`, eseguito nel workflow settimanale
  `.github/workflows/update-db.yml` dopo il download da AniList, con `continue-on-error` (se fallisce resta il file
  della settimana prima). Legge `data/anime.json` e i generi da `data/d/*.json`, scarica i dati MyAnimeList via
  Jikan (circa 200 richieste, una al secondo, con nuovi tentativi), calcola le liste e scrive **`data/rankings.json`**.
  Se Jikan non risponde: classifiche solo AniList, segnalate nell'app ("questa settimana solo AniList").
- **Reddit**: i risultati ufficiali degli r/anime Awards sono pubblicati sul loro sito (r-anime.github.io/animeawards).
  Prima di scrivere il lettore si verifica con un'esecuzione di prova del workflow (da qui quei siti non sono
  raggiungibili) che i dati siano leggibili in automatico. Se non lo sono, la scheda Reddit resta nascosta e si
  avvisa l'utente. Lo stesso controllo si fa per i voti degli episodi su Jikan: se il campo manca, la parte
  "episodi" resta nascosta.
- **File `data/rankings.json`** (piccolo, ~100–200 KB): data di aggiornamento, quali fonti hanno risposto, e liste
  di riferimenti agli anime del database (id come nel database: `mal-<id>` o `al-<id>`) con voto medio e voti per
  fonte; episodi con anime, numero, titolo e voto; Reddit con anno, categoria, vincitore giuria e pubblico.
  Titoli, copertine, tipo e anno l'app li prende dal database che già carica per la ricerca.
- **App**:
  - pulsante coppa (`i-trophy`) dopo "Cerca"; sotto i 430 px di larghezza la scritta "animeteca" si nasconde
    (resta il logo) per fare spazio;
  - pannello `#rankSheet` messo prima della scheda anime nella pagina, così la scheda si apre sopra la classifica;
  - `data/rankings.json` e il database si caricano solo quando apri la sezione;
  - tocco su una riga → la scheda esistente (`showDetail`) con l'anime del database;
  - stessa grafica del resto (righe come la ricerca, schede come la Community).
- **Prove**: test del calcolo con dati finti (AniList + Jikan finti, Reddit finto) e prova dell'app nel browser
  (iPhone e iPad) con un `rankings.json` finto, più i test già esistenti.

## Scelte fatte da me (correggibili)

- Nelle classifiche entrano anche **seguiti e stagioni** (come fanno AniList e MyAnimeList).
- Tipi inclusi: serie TV, film, OVA, ONA e special; esclusi i video musicali e i titoli per adulti.
- Generi: quelli di AniList tranne Hentai, con i nomi in italiano già usati nell'app.
- Quantità: 100 Migliori, 50 per genere, 50 per anno (ultimi 5 anni), 30 episodi per l'anno in corso e quello prima.
- Anno mostrato di partenza: quello in corso, oppure il precedente se quest'anno ci sono meno di 10 titoli
  (per esempio a gennaio).

## Cosa resta da decidere a chi costruisce

Soglie esatte di voti, corrispondenza tra generi AniList e generi MyAnimeList, nomi italiani delle categorie degli
Awards, impaginazione delle liste lunghe.

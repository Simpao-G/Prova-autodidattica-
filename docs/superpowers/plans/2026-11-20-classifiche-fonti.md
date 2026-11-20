# Classifiche — verifica delle fonti (20/11/2026)

Verifica fatta con un workflow temporaneo sui server di GitHub (4 esecuzioni), perché da questa sessione
le fonti non sono raggiungibili.

## Jikan (MyAnimeList) — non utilizzabile

- `https://api.jikan.moe/v4/...` dai server di GitHub non risponde: nessuna risposta entro 25 secondi
  (`http 000`) in 3 esecuzioni diverse, su `top/anime`, `anime/{id}` ed `episodes`. Una prima esecuzione
  senza tempo massimo è rimasta bloccata per minuti.
- Conseguenze: niente voti MyAnimeList presi singolarmente e **niente voti agli episodi** (era l'unica fonte).

## Database pubblico manami-project/anime-offline-database — utilizzabile (sostituisce Jikan)

- File: `https://github.com/manami-project/anime-offline-database/releases/latest/download/anime-offline-database-minified.json`
  (62 MB, si scarica in meno di un secondo dai server di GitHub; esiste anche `.zst` da 6 MB).
- Struttura: `{ "$schema", "license", "repository", "scoreRange", "lastUpdate": "2026-07-04", "data": [...] }`,
  41.537 anime, di cui 29.998 con voto.
- Ogni anime: `sources` (indirizzi delle schede sui vari siti, tra cui `https://anilist.co/anime/<id>` e
  `https://myanimelist.net/anime/<id>`), `title`, `type`, `episodes`, `status`, `animeSeason {season, year}`,
  `picture`, `tags`, e
  `score: { arithmeticGeometricMean, arithmeticMean, median }` (scala 1–10) = **media dei voti dei vari siti**
  (MyAnimeList, AniList, Kitsu, AniDB, Anime-Planet, Simkl, …).
- Esempi: Frieren (AniList 154587) `arithmeticMean` 9,114; Steins;Gate (AniList 9253) 8,904, con 10 siti.
- Licenza ODbL/DbCL: si possono usare i dati citando la fonte.
- Ultimo aggiornamento della release: 4 luglio 2026 (gli anime usciti dopo non hanno ancora questo voto).

## r/anime Awards — dati solo 2017 e 2018

- Il sito ufficiale `https://r-anime.github.io/animeawards/` legge `data/<anno>.json`.
- Esistono solo `data/2017.json` e `data/2018.json`; dal 2016 e dal 2019 al 2026 risponde 404.
- Forma: `{ anime, sections: [ { name: "Genre Awards", awards: [ { name: "Best Action Anime",
  nominees: [ { id: <AniList id>, jury: <posizione>, public: <posizione>, ... } ] } ] } ] }`.
- Dati degli anni recenti non disponibili in automatico (e Reddit blocca l'accesso diretto).

## Decisioni per i task successivi

- Voto medio = media tra **AniList** (voto fresco dal nostro database, `averageScore / 10`) e la **media dei siti**
  del database manami (`score.arithmeticMean`), abbinati con l'id AniList; se manca una delle due, l'altra.
- Soglia di "abbastanza voti": popolarità AniList (≥ 20.000 per Migliori e Generi, ≥ 2.000 per Anno).
- **Niente classifica degli episodi** e **niente scheda Reddit** (dati non disponibili): la sezione ha tre schede,
  Migliori · Generi · Anno.

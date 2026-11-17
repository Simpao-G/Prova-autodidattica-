# Animeteca

App per il telefono per tenere traccia dei tuoi anime:

- **In corso**: segna a che episodio sei arrivato (pulsante **+1** direttamente sulla copertina)
- **Da vedere**: la tua lista dei desideri
- **Guardati**: gli anime finiti (quando arrivi all'ultimo episodio ci finiscono da soli)

Cerchi un anime per nome e l'app mostra **copertina, titolo, descrizione, episodi, anno, voto, generi**
e l'elenco di **stagioni e film** della serie. Se un anime non si trova lo puoi aggiungere a mano.

## Da dove arrivano gli anime

Il database è **dentro l'app** (cartella `data/`), così la ricerca è istantanea, funziona offline e
non può essere bloccata da browser o reti lente.

Lo costruisce in automatico **GitHub Actions** (`.github/workflows/update-db.yml`), che scarica
tutti gli anime da [AniList](https://anilist.co) con `scripts/build-db.mjs`:

- parte da solo quando lo script cambia e **ogni lunedì**, per aggiungere gli anime nuovi;
- puoi avviarlo anche a mano: tab **Actions** → *Aggiorna database anime* → **Run workflow**;
- ci mette circa 15–20 minuti.

Se il database non c'è ancora, l'app cerca online su AniList e MyAnimeList.

Con il pulsante **📊** vedi le **statistiche**: tempo passato sugli anime, episodi visti, oggi /
settimana / mese, grafico degli ultimi 7 giorni e generi preferiti.

**Timer di visione** (funziona anche con Brave): nella scheda di un anime premi **⏱ Inizia a guardare**,
poi passa alla scheda dove guardi l'episodio. L'app conta il tempo in cui sei fuori e, quando torni,
ti chiede quanto hai guardato e quanti episodi segnare. Le uscite sotto il minuto non contano; se
resti via più di 3 ore ti avvisa che forse hai dimenticato il timer acceso.

È una **PWA** (Progressive Web App): si installa sulla schermata Home e si apre a schermo intero come
un'app normale, anche offline. I dati restano salvati sul telefono; dal menu **⋯** puoi esportare e
importare un backup.

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
| `app.js` | logica: lista, ricerca, episodi, stagioni, backup |
| `data/` | database degli anime (generato in automatico, non modificarlo a mano) |
| `scripts/build-db.mjs` | script che crea il database da AniList |
| `sw.js` | service worker per funzionare offline |
| `manifest.webmanifest`, `icons/` | nome e icona dell'app installata |

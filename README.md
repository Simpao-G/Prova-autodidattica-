# Animeteca

App per il telefono per tenere traccia dei tuoi anime:

- **In corso**: segna a che episodio sei arrivato (pulsante **+1** direttamente sulla copertina)
- **Da vedere**: la tua lista dei desideri
- **Guardati**: gli anime finiti (quando arrivi all'ultimo episodio ci finiscono da soli)

Cerchi un anime per nome e l'app prende **copertina, titolo, descrizione, episodi, anno, voto e generi**
da MyAnimeList (tramite l'API gratuita [Jikan](https://jikan.moe)). Se un anime non si trova lo puoi aggiungere a mano.

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
| `app.js` | logica: lista, ricerca, episodi, backup |
| `sw.js` | service worker per funzionare offline |
| `manifest.webmanifest`, `icons/` | nome e icona dell'app installata |

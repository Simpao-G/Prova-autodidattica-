// SOLO PER PROVE IN LOCALE (nessuna rete): aggiunge a data/anime.json i campi `genres` e `start`,
// ricavandoli dai blocchi data/d/*.json già presenti, con le stesse funzioni di scripts/build-db.mjs.
// Il campo `status` non si può ricavare da qui (serve AniList): se manca resta assente e l'app lo segnala.
//
// Il database vero lo costruisce GitHub Actions (build-db.mjs): questo file NON va committato in data/.
// Avvio: node scripts/enrich-index.mjs [cartella-data]
// Scrive in un file temporaneo e poi lo sostituisce; si può rilanciare senza danni.

import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GENRES } from "./rankings-core.mjs";
import { genreMask, seriesStart } from "./build-db.mjs";

const DEFAULT_DATA = fileURLToPath(new URL("../data/", import.meta.url));
const BASE_FIELDS = 12; // anilistId ... duration: le colonne dell'indice originale

export async function enrich(dir = DEFAULT_DATA) {
  const file = path.join(dir, "anime.json");
  const index = JSON.parse(await readFile(file, "utf8"));
  const pos = Object.fromEntries(index.fields.map((name, i) => [name, i]));
  for (const need of ["anilistId", "isSeason"]) if (pos[need] === undefined) throw new Error(`campo mancante nell'indice: ${need}`);

  // generi e catena delle stagioni di ogni anime, dai blocchi dei dettagli (un blocco mancante = nessun dato)
  const genres = new Map();
  const chains = new Map();
  for (let n = 0; n < (index.shards || 64); n++) {
    let shard;
    try {
      shard = JSON.parse(await readFile(path.join(dir, "d", `${n}.json`), "utf8"));
    } catch {
      continue;
    }
    for (const [id, entry] of Object.entries(shard)) {
      genres.set(Number(id), entry[1] || []);
      chains.set(Number(id), entry[2] || []);
    }
  }
  const seasonIds = new Set(index.items.filter((r) => r[pos.isSeason]).map((r) => r[pos.anilistId]));

  // si tengono le colonne che c'erano (anche `status`, se già presente) e si ricalcolano genres e start
  const keep = index.fields.map((name, i) => [name, i]).filter(([name]) => name !== "genres" && name !== "start");
  const fields = [...keep.map(([name]) => name), "genres", "start"];
  const items = index.items.map((row) => {
    const id = row[pos.anilistId];
    return [...keep.map(([, i]) => row[i]), genreMask(genres.get(id)), seriesStart(id, chains.get(id), (x) => seasonIds.has(x))];
  });

  const out = { ...index, fields, genreNames: GENRES, items };
  const tmp = file + ".tmp";
  await writeFile(tmp, JSON.stringify(out));
  await rename(tmp, file);
  const starts = items.reduce((n, r) => n + r[fields.length - 1], 0);
  console.log(`Indice arricchito: ${items.length} anime, ${starts} inizi di serie; colonne: ${fields.slice(BASE_FIELDS).join(", ")}.`);
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  enrich(process.argv[2] ? path.resolve(process.argv[2]) : undefined).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

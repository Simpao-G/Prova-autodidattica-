"""Traduce in italiano le descrizioni degli anime del database (data/d/*.json).

Usa un modello di traduzione automatica open source che gira direttamente sul
computer di GitHub Actions (Helsinki-NLP OPUS-MT en-it, convertito per CTranslate2
da scripts/prepare-translator.sh): niente servizi esterni e niente limiti di richieste.

- Traduce solo le descrizioni nuove o cambiate, partendo dagli anime più popolari.
- Si ferma da solo dopo TIME_LIMIT_MIN minuti: quello che ha tradotto resta salvato
  e la volta dopo riparte da dove si era fermato.
- Ogni voce di data/d/<n>.json è [descrizione_inglese, generi, stagioni, descrizione_italiana].

Uso:
  python scripts/translate.py           traduce
  python scripts/translate.py --check   dice solo quante descrizioni mancano
Per le prove senza modello: FAKE_TRANSLATOR=1
"""
import json
import os
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.environ.get("DATA_DIR", ROOT / "data"))
MODEL_DIR = os.environ.get("MODEL_DIR", str(ROOT / ".cache" / "opus-mt-en-it-ct2"))
TIME_LIMIT = float(os.environ.get("TIME_LIMIT_MIN", "240")) * 60
SAVE_EVERY = float(os.environ.get("SAVE_EVERY_S", "300"))  # salva i progressi ogni 5 minuti
BATCH = int(os.environ.get("BATCH", "600"))  # frasi tradotte per volta

# Fine frase: . ! ? … (eventualmente seguiti da virgolette o parentesi) prima di una maiuscola
SENTENCE_END = re.compile(
    r'(?<!\bMr\.)(?<!\bMs\.)(?<!\bDr\.)(?<!\bSt\.)(?<!\bJr\.)(?<!\bSr\.)(?<!\bMrs\.)(?<!\bvs\.)'  # abbreviazioni
    r'(?:(?<=[.!?…])|(?<=[.!?…]["”’)\]]))\s+(?=["“‘(\[]?[A-Z0-9])'
)


# Il modello scrive spesso gli accenti finali con l'apostrofo (come nei testi da cui ha
# imparato): "sara'" invece di "sarà". Qui si correggono, senza toccare gli apostrofi veri
# ("l'avventura", "un po'") né le virgolette singole ('Kyuubi').
GRAVE = {"a": "à", "e": "è", "i": "ì", "o": "ò", "u": "ù"}
KEEP_APOSTROPHE = {"po", "mo"}  # "un po'", "a mo' di"


def fix_italian(text):
    lines = []
    for line in text.split("\n"):
        chars = list(line)
        quote_open = False
        for i, ch in enumerate(chars):
            if ch != "'":
                continue
            prev = chars[i - 1] if i > 0 else " "
            nxt = chars[i + 1] if i + 1 < len(chars) else " "
            if not prev.isalpha():  # dopo uno spazio: virgoletta che si apre
                quote_open = quote_open or nxt.isalpha()
                continue
            if nxt.isalpha():  # elisione: l'anime, dell'eroe
                continue
            if quote_open:  # 'parola' -> virgoletta che si chiude
                quote_open = False
                continue
            word = re.search(r"[^\W\d_]+$", "".join(chars[:i]))
            word = word.group(0).lower() if word else ""
            vowel = prev.lower()
            if vowel not in GRAVE or word in KEEP_APOSTROPHE:
                continue
            accented = "é" if vowel == "e" and (word.endswith("ché") or word.endswith("che") or word in ("ne", "se")) else GRAVE[vowel]
            chars[i - 1] = accented.upper() if prev.isupper() else accented
            chars[i] = ""
        lines.append("".join(chars))
    return "\n".join(lines)


def split_sentences(line):
    parts = [p.strip() for p in SENTENCE_END.split(line) if p.strip()]
    return parts or [line.strip()]


def load_index():
    """id AniList -> posizione per popolarità (0 = il più popolare), numero di blocchi."""
    index = json.loads((DATA / "anime.json").read_text("utf-8"))
    order = {row[0]: i for i, row in enumerate(index["items"])}
    return order, index.get("shards", 64)


def load_shards(count):
    shards = []
    for i in range(count):
        path = DATA / "d" / f"{i}.json"
        shards.append(json.loads(path.read_text("utf-8")) if path.exists() else {})
    return shards


def save_shards(shards, dirty):
    for i in sorted(dirty):
        path = DATA / "d" / f"{i}.json"
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(shards[i], ensure_ascii=False, separators=(",", ":")), "utf-8")
        tmp.replace(path)
    dirty.clear()


def find_todo(shards, order):
    """Descrizioni inglesi senza traduzione, dalla più popolare."""
    todo = []
    for n, shard in enumerate(shards):
        for key, entry in shard.items():
            english = entry[0] if entry else ""
            if english and (len(entry) < 4 or not entry[3]):
                todo.append((order.get(int(key), 10**9), n, key))
    todo.sort()
    return todo


def make_translator():
    if os.environ.get("FAKE_TRANSLATOR"):  # per le prove, senza modello
        delay = float(os.environ.get("FAKE_DELAY", "0"))

        def fake(sentences):
            time.sleep(delay)
            return ["[IT] " + s for s in sentences]

        return fake

    import ctranslate2
    import sentencepiece as spm

    # il testo si divide in pezzi con lo stesso "vocabolario" usato per addestrare il modello
    source_sp = spm.SentencePieceProcessor(model_file=os.path.join(MODEL_DIR, "source.spm"))
    target_sp = spm.SentencePieceProcessor(model_file=os.path.join(MODEL_DIR, "target.spm"))
    with open(os.path.join(MODEL_DIR, "config.json"), encoding="utf-8") as f:
        config = json.load(f)
    # i modelli Marian vogliono "</s>" a fine frase: va aggiunto solo se il modello non lo fa già
    add_eos = not config.get("add_source_eos", False)
    translator = ctranslate2.Translator(
        MODEL_DIR, device="cpu", compute_type="int8", inter_threads=1, intra_threads=os.cpu_count() or 4
    )

    def translate(sentences):
        source = []
        for s in sentences:
            pieces = source_sp.encode(s, out_type=str)[:400]
            source.append(pieces + ["</s>"] if add_eos else pieces)
        results = translator.translate_batch(source, max_batch_size=48, beam_size=2, max_decoding_length=400)
        return [target_sp.decode([t for t in r.hypotheses[0] if t != "</s>"]).strip() for r in results]

    return translate


def main():
    order, count = load_index()
    shards = load_shards(count)
    # corregge gli accenti anche nelle traduzioni già fatte (non cambia quelle già a posto)
    fixed = set()
    for n, shard in enumerate(shards):
        for entry in shard.values():
            if len(entry) > 3 and entry[3]:
                better = fix_italian(entry[3])
                if better != entry[3]:
                    entry[3] = better
                    fixed.add(n)
    if fixed and "--check" not in sys.argv:
        save_shards(shards, set(fixed))
        print(f"Accenti corretti nelle traduzioni già fatte ({len(fixed)} blocchi)", flush=True)
    todo = find_todo(shards, order)
    print(f"Descrizioni da tradurre: {len(todo)}", flush=True)

    if "--check" in sys.argv:
        output = os.environ.get("GITHUB_OUTPUT")
        if output:
            with open(output, "a", encoding="utf-8") as f:
                f.write(f"todo={len(todo)}\n")
        return
    if not todo:
        return

    translate = make_translator()
    start = last_save = time.time()
    dirty = set()
    done = 0
    i = 0
    while i < len(todo) and time.time() - start < TIME_LIMIT:
        # prende abbastanza descrizioni per riempire un gruppo di frasi
        sentences, plan = [], []
        while i < len(todo) and len(sentences) < BATCH:
            _, shard, key = todo[i]
            i += 1
            layout = []  # per ogni riga: (prima frase, quante frasi) oppure None se è vuota
            for line in shards[shard][key][0].split("\n"):
                if line.strip():
                    parts = split_sentences(line)
                    layout.append((len(sentences), len(parts)))
                    sentences.extend(parts)
                else:
                    layout.append(None)
            plan.append((shard, key, layout))

        translated = translate(sentences)

        for shard, key, layout in plan:
            lines = ["" if slot is None else " ".join(translated[slot[0] : slot[0] + slot[1]]) for slot in layout]
            entry = shards[shard][key]
            while len(entry) < 4:
                entry.append(None)
            entry[3] = fix_italian("\n".join(lines).strip())
            dirty.add(shard)
            done += 1

        if time.time() - last_save > SAVE_EVERY:
            save_shards(shards, dirty)
            last_save = time.time()
            print(f"{done}/{len(todo)} tradotte ({(time.time() - start) / 60:.0f} min)", flush=True)

    save_shards(shards, dirty)
    print(f"Fatto: {done} tradotte in {(time.time() - start) / 60:.1f} min, ne restano {len(todo) - done}.", flush=True)


if __name__ == "__main__":
    main()

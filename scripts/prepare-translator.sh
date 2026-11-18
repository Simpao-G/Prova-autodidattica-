#!/usr/bin/env bash
# Prepara il modello di traduzione inglese -> italiano per scripts/translate.py:
# Helsinki-NLP OPUS-MT en-it, convertito per CTranslate2 (in .cache/opus-mt-en-it-ct2).
#
# 1. scarica il modello nel formato originale OPUS-MT e lo converte (servono solo
#    ctranslate2 e sentencepiece, niente PyTorch);
# 2. se quel file non si trova, usa la versione pubblicata su Hugging Face (con PyTorch).
set -euo pipefail

OUT=".cache/opus-mt-en-it-ct2"
# ctranslate2 >= 4.6.0: le versioni precedenti chiedono lo "stack eseguibile",
# che i Linux recenti (come quelli di GitHub Actions) non concedono più.
pip install --quiet "ctranslate2==4.6.0" "sentencepiece==0.2.0"

if [ -f "$OUT/model.bin" ] && [ -f "$OUT/source.spm" ] && [ -f "$OUT/target.spm" ]; then
  echo "Modello di traduzione già pronto (dalla cache)."
  exit 0
fi

RAW="${RUNNER_TEMP:-/tmp}/opus-mt-en-it"
for url in \
  "https://object.pouta.csc.fi/OPUS-MT-models/en-it/opus-2019-12-18.zip" \
  "https://object.pouta.csc.fi/OPUS-MT-models/en-it/opus-2020-01-08.zip"; do
  rm -rf "$RAW" && mkdir -p "$RAW"
  if curl -sSfL --retry 3 -o "$RAW/model.zip" "$url"; then
    echo "Scaricato il modello originale: $url"
    unzip -q -o "$RAW/model.zip" -d "$RAW"
    ct2-opus-mt-converter --model_dir "$RAW" --output_dir "$OUT" --quantization int8 --force
    cp "$RAW/source.spm" "$RAW/target.spm" "$OUT/"
    rm -rf "$RAW"
    echo "Modello pronto in $OUT"
    exit 0
  fi
  echo "Non disponibile: $url"
done

echo "Modello originale non trovato: uso la versione su Hugging Face."
pip install --quiet "torch==2.5.1" --index-url https://download.pytorch.org/whl/cpu
pip install --quiet "transformers==4.46.3"
ct2-transformers-converter --model Helsinki-NLP/opus-mt-en-it --output_dir "$OUT" --quantization int8 --force
python - <<'PY'
import shutil
from huggingface_hub import hf_hub_download
for name in ("source.spm", "target.spm"):
    shutil.copy(hf_hub_download("Helsinki-NLP/opus-mt-en-it", name), f".cache/opus-mt-en-it-ct2/{name}")
PY
echo "Modello pronto in $OUT"

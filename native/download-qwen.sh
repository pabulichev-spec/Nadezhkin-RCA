#!/usr/bin/env bash
set -euo pipefail

DEST_DIR="${1:-$PWD/models}"
MODEL_NAME="Qwen3-4B-Q4_K_M.gguf"
URL="https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/main/${MODEL_NAME}?download=true"
mkdir -p "$DEST_DIR"
DEST="$DEST_DIR/$MODEL_NAME"

if [[ -s "$DEST" && $(stat -c%s "$DEST") -ge 2000000000 ]]; then
  echo "Already present: $DEST"
  exit 0
fi

echo "Downloading $MODEL_NAME (~2.5 GB) from the official Qwen repository..."
curl --fail --location --retry 5 --continue-at - --progress-bar "$URL" --output "$DEST"
SIZE=$(stat -c%s "$DEST")
if [[ "$SIZE" -lt 2000000000 ]]; then
  echo "Downloaded file is too small or incomplete: $SIZE bytes" >&2
  rm -f "$DEST"
  exit 1
fi
printf 'Downloaded: %s (%s bytes)\n' "$DEST" "$SIZE"

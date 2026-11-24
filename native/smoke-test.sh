#!/usr/bin/env bash
set -euo pipefail

MODEL_PATH="${1:-$PWD/Qwen3-4B-Q4_K_M.gguf}"
ADB_BIN="${ADB:-adb}"
REMOTE_DIR="/data/local/tmp/pumprca-llama"

if [[ ! -f "$MODEL_PATH" ]]; then
  echo "Model not found: $MODEL_PATH" >&2
  exit 2
fi
if ! "$ADB_BIN" get-state >/dev/null 2>&1; then
  echo "No authorized Android device. Connect Galaxy S25 Ultra and authorize USB debugging." >&2
  exit 3
fi

"$ADB_BIN" shell "mkdir -p $REMOTE_DIR"
"$ADB_BIN" shell getprop ro.product.model
"$ADB_BIN" shell getprop ro.build.version.sdk
"$ADB_BIN" shell getprop ro.product.cpu.abilist
"$ADB_BIN" shell "df -h /data"
"$ADB_BIN" push "$MODEL_PATH" "$REMOTE_DIR/model.gguf"

START_NS=$(date +%s%N)
"$ADB_BIN" shell "dumpsys meminfo | grep -E 'Avail Mem|Total RAM' || true"
"$ADB_BIN" shell "cd $REMOTE_DIR && ./bin/llama-cli -m model.gguf --jinja -c 4096 -n 128 -p 'Ответь одним предложением по-русски: что такое RCA отказа насоса?' --no-display-prompt" 2>&1 | tee smoke-output.log
END_NS=$(date +%s%N)

python3 - "$START_NS" "$END_NS" <<'PY'
import sys
start, end = map(int, sys.argv[1:])
print(f"wall_time_ms={(end-start)/1_000_000:.1f}")
PY

"$ADB_BIN" shell "dumpsys meminfo | grep -E 'Avail Mem|Total RAM' || true"

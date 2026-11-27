#!/bin/sh
set -eu

# Build the browser playground WebAssembly VibeLang compiler bundle and copy
# the matching Go wasm_exec.js runtime into site/public/playground/.
#
# Usage:
#   sh scripts/build-playground-wasm.sh           # builds vibelang.wasm + wasm_exec.js
#   sh scripts/build-playground-wasm.sh --gzip    # also writes vibelang.wasm.gz

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TSC_DIR="$ROOT_DIR/typescript/tsc"
OUT_DIR="${PLAYGROUND_WASM_OUT_DIR:-$ROOT_DIR/site/public/playground}"
WRITE_GZIP=0

for arg in "$@"; do
  case "$arg" in
    --gzip) WRITE_GZIP=1 ;;
    -h|--help)
      echo "Usage: $0 [--gzip]"
      echo "Builds typescript/tsc/cmd/vibelang-wasm into site/public/playground/vibelang.wasm and copies wasm_exec.js."
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$OUT_DIR"

echo "Building VibeLang WASM compiler -> $OUT_DIR/vibelang.wasm"
(
  cd "$TSC_DIR"
  GOOS=js GOARCH=wasm go build -trimpath -ldflags="-s -w" -o "$OUT_DIR/vibelang.wasm" ./cmd/vibelang-wasm
)

GOROOT_DIR="$(cd "$TSC_DIR" && go env GOROOT)"
WASM_EXEC=""
for candidate in "$GOROOT_DIR/lib/wasm/wasm_exec.js" "$GOROOT_DIR/misc/wasm/wasm_exec.js"; do
  if [ -f "$candidate" ]; then
    WASM_EXEC="$candidate"
    break
  fi
done

if [ -z "$WASM_EXEC" ]; then
  echo "Error: could not locate wasm_exec.js under GOROOT=$GOROOT_DIR" >&2
  exit 1
fi

rm -f "$OUT_DIR/wasm_exec.js"
cp "$WASM_EXEC" "$OUT_DIR/wasm_exec.js"
chmod 0644 "$OUT_DIR/wasm_exec.js"

RAW_BYTES="$(wc -c < "$OUT_DIR/vibelang.wasm" | tr -d " ")"
GZIP_BYTES="$(gzip -9 -c "$OUT_DIR/vibelang.wasm" | wc -c | tr -d " ")"

if [ "$WRITE_GZIP" = "1" ]; then
  gzip -9 -c "$OUT_DIR/vibelang.wasm" > "$OUT_DIR/vibelang.wasm.gz"
fi

awk -v raw="$RAW_BYTES" -v gz="$GZIP_BYTES" 'BEGIN {
  printf "vibelang.wasm built: raw=%.2f MB (%d bytes), gzip-9=%.2f MB (%d bytes)\n", raw/1048576, raw, gz/1048576, gz
}'
echo "wasm_exec.js copied from $WASM_EXEC"

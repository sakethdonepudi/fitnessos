#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/server/bin"
mkdir -p "$OUT"
if [[ "$(uname)" != "Darwin" ]]; then
  echo "Vision OCR build is macOS-only. The server will fall back to manual entry."
  exit 0
fi
echo "Compiling Vision OCR helper..."
swiftc -O "$ROOT/tools/ocr-vision.swift" -o "$OUT/ocr-vision" -framework Vision -framework AppKit
echo "Built $OUT/ocr-vision"

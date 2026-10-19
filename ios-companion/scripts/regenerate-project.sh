#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if ! command -v xcodegen >/dev/null 2>&1; then
  echo "Install XcodeGen first: brew install xcodegen"
  exit 1
fi
xcodegen generate
python3 scripts/patch-pbxproj.py
echo "Open FitnessOSCompanion.xcodeproj and select your Apple team."

#!/bin/bash
# Build standalone binaries for MyHealthSpan Agent
# Targets: macOS (ARM64 + x64), Windows (x64), Linux (x64)
#
# Prerequisites:
#   npm install -g @yao-pkg/pkg   (community-maintained fork of vercel/pkg)
#
# Usage:
#   npm run build:bin
#   # or directly:
#   bash scripts/build-binaries.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BIN_DIR="dist/bin"
ENTRY="dist/index.js"
PKG_TARGETS="node22-macos-arm64,node22-macos-x64,node22-win-x64,node22-linux-x64"

echo "================================================"
echo "  MyHealthSpan Agent — Binary Builder"
echo "================================================"
echo ""

# Step 1: Ensure TypeScript is compiled
if [ ! -f "$ENTRY" ]; then
  echo "[1/4] Compiling TypeScript..."
  npm run build
else
  echo "[1/4] TypeScript already compiled — skipping (run 'npm run build' to refresh)"
fi

# Step 2: Clean previous binaries
echo "[2/4] Cleaning previous binaries..."
rm -rf "$BIN_DIR"
mkdir -p "$BIN_DIR"

# Step 3: Build binaries
echo "[3/4] Building standalone binaries..."
echo "       Targets: $PKG_TARGETS"
echo ""

# Prefer @yao-pkg/pkg (actively maintained fork), fall back to legacy pkg
if command -v pkg &>/dev/null; then
  PKG_CMD="pkg"
elif npx --yes @yao-pkg/pkg --help &>/dev/null 2>&1; then
  PKG_CMD="npx --yes @yao-pkg/pkg"
else
  echo "  pkg not found — trying bun build --compile as fallback..."

  if command -v bun &>/dev/null; then
    echo "  Building with bun..."
    bun build "$ENTRY" --compile --outfile "$BIN_DIR/mhs-macos-$(uname -m)"
    echo ""
    echo "  Note: bun build --compile only targets the current platform."
    echo "  For cross-platform builds, install pkg: npm install -g @yao-pkg/pkg"
    echo ""
    echo "[4/4] Done."
    ls -lh "$BIN_DIR/"
    exit 0
  else
    echo "ERROR: Neither pkg nor bun found. Install one of:"
    echo "  npm install -g @yao-pkg/pkg"
    echo "  curl -fsSL https://bun.sh/install | bash"
    exit 1
  fi
fi

$PKG_CMD "$ENTRY" \
  --targets "$PKG_TARGETS" \
  --output "$BIN_DIR/mhs" \
  --compress GZip \
  --config package.json

# Step 4: Verify and list outputs
echo ""
echo "[4/4] Build complete. Binaries:"
echo ""

for f in "$BIN_DIR"/mhs-*; do
  if [ -f "$f" ]; then
    size=$(ls -lh "$f" | awk '{print $5}')
    name=$(basename "$f")
    printf "  %-30s %s\n" "$name" "$size"
  fi
done

echo ""
echo "Upload these to your CDN / GitHub Releases / Vercel for distribution."
echo "================================================"

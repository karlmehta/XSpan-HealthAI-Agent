#!/bin/bash
# Package MyHealthSpan Agent as a macOS .dmg installer
#
# Prerequisites:
#   brew install create-dmg   (optional — falls back to hdiutil)
#   Run build-binaries.sh first to produce dist/bin/mhs-macos-*
#
# Usage:
#   npm run build:mac
#   # or directly:
#   bash scripts/package-mac.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_NAME="MyHealthSpan Agent"
DMG_NAME="MyHealthSpan-Agent"
VERSION=$(node -p "require('./package.json').version")
DMG_OUTPUT="dist/${DMG_NAME}-${VERSION}.dmg"
STAGE_DIR="dist/dmg-stage"
ICON_FILE="assets/logo-icon.png"

echo "================================================"
echo "  MyHealthSpan Agent — macOS .dmg Packager"
echo "  Version: ${VERSION}"
echo "================================================"
echo ""

# --- Detect architecture ---
ARCH="$(uname -m)"
case "$ARCH" in
  arm64)  BINARY="dist/bin/mhs-macos-arm64" ;;
  x86_64) BINARY="dist/bin/mhs-macos-x64" ;;
  *)
    echo "ERROR: Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

if [ ! -f "$BINARY" ]; then
  echo "ERROR: Binary not found at $BINARY"
  echo "Run 'npm run build:bin' first."
  exit 1
fi

# --- Prepare staging directory ---
echo "[1/4] Preparing staging directory..."
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"

# Copy binary
cp "$BINARY" "$STAGE_DIR/mhs"
chmod +x "$STAGE_DIR/mhs"

# Copy assets
if [ -f "$ICON_FILE" ]; then
  cp "$ICON_FILE" "$STAGE_DIR/"
fi

# Create installer script that copies binary to /usr/local/bin
cat > "$STAGE_DIR/Install.command" << 'INSTALLER'
#!/bin/bash
# MyHealthSpan Agent — Installer
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="/usr/local/bin"
BIN_NAME="mhs"

echo ""
echo "  Installing MyHealthSpan Agent..."
echo ""

if [ -w "$INSTALL_DIR" ]; then
  cp "$SCRIPT_DIR/$BIN_NAME" "$INSTALL_DIR/$BIN_NAME"
else
  echo "  Requesting admin privileges to install to $INSTALL_DIR..."
  sudo cp "$SCRIPT_DIR/$BIN_NAME" "$INSTALL_DIR/$BIN_NAME"
fi

chmod +x "$INSTALL_DIR/$BIN_NAME"

echo "  Installed to $INSTALL_DIR/$BIN_NAME"
echo ""
echo "  Run 'mhs' in your terminal to start."
echo "  Run 'mhs --help' for all commands."
echo ""
echo "  Press any key to close..."
read -n 1 -s
INSTALLER
chmod +x "$STAGE_DIR/Install.command"

# Create uninstaller
cat > "$STAGE_DIR/Uninstall.command" << 'UNINSTALLER'
#!/bin/bash
set -e
echo ""
echo "  Removing MyHealthSpan Agent..."
if [ -w "/usr/local/bin" ]; then
  rm -f /usr/local/bin/mhs
else
  sudo rm -f /usr/local/bin/mhs
fi
echo "  Removed. Goodbye."
echo ""
read -n 1 -s
UNINSTALLER
chmod +x "$STAGE_DIR/Uninstall.command"

# --- Create .dmg ---
echo "[2/4] Creating .dmg..."

# Remove old dmg if it exists
rm -f "$DMG_OUTPUT"

if command -v create-dmg &>/dev/null; then
  echo "  Using create-dmg..."

  create-dmg \
    --volname "$APP_NAME" \
    --volicon "$ICON_FILE" \
    --window-pos 200 120 \
    --window-size 600 400 \
    --icon "Install.command" 150 200 \
    --icon "mhs" 450 200 \
    --hide-extension "Install.command" \
    --no-internet-enable \
    "$DMG_OUTPUT" \
    "$STAGE_DIR/" \
    || {
      # create-dmg returns 2 when it can't set the icon (non-fatal)
      if [ $? -ne 2 ]; then
        echo "ERROR: create-dmg failed"
        exit 1
      fi
    }
else
  echo "  create-dmg not found — using hdiutil..."

  TEMP_DMG="dist/${DMG_NAME}-temp.dmg"

  # Create a temporary read-write DMG
  hdiutil create \
    -srcfolder "$STAGE_DIR" \
    -volname "$APP_NAME" \
    -fs HFS+ \
    -fsargs "-c c=64,a=16,e=16" \
    -format UDRW \
    -size 100m \
    "$TEMP_DMG"

  # Convert to compressed read-only DMG
  hdiutil convert "$TEMP_DMG" \
    -format UDZO \
    -imagekey zlib-level=9 \
    -o "$DMG_OUTPUT"

  rm -f "$TEMP_DMG"
fi

# --- Code signing placeholder ---
echo "[3/4] Code signing..."

# Uncomment these lines when you have an Apple Developer certificate:
#
# IDENTITY="Developer ID Application: XSpan Inc (TEAM_ID)"
#
# codesign --force --sign "$IDENTITY" \
#   --options runtime \
#   --timestamp \
#   "$STAGE_DIR/mhs"
#
# codesign --force --sign "$IDENTITY" \
#   --options runtime \
#   --timestamp \
#   "$DMG_OUTPUT"
#
# # Notarize (required for Gatekeeper on macOS 10.15+)
# xcrun notarytool submit "$DMG_OUTPUT" \
#   --apple-id "engineering@xspan.ai" \
#   --team-id "TEAM_ID" \
#   --password "@keychain:AC_PASSWORD" \
#   --wait
#
# xcrun stapler staple "$DMG_OUTPUT"

echo "  Skipped — no Apple Developer certificate configured."
echo "  See comments in this script for signing instructions."

# --- Done ---
echo "[4/4] Done."
echo ""

DMG_SIZE=$(ls -lh "$DMG_OUTPUT" | awk '{print $5}')
echo "  Output: $DMG_OUTPUT ($DMG_SIZE)"
echo ""

# Cleanup staging
rm -rf "$STAGE_DIR"

echo "================================================"

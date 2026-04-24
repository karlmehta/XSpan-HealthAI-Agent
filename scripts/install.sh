#!/bin/bash
# MyHealthSpan Agent — Quick Installer
# Usage:
#   curl -fsSL https://xspan.ai/install.sh | sh
#
# Installs the MHS Agent binary to /usr/local/bin/mhs
# Supports macOS (ARM64 + Intel) and Linux (x64)

set -euo pipefail

# --- Configuration ---
BASE_URL="https://xspan.ai/download/bin"
INSTALL_DIR="/usr/local/bin"
BIN_NAME="mhs"
VERSION="latest"

# --- Colors ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo ""
echo -e "${CYAN}  ╔═══════════════════════════════════════════╗${NC}"
echo -e "${CYAN}  ║   MyHealthSpan Agent — Installer          ║${NC}"
echo -e "${CYAN}  ║   by XSpan.ai                             ║${NC}"
echo -e "${CYAN}  ╚═══════════════════════════════════════════╝${NC}"
echo ""

# --- Detect platform ---
PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$PLATFORM" in
  darwin) OS="macos" ;;
  linux)  OS="linux" ;;
  mingw*|msys*|cygwin*)
    echo -e "${RED}Windows detected. Please download from https://xspan.ai/download${NC}"
    echo "  Or use: npx @myhealthspan/agent"
    exit 1
    ;;
  *)
    echo -e "${RED}Unsupported platform: $PLATFORM${NC}"
    exit 1
    ;;
esac

case "$ARCH" in
  arm64|aarch64) ARCH_SUFFIX="arm64" ;;
  x86_64|amd64)  ARCH_SUFFIX="x64" ;;
  *)
    echo -e "${RED}Unsupported architecture: $ARCH${NC}"
    exit 1
    ;;
esac

BINARY_NAME="mhs-${OS}-${ARCH_SUFFIX}"
DOWNLOAD_URL="${BASE_URL}/${BINARY_NAME}"

echo -e "  Platform:     ${GREEN}${OS}${NC}"
echo -e "  Architecture: ${GREEN}${ARCH_SUFFIX}${NC}"
echo -e "  Binary:       ${GREEN}${BINARY_NAME}${NC}"
echo -e "  Install to:   ${GREEN}${INSTALL_DIR}/${BIN_NAME}${NC}"
echo ""

# --- Download ---
echo -e "  ${CYAN}Downloading...${NC}"

TMPDIR_DL="$(mktemp -d)"
TMPFILE="${TMPDIR_DL}/${BIN_NAME}"
trap 'rm -rf "$TMPDIR_DL"' EXIT

if command -v curl &>/dev/null; then
  HTTP_CODE=$(curl -fsSL -w "%{http_code}" -o "$TMPFILE" "$DOWNLOAD_URL" 2>/dev/null || echo "000")
elif command -v wget &>/dev/null; then
  wget -q -O "$TMPFILE" "$DOWNLOAD_URL" 2>/dev/null && HTTP_CODE="200" || HTTP_CODE="000"
else
  echo -e "${RED}  Neither curl nor wget found. Install one and retry.${NC}"
  exit 1
fi

if [ "$HTTP_CODE" != "200" ] || [ ! -s "$TMPFILE" ]; then
  echo ""
  echo -e "${YELLOW}  Binary not yet available at ${DOWNLOAD_URL}${NC}"
  echo -e "${YELLOW}  Falling back to npm install...${NC}"
  echo ""
  if command -v npm &>/dev/null; then
    npm install -g @myhealthspan/agent
    echo ""
    echo -e "${GREEN}  Installed via npm. Run: mhs${NC}"
    exit 0
  else
    echo -e "${RED}  npm not found either. Install Node.js 18+ and run:${NC}"
    echo "    npm install -g @myhealthspan/agent"
    exit 1
  fi
fi

# --- Install ---
chmod +x "$TMPFILE"

if [ -w "$INSTALL_DIR" ]; then
  mv "$TMPFILE" "${INSTALL_DIR}/${BIN_NAME}"
else
  echo -e "  ${YELLOW}Requires sudo to install to ${INSTALL_DIR}${NC}"
  sudo mv "$TMPFILE" "${INSTALL_DIR}/${BIN_NAME}"
fi

# --- Verify ---
if command -v "$BIN_NAME" &>/dev/null; then
  echo ""
  echo -e "  ${GREEN}Installed successfully.${NC}"
  echo ""
  echo -e "  Run:  ${CYAN}mhs${NC}           — start the agent"
  echo -e "  Run:  ${CYAN}mhs --help${NC}    — see all commands"
  echo ""
  echo -e "  ${CYAN}xspan.ai${NC} — Your health, quantified."
  echo ""
else
  echo ""
  echo -e "  ${GREEN}Binary installed to ${INSTALL_DIR}/${BIN_NAME}${NC}"
  echo -e "  ${YELLOW}Make sure ${INSTALL_DIR} is in your PATH.${NC}"
  echo ""
fi

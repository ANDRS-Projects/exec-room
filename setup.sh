#!/usr/bin/env bash
set -euo pipefail

# Exec Room — First-time setup
# Usage: ./setup.sh
# Sets up Node dependencies, creates room.config.json from the template, checks prerequisites,
# and offers to start the room.

echo "=== Exec Room Setup ==="
echo ""

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

# Check prerequisites
echo "Checking prerequisites..."

command -v node >/dev/null 2>&1 || {
  echo -e "${RED}Error: Node.js 20+ is required.${NC}"
  echo "Install from: https://nodejs.org"
  exit 1
}
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo -e "${RED}Error: Node.js 20+ is required (found $(node --version)).${NC}"
  echo "Install from: https://nodejs.org"
  exit 1
fi
echo "✓ Node.js $(node --version)"

command -v npm >/dev/null 2>&1 || {
  echo -e "${RED}Error: npm is required (comes with Node.js).${NC}"
  exit 1
}
echo "✓ npm $(npm --version)"

# Python is only needed for the tests (npm test), so the room is set up without it.
if command -v python3 >/dev/null 2>&1; then
  echo "✓ Python 3 $(python3 --version)"
else
  echo "! Python 3 not found. The room runs without it; only the tests (npm test) need it."
  echo "  Install from: https://www.python.org/downloads"
fi

command -v claude >/dev/null 2>&1 || {
  echo -e "${RED}Error: Claude Code CLI is required and must be logged in.${NC}"
  echo "See https://code.claude.com/docs"
  echo 'Then run `claude` once and sign in to your Claude plan.'
  exit 1
}
echo "✓ Claude Code CLI $(claude --version 2>/dev/null || echo "installed")"

echo ""
echo "Installing Node dependencies..."
npm install

echo ""
echo "Configuring room..."

# Create room.config.json from template if it doesn't exist
if [ -f room.config.json ]; then
  echo "✓ room.config.json already exists (skipped)"
else
  cp room.config.example.json room.config.json
  echo "✓ Created room.config.json from template"
fi

echo ""
echo -e "${GREEN}=== Setup complete! ===${NC}"
echo ""
echo "Optional, for Notion:"
echo "  - in the room: Exec Room settings → Popular MCPs → Notion → Set Up → Connect"
echo "  - for saving posts as drafts, add your databases to room.config.json (see README.md)"
echo "  - or, instead of Connect: export ROOM_NOTION_TOKEN=ntn_... before starting the room"
echo ""
echo "Start the room anytime:  npm run room"
echo "Then open http://127.0.0.1:4179 in your browser; stop the room with Ctrl-C."
echo "Run tests anytime:       npm test"
echo ""
echo "Questions? See CLAUDE.md for commands and CONTRIBUTING.md for development."

# Offer to start the room right away, but only when someone is at the terminal (not in a script or CI).
if [ -t 0 ] && [ -t 1 ]; then
  echo ""
  read -r -p "Start the room now? [Y/n] " START || START=n
  case "$START" in
    [nN]*) ;;
    *)
      echo ""
      echo "Starting the room. Stop it with Ctrl-C."
      # exec: the server takes over this terminal, so Ctrl-C goes straight to it.
      exec node room-server.js
      ;;
  esac
fi

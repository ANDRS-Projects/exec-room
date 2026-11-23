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
  echo -e "${RED}Error: Node.js 22+ is required.${NC}"
  echo "Install from: https://nodejs.org"
  exit 1
}
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo -e "${RED}Error: Node.js 22+ is required (found $(node --version)).${NC}"
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

# The work folder: agent runs start there and agents keep their drafts in it. Asked once, only when someone is at the
# terminal; the answer goes into room.config.json as "workFolder". Without one the room keeps using this folder.
# The room itself checks the folder at every start and refuses one it can't use; the checks here only catch the
# common mistakes before any draft is moved.
CURRENT_WORK=$(node -e 'try { const c = JSON.parse(require("fs").readFileSync("room.config.json", "utf8")); if (typeof c.workFolder === "string") process.stdout.write(c.workFolder); } catch {}')
if [ -n "$CURRENT_WORK" ]; then
  echo "✓ Work folder: $CURRENT_WORK (skipped; it is \"workFolder\" in room.config.json)"
elif [ -t 0 ] && [ -t 1 ]; then
  echo ""
  echo "Where should the room keep its work folder? Agents work there and keep their drafts in it. Every agent in"
  echo "every room can read it, so keep it apart from this folder. On a Mac, Documents may be synced to iCloud."
  read -r -p "Work folder [~/Documents/Exec Room]: " WORK || WORK=""
  WORK="${WORK:-~/Documents/Exec Room}"
  WORK_ABS="${WORK/#\~/$HOME}"
  WORK_ABS="${WORK_ABS%/}"
  case "$WORK_ABS" in
    /*) WORK_OK=yes ;;
    *) WORK_OK="give a full path, such as ~/Documents/Exec Room" ;;
  esac
  if [ "$WORK_OK" = yes ]; then
    case "$WORK_ABS/" in
      "$HOME/") WORK_OK="that is your home folder itself" ;;
      "$HOME/Library/"*|"$HOME/."*) WORK_OK="that folder holds settings or keys agents must not read" ;;
      "$PWD/data/"*) WORK_OK="that is inside the room's data folder" ;;
    esac
  fi
  if [ "$WORK_OK" != yes ]; then
    echo -e "${RED}! Not used: $WORK_OK.${NC} The room keeps using this folder; run ./setup.sh again to choose one."
  else
    mkdir -p "$WORK_ABS/drafts"
    node -e 'const fs = require("fs"); const c = JSON.parse(fs.readFileSync("room.config.json", "utf8")); c.workFolder = process.argv[1]; fs.writeFileSync("room.config.json", JSON.stringify(c, null, 2) + "\n");' "$WORK"
    echo "✓ Work folder: $WORK (saved as \"workFolder\" in room.config.json)"
    # Drafts already in this folder: links to them in old chats only open where the room now looks for them.
    OLD=()
    if [ -d drafts ]; then
      for f in drafts/*; do
        [ -f "$f" ] || continue
        git ls-files --error-unmatch "$f" >/dev/null 2>&1 && continue
        OLD+=("$f")
      done
    fi
    if [ "${#OLD[@]}" -gt 0 ]; then
      read -r -p "Move the ${#OLD[@]} drafts in drafts/ there too? [Y/n] " MOVE || MOVE=n
      case "$MOVE" in
        [nN]*) echo "  Left in drafts/. Old chats link to them by name; move them to $WORK/drafts to open them again." ;;
        *)
          MOVED=0
          KEPT=0
          for f in "${OLD[@]}"; do
            if [ -e "$WORK_ABS/drafts/$(basename "$f")" ]; then KEPT=$((KEPT + 1)); else mv "$f" "$WORK_ABS/drafts/" && MOVED=$((MOVED + 1)); fi
          done
          echo "✓ Moved $MOVED drafts to $WORK/drafts"
          if [ "$KEPT" -gt 0 ]; then echo "  $KEPT left in drafts/: a draft with the same name is already there."; fi
          ;;
      esac
    fi
  fi
else
  echo "✓ Work folder: this folder (set \"workFolder\" in room.config.json to move it; see README.md)"
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

#!/usr/bin/env bash
# CCWarriors CLI installer — https://ccwarriors.xyz
#   curl -fsSL https://api.ccwarriors.xyz/install.sh | bash
set -euo pipefail

BASE="${CCWARRIORS_BASE:-https://api.ccwarriors.xyz}"
FALLBACK="${CCWARRIORS_FALLBACK:-https://get.ccwarriors.xyz}"
CCW_HOME="${CCWARRIORS_HOME:-$HOME/.ccwarriors}"
BIN_NAME="ccwarriors"

say() { printf '%s\n' "$*"; }

# Anonymous install telemetry (no personal data: random id, OS, failing step).
# Opt out with CCWARRIORS_TELEMETRY=0.
TID="$(date +%s)$$${RANDOM}"
STEP="start"
beacon() {
  [ "${CCWARRIORS_TELEMETRY:-1}" = "0" ] && return 0
  curl -m 4 -fsS -o /dev/null -X POST "$BASE/telemetry" \
    -H 'content-type: application/json' \
    -d "{\"event\":\"$1\",\"distinctId\":\"$TID\",\"props\":{\"os\":\"$(uname -s)\",\"step\":\"$STEP\"}}" \
    >/dev/null 2>&1 || true
}
trap 'rc=$?; if [ "$rc" -ne 0 ]; then beacon install_failed; fi' EXIT
beacon install_started

# 1) Node.js 20+ is required (the CLI is a single-file Node script)
# Distinct step names so telemetry shows WHICH node problem failed the install.
STEP="node_missing"
if ! command -v node >/dev/null 2>&1; then
  say "✗ Node.js 20+ is required. Install it from https://nodejs.org and re-run."
  exit 1
fi
STEP="node_old"
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  say "✗ Node.js 20+ required (found $(node -v))."
  say "  Upgrade with:  nvm install 20   (or: brew upgrade node)"
  say "  Then re-run this installer."
  exit 1
fi

# 2) Download the CLI bundle
STEP="download"
mkdir -p "$CCW_HOME/bin"
say "⚔  Downloading the CCWarriors CLI…"
if ! curl -fsSL "$BASE/cli.js" -o "$CCW_HOME/cli.js"; then
  say "… primary host unavailable, using fallback"
  curl -fsSL "$FALLBACK/cli.js" -o "$CCW_HOME/cli.js"
fi

# 3) Wrapper executable
STEP="wrapper"
cat > "$CCW_HOME/bin/$BIN_NAME" <<WRAP
#!/usr/bin/env bash
exec node "$CCW_HOME/cli.js" "\$@"
WRAP
chmod +x "$CCW_HOME/bin/$BIN_NAME"

# 4) Put it on PATH (best effort)
mkdir -p "$HOME/.local/bin"
ln -sf "$CCW_HOME/bin/$BIN_NAME" "$HOME/.local/bin/$BIN_NAME"
say "✓ Installed: $CCW_HOME/bin/$BIN_NAME"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) say "✓ '$BIN_NAME' is on your PATH" ;;
  *) say "→ Add to your shell profile:  export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac
beacon install_completed

# 5) Enlist now (skippable with CCWARRIORS_NO_RUN=1)
STEP="enlist"
if [ -z "${CCWARRIORS_NO_RUN:-}" ]; then
  say ""
  say "⚔  Hey there — installed! Starting your enlistment…"
  "$CCW_HOME/bin/$BIN_NAME"
  if "$CCW_HOME/bin/$BIN_NAME" autosync on >/dev/null 2>&1; then
    say "✓ Background sync enabled — your usage streams to the board automatically."
    say "  (no terminal needed · disable anytime: ccwarriors autosync off)"
  fi
fi

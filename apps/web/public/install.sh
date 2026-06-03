#!/usr/bin/env bash
# CCWarriors CLI installer — https://ccwarriors.xyz
#   curl -fsSL https://ccwarriors.xyz/install.sh | bash
set -euo pipefail

BASE="${CCWARRIORS_BASE:-https://ccwarriors.xyz}"
CCW_HOME="${CCWARRIORS_HOME:-$HOME/.ccwarriors}"
BIN_NAME="ccwarriors"

say() { printf '%s\n' "$*"; }

# 1) Node.js 20+ is required (the CLI is a single-file Node script)
if ! command -v node >/dev/null 2>&1; then
  say "✗ Node.js 20+ is required. Install it from https://nodejs.org and re-run."
  exit 1
fi
NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
if [ "$NODE_MAJOR" -lt 20 ]; then
  say "✗ Node.js 20+ required (found $(node -v))."
  exit 1
fi

# 2) Download the CLI bundle
mkdir -p "$CCW_HOME/bin"
say "⚔  Downloading the CCWarriors CLI…"
curl -fsSL "$BASE/cli.js" -o "$CCW_HOME/cli.js"

# 3) Wrapper executable
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

# 5) Enlist now (skippable with CCWARRIORS_NO_RUN=1)
if [ -z "${CCWARRIORS_NO_RUN:-}" ]; then
  say ""
  say "⚔  Enlisting — your browser will open for GitHub login…"
  exec "$CCW_HOME/bin/$BIN_NAME"
fi

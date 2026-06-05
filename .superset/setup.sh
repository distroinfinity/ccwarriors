#!/usr/bin/env bash
# Runs once when Superset creates a worktree of this repository.
#
# Provided by Superset:
#   SUPERSET_ROOT_PATH       absolute path to the main repository
#   SUPERSET_WORKSPACE_NAME  this worktree's name
#   SUPERSET_WORKSPACE_PATH  this worktree's absolute path
#
# What a fresh ccwarriors worktree needs:
#   1. local secrets copied over (apps/server/.env etc. are gitignored)
#   2. pnpm install (node_modules never follows a worktree)
#   3. the CLI bundle built (server tests + the /cli.js route read
#      packages/cli/dist/cli.js, and the web prebuild copies it)
#   4. its own server port, so `pnpm dev` in two worktrees doesn't collide
#      (the web port self-bumps — vite auto-increments when 5173 is busy)

# No `-e`: individual steps track their own failures via step_failed and
# the summary banner surfaces which ones failed.
set -uo pipefail

SUPERSET_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SUPERSET_SCRIPT_DIR/lib/common.sh"

: "${SUPERSET_ROOT_PATH:?must be set (run via Superset)}"
: "${SUPERSET_WORKSPACE_NAME:?must be set (run via Superset)}"
: "${SUPERSET_WORKSPACE_PATH:?must be set (run via Superset)}"

cd "$SUPERSET_WORKSPACE_PATH"

# ── Step implementations ──────────────────────────────────────────────

step_check_dependencies() {
  echo "🔍 Checking dependencies..."
  local missing=()

  command -v git  >/dev/null 2>&1 || missing+=("git")
  command -v pnpm >/dev/null 2>&1 || missing+=("pnpm (run: corepack enable)")
  command -v jq   >/dev/null 2>&1 || missing+=("jq (run: brew install jq) — needed for the port registry")
  command -v node >/dev/null 2>&1 || missing+=("node 20+")

  if command -v node >/dev/null 2>&1; then
    local major
    major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
    [ "$major" -ge 20 ] || missing+=("node 20+ (found $(node --version))")
  fi

  if [ ${#missing[@]} -gt 0 ]; then
    error "Missing dependencies:"
    for dep in "${missing[@]}"; do echo "  - $dep"; done
    return 1
  fi
  success "All dependencies found"
  return 0
}

# Git worktrees only contain committed files; surface the classic
# "nothing committed yet" failure up-front instead of deep inside pnpm.
step_check_worktree_files() {
  echo "📁 Checking worktree contents..."
  if [ ! -f "package.json" ] || [ ! -f "pnpm-workspace.yaml" ]; then
    error "Workspace manifests missing in this worktree."
    echo "  Git worktrees only contain committed files. If files in the main"
    echo "  workspace are still untracked, they won't appear here."
    return 1
  fi
  success "Worktree has expected files"
  return 0
}

# Copy gitignored local files from the main workspace. Copying (not
# symlinking) lets each worktree diverge safely. Missing sources are
# skipped silently so this works on machines without them.
step_copy_local_files() {
  echo "📂 Copying local (gitignored) files from main workspace..."
  local copied=0

  copy_local_file() {
    local relative_path="$1"
    local source_path="$SUPERSET_ROOT_PATH/$relative_path"
    local destination_path="$SUPERSET_WORKSPACE_PATH/$relative_path"
    if [ -f "$source_path" ] && [ ! -f "$destination_path" ]; then
      mkdir -p "$(dirname "$destination_path")"
      cp "$source_path" "$destination_path"
      echo "  copied $relative_path"
      copied=$((copied + 1))
    fi
  }

  copy_local_dir() {
    local relative_path="$1"
    local source_path="$SUPERSET_ROOT_PATH/$relative_path"
    local destination_path="$SUPERSET_WORKSPACE_PATH/$relative_path"
    if [ -d "$source_path" ] && [ ! -d "$destination_path" ]; then
      cp -R "$source_path" "$destination_path"
      echo "  copied $relative_path/"
      copied=$((copied + 1))
    fi
  }

  copy_local_file "apps/server/.env"      # GitHub OAuth + PostHog secrets
  copy_local_file "apps/web/.env"         # local VITE_* overrides (if any)
  copy_local_file "apps/web/.env.local"
  copy_local_dir  ".vercel"               # Vercel project link (vercel CLI)
  # Add new entries here as apps gain their own gitignored local files.

  if [ "$copied" -eq 0 ]; then
    success "Nothing to copy (no local files in main workspace yet)"
  else
    success "Copied $copied local file(s)/dir(s)"
  fi
  return 0
}

step_install_dependencies() {
  echo "📥 Installing dependencies (pnpm install)..."
  if ! pnpm install; then
    error "pnpm install failed"
    return 1
  fi
  success "Dependencies installed"
  return 0
}

# packages/cli/dist/cli.js is gitignored build output, but the server's
# installer route and its tests read it, and the web prebuild copies it.
# Build it once so `pnpm verify` and `pnpm dev` work immediately.
step_build_cli() {
  echo "🔨 Building the CLI bundle (packages/cli/dist/cli.js)..."
  if ! pnpm --filter claude-warriors build; then
    error "CLI build failed"
    return 1
  fi
  success "CLI bundle built"
  return 0
}

# Claim a port offset (race-safe via lock) and point this worktree's
# server + web at it. The main workspace keeps the defaults (8787/5173).
# Only the server port needs allocating — the API server hard-fails on
# EADDRINUSE, while vite auto-increments its port when 5173 is busy.
step_allocate_ports() {
  echo "🔌 Allocating per-worktree server port..."
  local port_offset
  if ! port_offset=$(allocate_port_offset "$SUPERSET_WORKSPACE_NAME"); then
    error "Port allocation failed"
    return 1
  fi

  local server_port=$((8787 + port_offset))

  # Server reads PORT from .env (tsx --env-file-if-exists). Shell-exported
  # PORT still wins over the file if you need a one-off override.
  set_env_variable "apps/server/.env" "PORT" "$server_port"
  # Web must dial THIS worktree's server, not the default 8787.
  set_env_variable "apps/web/.env" "VITE_WS_URL" "ws://localhost:$server_port"

  success "Assigned offset $port_offset (server=$server_port, web=vite auto)"
  return 0
}

# ── Orchestration ─────────────────────────────────────────────────────

FAILED_STEPS=()
SKIPPED_STEPS=()

echo "🚀 Setting up worktree '$SUPERSET_WORKSPACE_NAME'..."
echo ""

if ! step_check_dependencies;   then step_failed "Check dependencies"; fi
if ! step_check_worktree_files; then step_failed "Check worktree contents"; fi
if ! step_copy_local_files;     then step_failed "Copy local files"; fi
if ! step_install_dependencies; then step_failed "Install dependencies"; fi
if ! step_build_cli;            then step_failed "Build CLI bundle"; fi
if ! step_allocate_ports;       then step_failed "Allocate ports"; fi

if ! print_summary "Setup"; then
  exit 1
fi

server_port_display=$(read_env_variable "apps/server/.env" "PORT")
echo ""
echo "Workspace '$SUPERSET_WORKSPACE_NAME' ready."
[ -n "$server_port_display" ] && echo "  api: http://localhost:$server_port_display  (seeded demo board via 'pnpm dev')"
echo "  web: vite picks a free port (watch its output)"
echo ""
echo "  pnpm dev          # server + web together"
echo "  pnpm verify       # tests + typecheck + build"
echo "  cd $SUPERSET_WORKSPACE_PATH"

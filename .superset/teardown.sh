#!/usr/bin/env bash
# Runs when Superset deletes this worktree.
# Must be idempotent — may run on a partially-set-up worktree.

set -uo pipefail

SUPERSET_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=/dev/null
source "$SUPERSET_SCRIPT_DIR/lib/common.sh"

# Superset provides SUPERSET_WORKSPACE_NAME during teardown. It does not
# reliably provide SUPERSET_WORKSPACE_PATH — the worktree may already be
# gone — so the port registry is keyed by name (matching setup.sh).
: "${SUPERSET_WORKSPACE_NAME:?must be set (run via Superset)}"

# ── Step implementations ──────────────────────────────────────────────

step_deallocate_ports() {
  echo "🔌 Releasing port allocation..."
  if ! deallocate_port_offset "$SUPERSET_WORKSPACE_NAME"; then
    error "Port deallocation failed"
    return 1
  fi
  success "Port slot released"
  return 0
}

# ── Orchestration ─────────────────────────────────────────────────────

FAILED_STEPS=()
SKIPPED_STEPS=()

echo "🧹 Tearing down worktree '$SUPERSET_WORKSPACE_NAME'..."
echo ""

if ! step_deallocate_ports; then step_failed "Deallocate ports"; fi

if ! print_summary "Teardown"; then
  exit 1
fi

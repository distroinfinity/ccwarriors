# Shared helpers for .superset/setup.sh and .superset/teardown.sh.
# Sourced — not executed.
#
# Patterns adopted from superset-sh/superset's .superset/lib/common.sh
# (same lib the dodge-platform repos use) and adapted for this repository.

# ── Colors & logging ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

# Print an error-styled line. Does not abort — callers decide.
error()   { echo -e "${RED}✗${NC} $1"; }
# Print a success-styled line.
success() { echo -e "${GREEN}✓${NC} $1"; }
# Print a warn-styled line.
warn()    { echo -e "${YELLOW}!${NC} $1"; }

# ── Step outcome tracking ─────────────────────────────────────────────
# Callers must initialise before any step runs:
#   FAILED_STEPS=()
#   SKIPPED_STEPS=()

step_failed()  { FAILED_STEPS+=("$1"); }
step_skipped() { SKIPPED_STEPS+=("$1"); }

# Print the final summary banner. Returns non-zero iff any step failed.
print_summary() {
  local title="$1"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "📊 ${title} Summary"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if [ ${#FAILED_STEPS[@]} -eq 0 ] && [ ${#SKIPPED_STEPS[@]} -eq 0 ]; then
    echo -e "${GREEN}All steps completed.${NC}"
  else
    if [ ${#SKIPPED_STEPS[@]} -gt 0 ]; then
      echo -e "${YELLOW}Skipped steps:${NC}"
      for step in "${SKIPPED_STEPS[@]}"; do echo "  - $step"; done
    fi
    if [ ${#FAILED_STEPS[@]} -gt 0 ]; then
      echo -e "${RED}Failed steps:${NC}"
      for step in "${FAILED_STEPS[@]}"; do echo "  - $step"; done
    fi
  fi
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  [ ${#FAILED_STEPS[@]} -eq 0 ]
}

# ── Env file helpers ──────────────────────────────────────────────────

# Escape a value for embedding inside KEY="value" in a .env file.
escape_env_value() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//\$/\\$}"
  value="${value//\`/\\\`}"
  value="${value//$'\n'/\\n}"
  printf '%s' "$value"
}

# Set or replace KEY="value" in a .env file. Creates the file if missing.
# Every other line is preserved, so secrets copied from the main
# workspace survive overrides.
set_env_variable() {
  local env_file="$1" key="$2" value="$3"
  mkdir -p "$(dirname "$env_file")"
  touch "$env_file"
  local tmp_file
  tmp_file="$(mktemp)"
  grep -v "^${key}=" "$env_file" > "$tmp_file" || true
  printf '%s="%s"\n' "$key" "$(escape_env_value "$value")" >> "$tmp_file"
  mv "$tmp_file" "$env_file"
}

# Read the value of KEY from a .env file, stripping one pair of
# surrounding double quotes. Prints the value (or empty) to stdout.
read_env_variable() {
  local env_file="$1" key="$2"
  [ -f "$env_file" ] || return 0
  local raw
  raw=$(grep -E "^${key}=" "$env_file" | head -n 1 | cut -d= -f2- || true)
  if [[ "$raw" == \"*\" ]]; then
    raw="${raw#\"}"
    raw="${raw%\"}"
  fi
  printf '%s' "$raw"
}

# ── Filesystem lock ───────────────────────────────────────────────────
# Directory-based atomic lock: mkdir is atomic on POSIX filesystems.
# Stale locks are reclaimed when the recorded PID is dead or the lock
# is older than stale_seconds.

acquire_lock() {
  local lock_dir="$1"
  local timeout_seconds="${2:-30}"
  local stale_seconds="${3:-300}"
  local waited=0

  while ! mkdir "$lock_dir" 2>/dev/null; do
    local reclaimed=false

    local lock_pid_file="$lock_dir/pid"
    if [ -f "$lock_pid_file" ]; then
      local lock_pid
      lock_pid="$(cat "$lock_pid_file" 2>/dev/null || true)"
      if [ -n "$lock_pid" ] && ! kill -0 "$lock_pid" 2>/dev/null; then
        warn "Reclaiming stale lock (dead PID $lock_pid): $lock_dir"
        rm -rf "$lock_dir" 2>/dev/null || true
        reclaimed=true
      fi
    fi

    if [ "$reclaimed" = false ]; then
      local lock_mtime
      lock_mtime=$(stat -f %m "$lock_dir" 2>/dev/null \
                || stat -c %Y "$lock_dir" 2>/dev/null \
                || true)
      if [ -n "$lock_mtime" ]; then
        local now
        now=$(date +%s)
        if [ $((now - lock_mtime)) -ge "$stale_seconds" ]; then
          warn "Reclaiming stale lock (>${stale_seconds}s old): $lock_dir"
          rm -rf "$lock_dir" 2>/dev/null || true
          reclaimed=true
        fi
      fi
    fi

    if [ "$reclaimed" = true ]; then continue; fi

    if [ "$waited" -ge "$timeout_seconds" ]; then
      error "Timed out waiting for lock: $lock_dir"
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done

  printf '%s\n' "$$" > "$lock_dir/pid" 2>/dev/null || true
  return 0
}

release_lock() {
  rm -rf "$1" 2>/dev/null || true
}

# ── Port registry ─────────────────────────────────────────────────────
# Central JSON file mapping worktree names to N*10 port offsets. Lives
# under ~/.superset/state (NOT ~/.ccwarriors or ~/.claude-warriors —
# those belong to the production CLI) so it survives worktree deletion.
# Lock-guarded so parallel setups don't race on slot assignment.
CCW_STATE_DIR="$HOME/.superset/state/claude-warriors"
PORT_REGISTRY_FILE="$CCW_STATE_DIR/port-allocations.json"
PORT_REGISTRY_LOCK="$CCW_STATE_DIR/port-allocations.lock"

# Assign or reuse a port offset for $1 (the workspace name). Offsets are
# multiples of 10 in [10, 990]; the main workspace keeps the defaults
# (server 8787, web 5173) and is never registered. Idempotent.
allocate_port_offset() {
  local workspace_key="$1"

  mkdir -p "$CCW_STATE_DIR"
  [ -f "$PORT_REGISTRY_FILE" ] || echo '{}' > "$PORT_REGISTRY_FILE"

  acquire_lock "$PORT_REGISTRY_LOCK" 30 300 || return 1

  local existing
  if ! existing=$(jq -r --arg k "$workspace_key" '.[$k] // empty' "$PORT_REGISTRY_FILE" 2>/dev/null); then
    error "Failed to read $PORT_REGISTRY_FILE"
    release_lock "$PORT_REGISTRY_LOCK"
    return 1
  fi
  if [ -n "$existing" ]; then
    printf '%s' "$existing"
    release_lock "$PORT_REGISTRY_LOCK"
    return 0
  fi

  local used
  if ! used=$(jq -r '[.[]] | sort | .[]' "$PORT_REGISTRY_FILE" 2>/dev/null); then
    error "Failed to parse $PORT_REGISTRY_FILE"
    release_lock "$PORT_REGISTRY_LOCK"
    return 1
  fi

  local candidate=10
  while [ "$candidate" -le 990 ]; do
    if ! echo "$used" | grep -qx "$candidate"; then
      break
    fi
    candidate=$((candidate + 10))
  done
  if [ "$candidate" -gt 990 ]; then
    error "No free port offset in 10..990"
    release_lock "$PORT_REGISTRY_LOCK"
    return 1
  fi

  local tmp_file="${PORT_REGISTRY_FILE}.tmp.$$"
  if ! jq --arg k "$workspace_key" --argjson v "$candidate" \
        '. + {($k): $v}' "$PORT_REGISTRY_FILE" > "$tmp_file"; then
    error "Failed to update $PORT_REGISTRY_FILE"
    rm -f "$tmp_file"
    release_lock "$PORT_REGISTRY_LOCK"
    return 1
  fi
  if ! mv "$tmp_file" "$PORT_REGISTRY_FILE"; then
    error "Failed to persist $PORT_REGISTRY_FILE"
    rm -f "$tmp_file"
    release_lock "$PORT_REGISTRY_LOCK"
    return 1
  fi

  printf '%s' "$candidate"
  release_lock "$PORT_REGISTRY_LOCK"
  return 0
}

# Release the port offset for $1. Idempotent.
deallocate_port_offset() {
  local workspace_key="$1"
  [ -f "$PORT_REGISTRY_FILE" ] || return 0

  acquire_lock "$PORT_REGISTRY_LOCK" 30 300 || return 1

  local tmp_file="${PORT_REGISTRY_FILE}.tmp.$$"
  if ! jq --arg k "$workspace_key" 'del(.[$k])' "$PORT_REGISTRY_FILE" > "$tmp_file"; then
    error "Failed to update $PORT_REGISTRY_FILE"
    rm -f "$tmp_file"
    release_lock "$PORT_REGISTRY_LOCK"
    return 1
  fi
  if ! mv "$tmp_file" "$PORT_REGISTRY_FILE"; then
    error "Failed to persist $PORT_REGISTRY_FILE"
    rm -f "$tmp_file"
    release_lock "$PORT_REGISTRY_LOCK"
    return 1
  fi

  release_lock "$PORT_REGISTRY_LOCK"
  return 0
}

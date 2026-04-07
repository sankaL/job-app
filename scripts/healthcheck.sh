#!/bin/sh
set -eu

ENV_FILE="${1:-.env.compose}"

load_env_value() {
  key="$1"
  file="$2"
  value="$(awk -F= -v search_key="$key" '$1 == search_key {sub(/^[^=]*=/, "", $0); print $0}' "$file" | tail -n 1)"
  value="${value%\"}"
  value="${value#\"}"
  printf '%s' "$value"
}

if [ -f "$ENV_FILE" ]; then
  SUPABASE_URL="$(load_env_value SUPABASE_URL "$ENV_FILE")"
  API_URL="$(load_env_value API_URL "$ENV_FILE")"
  APP_URL="$(load_env_value APP_URL "$ENV_FILE")"
fi

check() {
  url="$1"
  name="$2"
  if curl -fsS "$url" >/dev/null; then
    echo "$name: ok"
  else
    echo "$name: failed"
    exit 1
  fi
}

check "${SUPABASE_URL:-http://localhost:54421}/auth/v1/health" "supabase-auth"
check "${API_URL:-http://localhost:54800}/healthz" "backend"
check "${APP_URL:-http://localhost:5173}" "frontend"

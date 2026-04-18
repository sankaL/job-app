#!/bin/sh

set -eu

PORT_VALUE="${PORT:-80}"
NGINX_TEMPLATE="/etc/nginx/templates/default.conf.template"
NGINX_CONFIG="/etc/nginx/conf.d/default.conf"
ENV_CONFIG="/usr/share/nginx/html/env-config.js"
ENV_CONFIG_ENTRY_COUNT=0

escape_js_string() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

append_runtime_config() {
  key="$1"
  value="${2:-}"

  if [ -z "$value" ]; then
    return
  fi

  if [ "$ENV_CONFIG_ENTRY_COUNT" -gt 0 ]; then
    printf ',\n  %s: "%s"' "$key" "$(escape_js_string "$value")" >> "$ENV_CONFIG"
  else
    printf '\n  %s: "%s"' "$key" "$(escape_js_string "$value")" >> "$ENV_CONFIG"
  fi

  ENV_CONFIG_ENTRY_COUNT=$((ENV_CONFIG_ENTRY_COUNT + 1))
}

cat > "$ENV_CONFIG" <<'EOF'
window.__APP_CONFIG__ = Object.assign({}, window.__APP_CONFIG__, {
EOF

append_runtime_config "VITE_APP_ENV" "${VITE_APP_ENV:-}"
append_runtime_config "VITE_APP_DEV_MODE" "${VITE_APP_DEV_MODE:-}"
append_runtime_config "VITE_SUPABASE_URL" "${VITE_SUPABASE_URL:-}"
append_runtime_config "VITE_SUPABASE_ANON_KEY" "${VITE_SUPABASE_ANON_KEY:-}"
append_runtime_config "VITE_API_URL" "${VITE_API_URL:-}"

printf '\n});\n' >> "$ENV_CONFIG"

sed "s/__PORT__/${PORT_VALUE}/g" "$NGINX_TEMPLATE" > "$NGINX_CONFIG"

exec nginx -g 'daemon off;'

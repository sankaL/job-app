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
  SERVICE_ROLE_KEY="$(load_env_value SERVICE_ROLE_KEY "$ENV_FILE")"
  LOCAL_DEV_USER_EMAIL="$(load_env_value LOCAL_DEV_USER_EMAIL "$ENV_FILE")"
  LOCAL_DEV_USER_PASSWORD="$(load_env_value LOCAL_DEV_USER_PASSWORD "$ENV_FILE")"
fi

SUPABASE_URL="${SUPABASE_URL:-http://localhost:54421}"
SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY is required}"
EMAIL="${LOCAL_DEV_USER_EMAIL:?LOCAL_DEV_USER_EMAIL is required}"
PASSWORD="${LOCAL_DEV_USER_PASSWORD:?LOCAL_DEV_USER_PASSWORD is required}"

payload=$(printf '{"email":"%s","password":"%s","email_confirm":true}' "$EMAIL" "$PASSWORD")

attempts=0
until curl -fsS "${SUPABASE_URL}/auth/v1/health" >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 30 ]; then
    echo "Supabase auth gateway did not become ready in time."
    exit 1
  fi
  sleep 2
done

status_code="$(
  curl -sS -o /tmp/seed-local-user-response.json -w '%{http_code}' \
    -X POST "${SUPABASE_URL}/auth/v1/admin/users" \
    -H "apikey: ${SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SERVICE_ROLE_KEY}" \
    -H "Content-Type: application/json" \
    -d "$payload"
)"

case "$status_code" in
  200|201)
    echo "Created local invited user ${EMAIL}"
    ;;
  422)
    echo "Local invited user ${EMAIL} already exists"
    ;;
  *)
    echo "Failed to create local invited user ${EMAIL} (status ${status_code})"
    cat /tmp/seed-local-user-response.json
    exit 1
    ;;
esac

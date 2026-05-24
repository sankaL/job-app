#!/bin/bash
set -euo pipefail

ENV_FILE="${1:-.env.compose}"

PREFERRED_FRONTEND_PORT="${PREFERRED_FRONTEND_PORT:-5173}"
PREFERRED_BACKEND_PORT="${PREFERRED_BACKEND_PORT:-54800}"
PREFERRED_POSTGRES_PORT="${PREFERRED_POSTGRES_PORT:-5432}"
PREFERRED_REDIS_PORT="${PREFERRED_REDIS_PORT:-6379}"

find_free_port() {
    python3 -c "import socket; s=socket.socket(); s.bind(('',0)); print(s.getsockname()[1]); s.close()" 2>/dev/null
}

port_in_use() {
    local port="$1"
    lsof -iTCP:"$port" -sTCP:LISTEN -P -n >/dev/null 2>&1
}

read_env_port() {
    local key="$1"
    local file="$2"
    local value
    value="$(awk -F= -v search_key="$key" '$1 == search_key {sub(/^[^=]*=/, "", $0); print $0}' "$file" | tail -n 1)"
    value="${value%\"}"
    value="${value#\"}"
    printf '%s' "$value"
}

get_port() {
    local preferred="$1"
    local env_key="$2"

    # Try preferred port first
    if ! port_in_use "$preferred"; then
        printf '%s' "$preferred"
        return
    fi

    # Try the port currently saved in .env.compose (may differ from preferred)
    local current
    current="$(read_env_port "$env_key" "$ENV_FILE")"
    if [ -n "$current" ] && [ "$current" != "$preferred" ] && ! port_in_use "$current"; then
        printf '%s' "$current"
        return
    fi

    # Find a new free port
    echo "Port $preferred is in use, finding alternative..." >&2
    local port
    port=$(find_free_port)
    while [ -z "$port" ] || port_in_use "$port"; do
        port=$(find_free_port)
    done
    printf '%s' "$port"
}

update_env_line() {
    local key="$1"
    local value="$2"
    local file="$3"
    if grep -q "^${key}=" "$file"; then
        sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
        rm -f "${file}.bak"
    else
        echo "${key}=${value}" >> "$file"
    fi
}

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found. Run 'make ensure-env' first." >&2
    exit 1
fi

FRONTEND_PORT=$(get_port "$PREFERRED_FRONTEND_PORT" "FRONTEND_PORT")
BACKEND_HOST_PORT=$(get_port "$PREFERRED_BACKEND_PORT" "BACKEND_HOST_PORT")
POSTGRES_HOST_PORT=$(get_port "$PREFERRED_POSTGRES_PORT" "POSTGRES_HOST_PORT")
REDIS_HOST_PORT=$(get_port "$PREFERRED_REDIS_PORT" "REDIS_HOST_PORT")

update_env_line FRONTEND_PORT "$FRONTEND_PORT" "$ENV_FILE"
update_env_line BACKEND_HOST_PORT "$BACKEND_HOST_PORT" "$ENV_FILE"
update_env_line POSTGRES_HOST_PORT "$POSTGRES_HOST_PORT" "$ENV_FILE"
update_env_line REDIS_HOST_PORT "$REDIS_HOST_PORT" "$ENV_FILE"
update_env_line APP_URL "http://localhost:${FRONTEND_PORT}" "$ENV_FILE"
update_env_line API_URL "http://localhost:${BACKEND_HOST_PORT}" "$ENV_FILE"

echo "Ports assigned:"
echo "  Frontend : ${FRONTEND_PORT}"
echo "  Backend  : ${BACKEND_HOST_PORT}"
echo "  Postgres : ${POSTGRES_HOST_PORT}"
echo "  Redis    : ${REDIS_HOST_PORT}"
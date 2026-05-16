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
  POSTGRES_PASSWORD="$(load_env_value POSTGRES_PASSWORD "$ENV_FILE")"
  LOCAL_DEV_USER_EMAIL="$(load_env_value LOCAL_DEV_USER_EMAIL "$ENV_FILE")"
  LOCAL_DEV_USER_PASSWORD="$(load_env_value LOCAL_DEV_USER_PASSWORD "$ENV_FILE")"
  LOCAL_DEV_USER_IS_ADMIN="$(load_env_value LOCAL_DEV_USER_IS_ADMIN "$ENV_FILE")"
fi

POSTGRES_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
EMAIL="${LOCAL_DEV_USER_EMAIL:?LOCAL_DEV_USER_EMAIL is required}"
PASSWORD="${LOCAL_DEV_USER_PASSWORD:?LOCAL_DEV_USER_PASSWORD is required}"
LOCAL_DEV_USER_IS_ADMIN="${LOCAL_DEV_USER_IS_ADMIN:-true}"

CONTAINER="${POSTGRES_CONTAINER:-resume-builder-postgres-1}"
export PGPASSWORD="$POSTGRES_PASSWORD"

# Wait for postgres to be ready
attempts=0
until docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 30 ]; then
    echo "Postgres did not become ready in time."
    exit 1
  fi
  sleep 2
done

run_sql() {
  docker exec -i -e PGPASSWORD="$POSTGRES_PASSWORD" "$CONTAINER" psql -U postgres -d postgres -q "$@"
}

# Generate bcrypt hash using Python
HASH=$(python3 -c "
from passlib.hash import bcrypt
print(bcrypt.hash('${PASSWORD}'))
" 2>/dev/null) || {
  echo "Unable to generate password hash. Ensure passlib[bcrypt] is installed."
  exit 1
}

# Check if user exists
USER_ID=$(echo "select id::text from public.users where email = '${EMAIL}';" | run_sql -tA 2>/dev/null || true)

if [ -z "$USER_ID" ]; then
  # Create user with password hash directly
  USER_ID=$(echo "
    insert into public.users (email, password_hash)
    values ('${EMAIL}', '${HASH}')
    returning id::text;
  " | run_sql -tA)

  echo "Created local invited user ${EMAIL} (id: ${USER_ID})"
else
  echo "Local user ${EMAIL} already exists (id: ${USER_ID})"
fi

# Ensure profile exists
echo "
  insert into public.profiles (id, email)
  values ('${USER_ID}', '${EMAIL}')
  on conflict (id) do update set email = excluded.email;
" | run_sql >/dev/null 2>&1 || true

# Mark as admin if needed
if [ "$LOCAL_DEV_USER_IS_ADMIN" = "true" ]; then
  echo "update public.profiles set is_admin = true where id = '${USER_ID}';" | run_sql
  echo "Ensured local user ${EMAIL} is admin"
fi

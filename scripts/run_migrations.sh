#!/bin/sh
set -eu

DB_HOST="${POSTGRES_HOST:-supabase-db}"
DB_PORT="${POSTGRES_PORT:-5432}"
DB_NAME="${POSTGRES_DB:-postgres}"
DB_USER="${POSTGRES_USER:-postgres}"
DB_PASSWORD="${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
MIGRATION_DIR="/workspace/migrations"

export PGPASSWORD="$DB_PASSWORD"

until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" >/dev/null 2>&1; do
  echo "Waiting for database..."
  sleep 2
done

psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<'SQL'
create schema if not exists app_meta;
create table if not exists app_meta.schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);
SQL

for file in $(find "$MIGRATION_DIR" -maxdepth 1 -name '*.sql' | sort); do
  version="$(basename "$file")"
  applied="$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -tAc "select 1 from app_meta.schema_migrations where version = '$version'")"

  if [ "$applied" = "1" ]; then
    echo "Skipping already applied migration: $version"
    continue
  fi

  echo "Applying migration: $version"
  psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$file"
  psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "insert into app_meta.schema_migrations (version) values ('$version')"
done

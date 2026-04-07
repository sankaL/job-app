#!/bin/sh
set -eu

sed \
  -e "s|\$SUPABASE_ANON_KEY|${SUPABASE_ANON_KEY}|g" \
  -e "s|\$SUPABASE_SERVICE_KEY|${SUPABASE_SERVICE_KEY}|g" \
  /workspace/kong.yml > /usr/local/kong/kong.yml

exec /entrypoint.sh kong docker-start

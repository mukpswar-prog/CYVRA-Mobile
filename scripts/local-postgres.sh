#!/usr/bin/env bash
#
# Local Postgres lifecycle for the CYVRA Mobile dev environment.
#
# This cluster is a LOCAL STAND-IN for Neon project floral-art-02749206 so the
# Worker + web slice can run end-to-end without cloud credentials. It never
# touches any real Neon/Cloudflare/Resend resource.
#
# Usage: local-postgres.sh {install|start|status}
#   install  Ensure the postgresql server package is present (idempotent).
#   start    Init the cluster if needed, start it, and ensure role + database.
#   status   Print whether the cluster is accepting connections.
set -euo pipefail

PGDATA="${CYVRA_PGDATA:-$HOME/.cyvra-pgdata}"
PGPORT="${CYVRA_PGPORT:-5432}"
PGROLE="${CYVRA_PGROLE:-cyvra}"
PGPASSWORD_LOCAL="${CYVRA_PGPASSWORD:-cyvra}"
PGDATABASE_LOCAL="${CYVRA_PGDATABASE:-cyvra_mobile}"
LOGFILE="$PGDATA/postgres.log"

find_pgbin() {
  local bin
  bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  if [ -z "$bin" ]; then
    echo "" && return 1
  fi
  echo "$bin"
}

cmd_install() {
  if command -v psql >/dev/null 2>&1 && find_pgbin >/dev/null 2>&1; then
    echo "[pg] postgresql already installed"
    return 0
  fi
  echo "[pg] installing postgresql..."
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq postgresql postgresql-client
}

cmd_start() {
  local PGBIN
  PGBIN="$(find_pgbin)" || { echo "[pg] postgres not installed; run install first" >&2; exit 1; }

  if [ ! -f "$PGDATA/PG_VERSION" ]; then
    echo "[pg] initializing cluster at $PGDATA"
    mkdir -p "$PGDATA"
    "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust --auth-host=trust >/dev/null
    {
      echo "listen_addresses = 'localhost'"
      echo "port = $PGPORT"
      echo "unix_socket_directories = '/tmp'"
    } >>"$PGDATA/postgresql.conf"
  fi

  if "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
    echo "[pg] cluster already running"
  else
    echo "[pg] starting cluster"
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOGFILE" -w start >/dev/null
  fi

  # Wait until ready.
  for _ in $(seq 1 30); do
    if "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  local psql="$PGBIN/psql -h 127.0.0.1 -p $PGPORT -U postgres -v ON_ERROR_STOP=1"
  if ! $psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$PGROLE'" | grep -q 1; then
    echo "[pg] creating role $PGROLE"
    $psql -c "CREATE ROLE $PGROLE LOGIN PASSWORD '$PGPASSWORD_LOCAL' CREATEDB;"
  fi
  if ! $psql -tAc "SELECT 1 FROM pg_database WHERE datname='$PGDATABASE_LOCAL'" | grep -q 1; then
    echo "[pg] creating database $PGDATABASE_LOCAL"
    $psql -c "CREATE DATABASE $PGDATABASE_LOCAL OWNER $PGROLE;"
  fi
  echo "[pg] ready on 127.0.0.1:$PGPORT (db=$PGDATABASE_LOCAL role=$PGROLE)"
}

cmd_status() {
  local PGBIN
  PGBIN="$(find_pgbin)" || { echo "[pg] not installed"; exit 1; }
  "$PGBIN/pg_isready" -h 127.0.0.1 -p "$PGPORT"
}

case "${1:-}" in
  install) cmd_install ;;
  start) cmd_start ;;
  status) cmd_status ;;
  *) echo "usage: $0 {install|start|status}" >&2; exit 2 ;;
esac

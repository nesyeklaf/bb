#!/usr/bin/env bash
# Server-side half of the fork deploy. Runs on the bb server host.
# Usage: remote.sh deploy <tgz> | rollback [--with-db] | serve | status
#   deploy    stop bb, back up bb.db + config + npm prefix, install <tgz>, set BB_APP_URL, start
#   rollback  restore the npm prefix and config from the last backup; --with-db also
#             restores bb.db (drops everything written since that deploy)
#   serve     publish the server tailnet-only through Tailscale Serve (needs sudo)
#   status    unit state, installed version, local and tailnet health
# Overrides: BB_UNIT (systemd user unit), BB_PORT (default 38886).
set -euo pipefail

case "${1:-}" in
  -h|--help|"") sed -n 2,9p "$0" | sed 's/^# //'; [ -n "${1:-}" ]; exit $? ;;
esac

log="$HOME/bb-fork-deploy.log"
last_backup_file="$HOME/bb-fork-last-backup"
port="${BB_PORT:-38886}"

find_unit() {
  if [ -n "${BB_UNIT:-}" ]; then echo "$BB_UNIT"; return; fi
  local units
  units=$(systemctl --user list-unit-files 'bb-host-daemon-*.service' --no-legend | awk '{print $1}')
  [ "$(echo "$units" | grep -c .)" = 1 ] || { echo "Set BB_UNIT; found: ${units:-none}" >&2; exit 1; }
  echo "$units"
}
unit=$(find_unit)
data_dir=$(systemctl --user show -p Environment "$unit" | tr ' ' '\n' | sed -n 's/^BB_DATA_DIR=//p')
[ -d "$data_dir" ] || { echo "No BB_DATA_DIR in $unit" >&2; exit 1; }
bb_app="$data_dir/npm/bin/bb-app"

tailnet_url() {
  local name
  name=$(tailscale status --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).Self.DNSName.replace(/\.$/,"")))')
  echo "https://$name:$port"
}

deploy() {
  local tgz=$1 backup
  test -f "$tgz"
  backup="$data_dir/backup-pre-fork-$(date +%Y%m%d-%H%M%S)"
  echo "=== $(date -Is) deploy $tgz ($unit)"
  systemctl --user stop "$unit"
  mkdir -p "$backup"
  for f in bb.db bb.db-wal bb.db-shm config.json; do
    [ -e "$data_dir/$f" ] && cp -a "$data_dir/$f" "$backup/"
  done
  cp -a "$data_dir/npm" "$backup/npm"
  echo "$backup" > "$last_backup_file"
  echo "backup: $backup"

  # Same native-module allowlist as the official machine installer.
  if ! npm install -g --allow-scripts=better-sqlite3,node-pty,@parcel/watcher \
      --prefix "$data_dir/npm" "$tgz"; then
    echo "npm install failed; restoring the previous package"
    rm -rf "$data_dir/npm"; cp -a "$backup/npm" "$data_dir/npm"
    systemctl --user start "$unit"
    exit 1
  fi
  BB_DATA_DIR="$data_dir" "$bb_app" config set BB_APP_URL "$(tailnet_url)"
  systemctl --user start "$unit"
  echo "=== $(date -Is) deploy done"
}

rollback() {
  local backup
  backup=$(cat "$last_backup_file")
  test -d "$backup/npm"
  echo "=== $(date -Is) rollback from $backup $*"
  systemctl --user stop "$unit"
  rm -rf "$data_dir/npm"; cp -a "$backup/npm" "$data_dir/npm"
  [ -e "$backup/config.json" ] && cp -a "$backup/config.json" "$data_dir/config.json"
  if [ "${1:-}" = --with-db ]; then
    rm -f "$data_dir/bb.db-wal" "$data_dir/bb.db-shm"
    for f in bb.db bb.db-wal bb.db-shm; do
      [ -e "$backup/$f" ] && cp -a "$backup/$f" "$data_dir/"
    done
  fi
  systemctl --user start "$unit"
  echo "=== $(date -Is) rollback done"
}

serve() {
  # Persists in tailscaled state across reboots. Never use Funnel: the bb API is
  # unauthenticated and can run commands.
  sudo tailscale serve --bg --https="$port" "http://127.0.0.1:$port"
  tailscale serve status
}

status() {
  echo "unit:     $unit $(systemctl --user is-active "$unit")"
  echo "version:  $(node -p "require('$data_dir/npm/lib/node_modules/bb-app/package.json').version")"
  echo "app url:  $(node -p "(require('$data_dir/config.json').config||{}).BB_APP_URL||'unset'")"
  echo "local:    $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")"
  echo "tailnet:  $(curl -s -o /dev/null -w '%{http_code}' "$(tailnet_url)/")"
  echo "last entries of $log (history, not this call):"
  tail -5 "$log" 2>/dev/null | sed 's/^/  | /' || true
}

cmd=$1; shift
case "$cmd" in
  deploy) deploy "$@" >>"$log" 2>&1 ;;
  rollback) rollback "$@" >>"$log" 2>&1 ;;
  serve) serve ;;
  status) status ;;
  *) echo "Unknown command: $cmd" >&2; exit 1 ;;
esac

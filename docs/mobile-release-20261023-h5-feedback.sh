#!/bin/bash
# jigsaw-mobile-v3 code-delta release 20261023-h5-feedback. Run as root, phase by phase:
#   stage | sandbox | sandbox-stop | check | upgrade | rollback
set -euo pipefail
NAME=20261023-h5-feedback-v2
PREV=20261023-h5-ui-revamp
BASE=/srv/sites/jigsaw-mobile-v3
DIR=/root/mobile-$NAME
ARCHIVE=$DIR/jigsaw-mobile-upgrade-$NAME.tar.gz
SHA=$(cat $DIR/archive.sha256)
OPS=$BASE/shared/operations/$NAME
SANDBOX=/tmp/mobile-$NAME-sandbox
UNIT=mobile-$NAME-sandbox

case "${1:-}" in
stage)
  echo "$SHA  $ARCHIVE" | sha256sum -c -
  [ "$(readlink -f $BASE/current)" = "$BASE/releases/$PREV" ] || { echo "current is not $PREV"; exit 1; }
  install -d -m 700 -o web-jigsaw -g web-jigsaw "$OPS"
  for db in mobile-v3 sessions; do
    sqlite3 "$BASE/shared/$db.sqlite" ".backup '$OPS/$db.sqlite'"
    chown web-jigsaw:web-jigsaw "$OPS/$db.sqlite"; chmod 600 "$OPS/$db.sqlite"
    [ "$(sqlite3 "$OPS/$db.sqlite" 'PRAGMA integrity_check')" = ok ] || { echo "$db backup integrity failed"; exit 1; }
    echo "backup $OPS/$db.sqlite $(stat -c %s "$OPS/$db.sqlite") bytes, tables $(sqlite3 "$OPS/$db.sqlite" "select count(*) from sqlite_master where type='table'")"
  done
  ;;
sandbox)
  rm -rf "$SANDBOX"; install -d -m 755 "$SANDBOX"; install -d -m 700 -o web-jigsaw -g web-jigsaw "$SANDBOX/data" "$SANDBOX/data/appearances"
  # Same layout the upgrade produces: only the delta, plus the installed public tree.
  mkdir -p "$SANDBOX/app"
  ln -s "$(readlink -f "$BASE/releases/$PREV/public")" "$SANDBOX/app/public"
  tar -xzf "$ARCHIVE" -C "$SANDBOX/app"; chown -R root:root "$SANDBOX/app"
  cp "$OPS/mobile-v3.sqlite" "$SANDBOX/data/mobile-v3.sqlite"; cp "$OPS/sessions.sqlite" "$SANDBOX/data/sessions.sqlite"
  cp -a "$BASE/shared/daily-appearances/." "$SANDBOX/data/appearances/" 2>/dev/null || true
  chown -R web-jigsaw:web-jigsaw "$SANDBOX/data"
  # EnvironmentFile wins over Environment=, so the sandbox gets its own env copy pointing only at copies.
  grep -vE '^(H5_PORT|H5_SESSION_DB|MOBILE_DB|MOBILE_DAILY_APPEARANCES)=' /etc/webapps/jigsaw-mobile-v3.env > "$SANDBOX/env"
  printf 'H5_PORT=3299\nH5_SESSION_DB=%s\nMOBILE_DB=%s\nMOBILE_DAILY_APPEARANCES=%s\n' "$SANDBOX/data/sessions.sqlite" "$SANDBOX/data/mobile-v3.sqlite" "$SANDBOX/data/appearances" >> "$SANDBOX/env"
  chmod 600 "$SANDBOX/env"
  grep -E '^(H5_PORT|H5_SESSION_DB|MOBILE_DB|MOBILE_DAILY_APPEARANCES)=' "$SANDBOX/env"
  systemd-run --unit="$UNIT" --collect -p User=web-jigsaw -p Group=web-jigsaw -p WorkingDirectory="$SANDBOX/app" \
    -p EnvironmentFile="$SANDBOX/env" -p Environment=NODE_ENV=production \
    -p ProtectSystem=strict -p ProtectHome=true -p PrivateTmp=false -p ReadWritePaths="$SANDBOX/data" -p NoNewPrivileges=true -p MemoryMax=512M \
    /usr/local/bin/node server/h5-gateway.mjs
  for i in $(seq 1 40); do curl -fsS http://127.0.0.1:3299/healthz >/dev/null 2>&1 && break; sleep .5; done
  curl -sS http://127.0.0.1:3299/healthz; echo
  journalctl -u "$UNIT" --no-pager -n 15
  ;;
sandbox-stop)
  systemctl stop "$UNIT" 2>/dev/null || true; rm -rf "$SANDBOX"; echo "sandbox removed"
  ;;
check)
  python3 "$DIR/upgrade-mobile-backend.py" --release "$NAME" --sha256 "$SHA" --archive "$ARCHIVE" --expect-current "$PREV" --check-only
  ;;
upgrade)
  python3 "$DIR/upgrade-mobile-backend.py" --release "$NAME" --sha256 "$SHA" --archive "$ARCHIVE" --expect-current "$PREV"
  readlink -f "$BASE/current"; systemctl is-active jigsaw-mobile-v3.service
  journalctl -u jigsaw-mobile-v3 --no-pager -n 20 --since "-3min"
  ;;
rollback)
  ln -s "releases/$PREV" "$BASE/current.rollback" && mv -T "$BASE/current.rollback" "$BASE/current"
  systemctl restart jigsaw-mobile-v3.service; sleep 2; curl -sS http://127.0.0.1:3292/healthz; echo
  ;;
*) echo "usage: $0 stage|sandbox|sandbox-stop|check|upgrade|rollback"; exit 2;;
esac

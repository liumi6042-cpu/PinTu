#!/bin/bash
# Web 3104 release: web-20261023-h5-revamp. Run as root on the server, phase by phase:
#   bash release-web.sh stage     # verify tarball, back up DB, unpack new release, link delivered assets
#   bash release-web.sh sandbox   # run new release on 3399 against a DB copy (ProtectSystem=strict)
#   bash release-web.sh switch    # point slots/3104 + current at the new release, restart, health check
#   bash release-web.sh rollback  # point back at the previous release and restart
set -euo pipefail
NAME=web-20261023-h5-feedback
SHA=aab9adadf763ff1023bc98740156b1e777bd9ccb7da46978e66b1c56e9276f11
TAR=/tmp/jigsaw-nook-${SHA:0:16}.tar.gz
ROOT=/srv/sites/jigsaw
PREV=$ROOT/releases/web-20261023-h5-revamp/app
NEW=$ROOT/releases/$NAME/app
OPS=$ROOT/shared/operations/$NAME
DB=$ROOT/shared/puzzle.sqlite
SANDBOX=/tmp/$NAME-sandbox
health(){ curl -fsS --max-time 5 -H Host:jigsawnook.online -H X-Forwarded-Proto:https "http://127.0.0.1:$1/api/health"; }

case "${1:-}" in
stage)
  echo "$SHA  $TAR" | sha256sum -c -
  [ "$(readlink -f $ROOT/slots/3104)" = "$PREV" ] || { echo "slot 3104 is not on the expected previous release"; exit 1; }
  [ ! -e "$ROOT/releases/$NAME" ] || { echo "release dir exists"; exit 1; }
  install -d -m 700 -o web-jigsaw -g web-jigsaw "$OPS"
  sqlite3 "$DB" ".backup '$OPS/puzzle.sqlite'"
  chown web-jigsaw:web-jigsaw "$OPS/puzzle.sqlite"; chmod 600 "$OPS/puzzle.sqlite"
  [ "$(sqlite3 "$OPS/puzzle.sqlite" 'PRAGMA integrity_check')" = ok ] || { echo "backup integrity failed"; exit 1; }
  echo "backup $OPS/puzzle.sqlite $(stat -c %s "$OPS/puzzle.sqlite") bytes, tables $(sqlite3 "$OPS/puzzle.sqlite" "select count(*) from sqlite_master where type='table'"), rooms $(sqlite3 "$OPS/puzzle.sqlite" 'select count(*) from puzzle_rooms'), users $(sqlite3 "$OPS/puzzle.sqlite" 'select count(*) from puzzle_users')"
  mkdir -p "$NEW"; tar -xzf "$TAR" -C "$NEW"; chown -R root:root "$ROOT/releases/$NAME"
  # Delivered album images and older shared clients live only in earlier releases: hard-link what is missing.
  before=$(ls "$NEW/dist/client/puzzles" | wc -l)
  cp -aln --no-clobber "$PREV/dist/client/puzzles/." "$NEW/dist/client/puzzles/"
  cp -aln --no-clobber "$PREV/dist/client/shared-client/." "$NEW/dist/client/shared-client/"
  echo "puzzles $before -> $(ls "$NEW/dist/client/puzzles" | wc -l) (previous $(ls "$PREV/dist/client/puzzles" | wc -l)); shared clients: $(ls "$NEW/dist/client/shared-client" | tr '\n' ' ')"
  node -e 'const r=require(process.argv[1]);console.log("release.json commit",r.gitCommit,"files",r.files.length,"dirty",r.dirty)' "$NEW/release.json"
  ;;
sandbox)
  rm -rf "$SANDBOX"; install -d -m 700 -o web-jigsaw -g web-jigsaw "$SANDBOX" "$SANDBOX/appearances"
  cp "$OPS/puzzle.sqlite" "$SANDBOX/puzzle.sqlite"; chown web-jigsaw:web-jigsaw "$SANDBOX/puzzle.sqlite"
  set -a; . /etc/webapps/jigsaw.env; set +a
  cp -a "$JIGSAW_DAILY_APPEARANCES_DIR/." "$SANDBOX/appearances/" 2>/dev/null || true; chown -R web-jigsaw:web-jigsaw "$SANDBOX/appearances"
  # EnvironmentFile overrides Environment= in systemd, so the sandbox gets its own env copy.
  grep -vE '^(DATABASE_PATH|JIGSAW_DAILY_APPEARANCES_DIR)=' /etc/webapps/jigsaw.env > "$SANDBOX/env"
  printf 'DATABASE_PATH=%s\nJIGSAW_DAILY_APPEARANCES_DIR=%s\n' "$SANDBOX/puzzle.sqlite" "$SANDBOX/appearances" >> "$SANDBOX/env"; chmod 600 "$SANDBOX/env"
  systemd-run --unit="$NAME-sandbox" --collect -p User=web-jigsaw -p Group=web-jigsaw -p WorkingDirectory="$NEW" \
    -p EnvironmentFile="$SANDBOX/env" -p Environment="NODE_ENV=production HOST=127.0.0.1 PORT=3399 VINEXT_TRUSTED_HOSTS=jigsawnook.online VINEXT_TRUST_PROXY=1" \
    -p ProtectSystem=strict -p ProtectHome=true -p PrivateTmp=false -p ReadWritePaths="$SANDBOX" -p NoNewPrivileges=true -p MemoryMax=900M \
    /bin/sh -c '/usr/local/bin/node server/migrate.mjs && exec /usr/local/bin/node server.js'
  for i in $(seq 1 30); do health 3399 >/dev/null 2>&1 && break; sleep 1; done
  health 3399; echo
  journalctl -u "$NAME-sandbox" --no-pager -n 20
  ;;
sandbox-stop)
  systemctl stop "$NAME-sandbox" 2>/dev/null || true; rm -rf "$SANDBOX"; echo "sandbox removed"
  ;;
switch)
  [ -d "$NEW" ] && [ -f "$OPS/puzzle.sqlite" ] || { echo "stage first"; exit 1; }
  ln -sfn "$NEW" "$ROOT/slots/3104.next" && mv -T "$ROOT/slots/3104.next" "$ROOT/slots/3104"
  ln -sfn "$NEW" "$ROOT/current.next" && mv -T "$ROOT/current.next" "$ROOT/current"
  systemctl restart jigsaw-web@3104.service
  for i in $(seq 1 30); do health 3104 >/dev/null 2>&1 && break; sleep 1; done
  if ! health 3104; then echo "UNHEALTHY - rolling back"; "$0" rollback; exit 1; fi; echo
  systemctl is-active jigsaw-web@3104.service; journalctl -u jigsaw-web@3104 --no-pager -n 25 --since "-2min"
  ;;
rollback)
  ln -sfn "$PREV" "$ROOT/slots/3104.next" && mv -T "$ROOT/slots/3104.next" "$ROOT/slots/3104"
  ln -sfn "$PREV" "$ROOT/current.next" && mv -T "$ROOT/current.next" "$ROOT/current"
  systemctl restart jigsaw-web@3104.service; sleep 3; health 3104; echo; systemctl is-active jigsaw-web@3104.service
  ;;
*) echo "usage: $0 stage|sandbox|sandbox-stop|switch|rollback"; exit 2;;
esac

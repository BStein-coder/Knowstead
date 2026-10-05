#!/usr/bin/env bash
# ---------------------------------------------------------------------------------------------
#  update.sh mit echten Root-Rechten unter Linux prüfen
#
#      sudo bash server/test/linux/update-root-check.sh
#
#  Ergänzt server/test/update-script.test.ts: Dort laufen dieselben Abläufe ohne Root-Rechte (»id« und
#  »runuser« sind nachgestellt). Hier geht es um das, was nur als root sichtbar wird – Eigentümer und Rechte
#  des neuen Programmordners, die .env, der Wechsel zum Dienstkonto, das Verschieben des Ordners, in dem das
#  laufende Skript liegt, und das Verhalten bei Signalen.
#
#  Braucht nur bash, coreutils, tar und python3: Node.js und die Kommandozeile von Knowstead sind durch
#  fake-node.py nachgestellt (so läuft die Prüfung auch in einer WSL-Umgebung ohne Node.js). Am System wird
#  nichts verändert – alles spielt in Ordnern unter /tmp, der Dienst ist ein nachgestelltes »systemctl«,
#  das Dienstkonto ist »nobody«.
# ---------------------------------------------------------------------------------------------
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Bitte als root ausführen (sudo bash $0)." >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "python3 fehlt." >&2; exit 2; }
id nobody >/dev/null 2>&1 || { echo "Das Konto »nobody« fehlt." >&2; exit 2; }
GROUP="$(id -gn nobody)"
case "$(uname -m)" in x86_64 | amd64) ARCH=x64 ;; aarch64 | arm64) ARCH=arm64 ;; *) ARCH="$(uname -m)" ;; esac

PASSED=0
FAILED=0
FIXTURES=()
ok() { PASSED=$((PASSED + 1)); printf '    ✔ %s\n' "$1"; }
bad() {
  FAILED=$((FAILED + 1))
  printf '    ✖ %s\n' "$1"
  shift
  if [ $# -gt 0 ]; then printf '        %s\n' "$@"; fi
}
equal() { # $1 = Beschreibung, $2 = erwartet, $3 = gefunden
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "erwartet: $2" "gefunden: $3"; fi
}
contains() { # $1 = Beschreibung, $2 = Datei, $3 = Muster (grep -E)
  if grep -Eq -- "$3" "$2"; then ok "$1"; else bad "$1" "Muster: $3" "$(head -c 1500 "$2")"; fi
}
lacks() { # $1 = Beschreibung, $2 = Datei, $3 = Muster (grep -E)
  if grep -Eq -- "$3" "$2"; then bad "$1" "unerwartet: $(grep -E -- "$3" "$2" | head -n 3)"; else ok "$1"; fi
}
version_in() { sed -n 's/.*"version":"\([^"]*\)".*/\1/p' "$1/package.json"; }

program() { # $1 = Ordner, $2 = Version, $3 = Bauzeitpunkt, $4 = »before«: Stand eines Pakets bis 1.9
  mkdir -p "$1/server/src" "$1/node_modules" "$1/plugins/beispiel"
  printf '{"name":"knowstead","type":"module","version":"%s"}' "$2" > "$1/package.json"
  if [ "${4:-}" = before ]; then
    # Bis 1.9: Beschreibung nur unter dem früheren Namen, dazu das damalige update.sh (unverändert aus dem Paket 1.9.0)
    printf '{"version":"%s","platform":"linux","arch":"%s","builtAt":"%s"}' "$2" "$ARCH" "$3" > "$1/.doku-package.json"
    cp "$HERE/../fixtures/update-1.9.0.sh" "$1/update.sh"
    # Auch das Linux-Paket brachte die Windows-Skripte mit – unter dem damaligen Namen
    printf '@echo off\r\n' > "$1/Doku-Dienst.cmd"
    printf '@echo off\r\n' > "$1/Doku-Installation.cmd"
  else
    printf '{"version":"%s","platform":"linux","arch":"%s","builtAt":"%s"}' "$2" "$ARCH" "$3" > "$1/.knowstead-package.json"
    # Pakete ab 2.0 tragen die Beschreibung zusätzlich unter dem früheren Namen (scripts/package.mjs)
    case "$2" in 1.*) ;; *) cp "$1/.knowstead-package.json" "$1/.doku-package.json" ;; esac
    cp "$ROOT/update.sh" "$1/update.sh"
  fi
  echo '// Kommandozeile' > "$1/server/src/cli.ts"
  echo '// Server' > "$1/server/src/index.ts"
  printf '{"name":"beispiel","version":"%s"}' "$2" > "$1/plugins/beispiel/plugin.json"
}

# Nachgestellte Installation 1.7.0 (Programm root, .env nur für das Dienstkonto lesbar, Daten gehören dem
# Dienstkonto) und ein Paket 1.8.0, dessen Dateien einem fremden Konto gehören und teils für alle schreibbar sind
#
# »legacy«: eine Installation aus der Zeit, als Knowstead noch „Doku“ hieß – Ordner /opt/doku, Dienst »doku«,
# .doku-package.json, DOKU_SECRET in der .env, doku.db, das update.sh von 1.9 – und ein Paket 2.0.0.
fixture() { # $1 = »inside«: Datenverzeichnis im Programmordner · »space«: Leerzeichen im Pfad · »legacy«: siehe oben
  F="$(mktemp -d /tmp/knowstead-update-check.XXXXXX)"
  FIXTURES+=("$F")
  chmod 755 "$F"
  TARGET="$F/opt/knowstead"
  if [ "${1:-}" = space ]; then TARGET="$F/opt/knowstead wiki"; fi
  STATE="$F/state"
  UNIT="$F/knowstead.service"
  OLD=1.7.0
  NEW=1.8.0
  SECRET=KNOWSTEAD_SECRET
  DB=knowstead.db
  BEFORE=""
  # So findet update.sh den Dienst-Eintrag: bei der früheren Installation muss es »doku.service« selbst entdecken
  # (nur der Ordner der Dienst-Einträge ist umgelenkt); das Skript von 1.9 kennt seine eigenen Namen
  UNIT_ENV=("KNOWSTEAD_UNIT_FILE=$UNIT")
  if [ "${1:-}" = legacy ]; then
    TARGET="$F/opt/doku"
    UNIT="$F/units/doku.service"
    OLD=1.9.0
    NEW=2.0.0
    SECRET=DOKU_SECRET
    DB=doku.db
    BEFORE=before
    UNIT_ENV=("KNOWSTEAD_UNIT_DIR=$F/units" "DOKU_UNIT_FILE=$UNIT" "DOKU_UPDATE_TRIES=${TRIES:-3}" "DOKU_UPDATE_PAUSE=${PAUSE:-0}")
  fi
  if [ "${1:-}" = inside ]; then DATA="$TARGET/data"; else DATA="$F/var/daten"; fi
  mkdir -p "$F/bin" "$F/libexec" "$STATE" "$F/opt" "$F/paket" "$F/units"
  chmod 777 "$STATE"
  # Nicht im Suchpfad: update.sh findet dieses »Node.js« über den Dienst-Eintrag (ExecStart)
  cp "$HERE/fake-node.py" "$F/libexec/node"
  chmod 755 "$F/libexec/node"
  cat > "$F/bin/systemctl" <<EOF
#!/usr/bin/env bash
# Der Dienst: »start« liest, welcher Stand im Programmordner liegt, und merkt ihn sich als laufend. Gibt die
# Prüfung einen Schemastand vor, stellt ein neuerer Stand die Datenbank um und legt vorher seine Sicherung an.
echo "systemctl \$*" >> "$STATE/calls.log"
dir="\$(sed -n 's/^WorkingDirectory=//p' "$UNIT")"
case "\$1" in
  start)
    if [ -n "\${START_DELAY:-}" ]; then sleep "\$START_DELAY"; fi
    version="\$(sed -n 's/.*"version":"\\([^"]*\\)".*/\\1/p' "\$dir/package.json")"
    rm -f "$STATE/running"
    echo "\$version" > "$STATE/running"
    case "\$version" in 1.7*) schema=23 ;; 1.*) schema=24 ;; *) schema=25 ;; esac
    if [ -f "$STATE/schema" ] && [ "\$(cat "$STATE/schema")" -lt "\$schema" ]; then
      mkdir -p "$DATA/backups/backup-20261005-090000-update"
      chown nobody:$GROUP "$DATA/backups/backup-20261005-090000-update"
      rm -f "$STATE/schema"
      echo "\$schema" > "$STATE/schema"
    fi ;;
  stop) rm -f "$STATE/running" ;;
  cat) exit 1 ;;
esac
exit 0
EOF
  chmod 755 "$F/bin/systemctl"

  program "$TARGET" "$OLD" 2026-10-04T11:01:30.000Z "$BEFORE"
  if [ "${1:-}" = inside ]; then printf 'PORT=3000\nDATA_DIR=data\n%s=bleibt\n' "$SECRET" > "$TARGET/.env"; else printf 'PORT=3000\nDATA_DIR=%s\n%s=bleibt\n' "$DATA" "$SECRET" > "$TARGET/.env"; fi
  chgrp "$GROUP" "$TARGET/.env"
  chmod 640 "$TARGET/.env"
  mkdir -p "$TARGET/plugins/eigenes"
  echo '{"name":"eigenes"}' > "$TARGET/plugins/eigenes/plugin.json"
  chown -R "nobody:$GROUP" "$TARGET/plugins/eigenes"
  mkdir -p "$DATA/backups"
  echo Datenbank > "$DATA/$DB"
  chown -R "nobody:$GROUP" "$DATA"
  chmod 750 "$DATA"
  printf '[Service]\nUser=nobody\nWorkingDirectory=%s\nExecStart="%s" --disable-warning=ExperimentalWarning server/src/index.ts\n' "$TARGET" "$F/libexec/node" > "$UNIT"
  echo "$OLD" > "$STATE/running"

  PKG="$F/paket/knowstead-$NEW-linux-x64"
  program "$PKG" "$NEW" 2026-10-05T09:00:00.000Z
  echo neu > "$PKG/neu-in-dieser-version.txt"
  chmod 666 "$PKG/neu-in-dieser-version.txt"
  chmod 777 "$PKG/plugins"
  ARCHIVE="$F/knowstead-$NEW-linux-x64.tar.gz"
  tar -czf "$ARCHIVE" --owner=4242 --group=4242 --numeric-owner -C "$F/paket" "knowstead-$NEW-linux-x64"
  (cd "$F" && sha256sum "$(basename "$ARCHIVE")" > "$ARCHIVE.sha256")
}

# update.sh aufrufen; Ausgabe in $F/out und $F/err, Rückgabe in STATUS
run_update() {
  : > "$STATE/calls.log"
  chmod 666 "$STATE/calls.log"
  STATUS=0
  env STATE_DIR="$STATE" "${UNIT_ENV[@]}" KNOWSTEAD_UPDATE_TRIES="${TRIES:-3}" KNOWSTEAD_UPDATE_PAUSE="${PAUSE:-0}" PATH="$F/bin:$PATH" \
    bash "$@" > "$F/out" 2> "$F/err" < /dev/null || STATUS=$?
}

# Jeder Aufruf der Kommandozeile lief unter dem Dienstkonto und mit dem Datenverzeichnis der Installation
cli_as_service() {
  local lines
  lines="$(grep -c '^cli ' "$STATE/calls.log" || true)"
  if [ "$lines" -gt 0 ] && [ "$(grep -c "^cli .* \[nobody\] \[$DATA\]\$" "$STATE/calls.log" || true)" = "$lines" ]; then
    ok "Kommandozeile lief $lines-mal unter dem Dienstkonto »nobody«, mit dem Datenverzeichnis der Installation"
  else
    bad "Kommandozeile unter dem Dienstkonto, mit dem Datenverzeichnis der Installation" "$(grep '^cli ' "$STATE/calls.log")"
  fi
}

runners_before="$(ls /tmp/knowstead-update.* 2>/dev/null | wc -l)"
legacy_runners_before="$(ls /tmp/doku-update.* 2>/dev/null | wc -l)"

# ------------------------------------------------------------------------------------------------
echo ""
echo "  ▸ Update aus der Installation mit Paket"
fixture
echo 23 > "$STATE/schema"
echo "eigene Notiz" > "$TARGET/eigene-notizen.txt"
run_update "$TARGET/update.sh" "$ARCHIVE" --yes
equal "Rückgabe 0" 0 "$STATUS"
equal "neuer Stand im Programmordner" 1.8.0 "$(version_in "$TARGET")"
equal "bisheriger Stand aufbewahrt" 1.7.0 "$(version_in "$F/opt/knowstead.vor-1.8.0")"
equal "nichts Halbes liegen geblieben" "knowstead knowstead.vor-1.8.0" "$(ls "$F/opt" | tr '\n' ' ' | sed 's/ $//')"
equal "Programmordner gehört wie zuvor root" "root:root" "$(stat -c %U:%G "$TARGET")"
equal "kein Eintrag des Pakets gehört dem fremden Konto aus dem Archiv" "" "$(find "$TARGET" -not -user root -not -path "$TARGET/plugins/eigenes*" | head -n 5)"
equal "nichts ist für Gruppe oder alle schreibbar" "" "$(find "$TARGET" -perm /022 -not -type l | head -n 5)"
equal ".env: Eigentümer, Gruppe und Rechte übernommen" "root:$GROUP 640" "$(stat -c '%U:%G %a' "$TARGET/.env")"
equal ".env: Inhalt übernommen" "KNOWSTEAD_SECRET=bleibt" "$(grep KNOWSTEAD_SECRET "$TARGET/.env")"
equal "eigenes Plugin samt Eigentümer übernommen" "nobody:$GROUP" "$(stat -c %U:%G "$TARGET/plugins/eigenes/plugin.json" 2>/dev/null)"
equal "Datenverzeichnis unberührt" "nobody:$GROUP 750" "$(stat -c '%U:%G %a' "$DATA")"
equal "Sicherung vor dem Umstellen gehört dem Dienstkonto" "nobody:$GROUP" "$(stat -c %U:%G "$DATA/backups/backup-20261005-090000-update")"
contains "Prüfsumme geprüft" "$F/out" 'Prüfsumme stimmt: [0-9a-f]{64}'
contains "läuft und antwortet" "$F/out" 'Knowstead 1\.8\.0 \(Paket vom 2026-10-05T09:00:00\.000Z\) läuft und antwortet\.'
contains "eigene Datei genannt, nicht übernommen" "$F/out" 'Nur im bisherigen Ordner, nicht übernommen: eigene-notizen\.txt$'
equal "Reihenfolge: anhalten, anhalten (von Hand gestartet), starten" "systemctl stop knowstead|cli 1.7.0 stop --timeout 60|systemctl start knowstead" "$(head -n 3 "$STATE/calls.log" | sed 's/ \[.*//' | paste -sd '|')"
equal "keine Fehlermeldungen" "" "$(cat "$F/err")"
cli_as_service
equal "Arbeitskopie des Skripts weggeräumt" "$runners_before" "$(ls /tmp/knowstead-update.* 2>/dev/null | wc -l)"

echo ""
echo "  ▸ --rollback nach umgestellter Datenbank"
run_update "$TARGET/update.sh" --rollback --yes
equal "Rückgabe 0" 0 "$STATUS"
equal "früherer Stand im Programmordner" 1.7.0 "$(version_in "$TARGET")"
contains "Warnung vor dem Zurücksetzen der Datenbank" "$F/out" 'Das Update hat die Datenbank umgestellt'
equal "Reihenfolge: nachsehen, anhalten, zurückspielen, tauschen, starten" "cli 1.7.0 doctor --json|systemctl stop knowstead|cli 1.8.0 stop --timeout 60|cli 1.7.0 restore backup-20261005-090000-update|systemctl start knowstead" "$(head -n 5 "$STATE/calls.log" | sed 's/ \[.*//' | paste -sd '|')"
equal "zurückgespielte Datenbank gehört dem Dienstkonto" "nobody:$GROUP" "$(stat -c %U:%G "$DATA/knowstead.db")"
equal "Sicherung des jetzigen Stands gehört dem Dienstkonto" "nobody:$GROUP" "$(stat -c %U:%G "$DATA/backups/backup-20261005-091500-restore")"
equal "nichts im Datenverzeichnis gehört root" "" "$(find "$DATA" -user root | head -n 5)"
equal ".env des früheren Stands unverändert" "root:$GROUP 640" "$(stat -c '%U:%G %a' "$TARGET/.env")"
cli_as_service
equal "Arbeitskopie des Skripts weggeräumt" "$runners_before" "$(ls /tmp/knowstead-update.* 2>/dev/null | wc -l)"

echo ""
echo "  ▸ Der neue Stand antwortet nicht, die Datenbank ist schon umgestellt"
fixture
echo 23 > "$STATE/schema"
echo 1.8.0 > "$STATE/broken"
run_update "$TARGET/update.sh" "$ARCHIVE" --yes
equal "Rückgabe 1" 1 "$STATUS"
equal "bisheriger Stand ist zurück" 1.7.0 "$(version_in "$TARGET")"
equal "Dienst läuft wieder mit dem bisherigen Stand" 1.7.0 "$(cat "$STATE/running")"
contains "Sicherung von diesem Update zurückgespielt" "$STATE/calls.log" '^cli 1\.7\.0 restore backup-20261005-090000-update \[nobody\]'
equal "Schema wieder auf dem Stand davor" 23 "$(cat "$STATE/schema")"
equal "zurückgespielte Datenbank gehört dem Dienstkonto" "nobody:$GROUP" "$(stat -c %U:%G "$DATA/knowstead.db")"
equal "nichts im Datenverzeichnis gehört root" "" "$(find "$DATA" -user root | head -n 5)"
equal ".env des bisherigen Stands unverändert" "root:$GROUP 640" "$(stat -c '%U:%G %a' "$TARGET/.env")"
contains "gescheiterter Stand bleibt zur Fehlersuche" "$F/out" 'Der gescheiterte Stand liegt zur Fehlersuche in .*/opt/knowstead\.fehlgeschlagen-[0-9]{8}-[0-9]{6}$'
cli_as_service

echo ""
echo "  ▸ Datenverzeichnis im Programmordner"
fixture inside
run_update "$TARGET/update.sh" "$ARCHIVE" --yes
equal "Rückgabe 0" 0 "$STATUS"
equal "Daten sind mit umgezogen" "Datenbank" "$(cat "$TARGET/data/knowstead.db" 2>/dev/null)"
equal "Eigentümer und Rechte der Daten unverändert" "nobody:$GROUP 750" "$(stat -c '%U:%G %a' "$TARGET/data")"
equal "im aufbewahrten Ordner liegen keine Daten mehr" "" "$(ls "$F/opt/knowstead.vor-1.8.0/data" 2>/dev/null)"
cli_as_service
run_update "$TARGET/update.sh" --rollback --yes
equal "--rollback: Rückgabe 0" 0 "$STATUS"
equal "--rollback: Daten wieder beim früheren Stand" "Datenbank" "$(cat "$TARGET/data/knowstead.db" 2>/dev/null)"
equal "--rollback: früherer Stand" 1.7.0 "$(version_in "$TARGET")"
cli_as_service

echo ""
echo "  ▸ Aus dem entpackten Paket (Dateien gehören einem anderen Konto), Ziel aus dem Dienst-Eintrag"
fixture
chown -R 4242:4242 "$PKG"
run_update "$PKG/update.sh" --yes
equal "Rückgabe 0" 0 "$STATUS"
equal "neuer Stand im Programmordner" 1.8.0 "$(version_in "$TARGET")"
equal "Programmordner gehört root" "" "$(find "$TARGET" -not -user root -not -path "$TARGET/plugins/eigenes*" | head -n 5)"
equal "nichts ist für Gruppe oder alle schreibbar" "" "$(find "$TARGET" -perm /022 -not -type l | head -n 5)"
equal "das entpackte Paket bleibt, wo es ist" 1.8.0 "$(version_in "$PKG")"
cli_as_service

echo ""
echo "  ▸ Leerzeichen im Pfad der Installation"
fixture space
echo 23 > "$STATE/schema"
run_update "$TARGET/update.sh" "$ARCHIVE" --yes --keep 1
equal "Rückgabe 0" 0 "$STATUS"
equal "neuer Stand im Programmordner" 1.8.0 "$(version_in "$TARGET")"
equal "bisheriger Stand aufbewahrt" 1.7.0 "$(version_in "$TARGET.vor-1.8.0")"
equal "nichts Halbes liegen geblieben" "knowstead wiki|knowstead wiki.vor-1.8.0" "$(ls "$F/opt" | paste -sd '|')"
cli_as_service
run_update "$TARGET/update.sh" --rollback --yes
equal "--rollback: Rückgabe 0" 0 "$STATUS"
equal "--rollback: früherer Stand" 1.7.0 "$(version_in "$TARGET")"
contains "--rollback: Datenbank zurückgespielt" "$STATE/calls.log" '^cli 1\.7\.0 restore backup-20261005-090000-update \[nobody\]'
# Noch einmal einspielen: Der zurückgenommene Stand wird als Rest eines früheren Versuchs aufgeräumt
run_update "$TARGET/update.sh" "$ARCHIVE" --yes --keep 1
equal "erneutes Update: Rückgabe 0" 0 "$STATUS"
equal "erneutes Update: Reste aufgeräumt" "knowstead wiki|knowstead wiki.vor-1.8.0" "$(ls "$F/opt" | paste -sd '|')"

echo ""
echo "  ▸ Ohne Root-Rechte"
fixture
: > "$STATE/calls.log"
chmod 666 "$STATE/calls.log"
STATUS=0
runuser -u nobody -- env STATE_DIR="$STATE" KNOWSTEAD_UNIT_FILE="$UNIT" PATH="$F/bin:$PATH" bash "$PKG/update.sh" --yes > "$F/out" 2> "$F/err" < /dev/null || STATUS=$?
equal "abgelehnt" 1 "$STATUS"
contains "mit Hinweis" "$F/err" 'Bitte als root ausführen'
equal "nichts angefasst" "1.7.0|" "$(version_in "$TARGET")|$(cat "$STATE/calls.log")"
# Der Probelauf braucht keine Root-Rechte und verändert nichts
STATUS=0
runuser -u nobody -- env STATE_DIR="$STATE" KNOWSTEAD_UNIT_FILE="$UNIT" PATH="$F/bin:$PATH" bash "$PKG/update.sh" --dry-run > "$F/out" 2> "$F/err" < /dev/null || STATUS=$?
equal "Probelauf: Rückgabe 0" 0 "$STATUS"
contains "Probelauf: zeigt den Tausch" "$F/out" '\(Probelauf\) mv .*/opt/knowstead .*/opt/knowstead\.vor-1\.8\.0'
equal "Probelauf: nichts angefasst" "1.7.0|knowstead|" "$(version_in "$TARGET")|$(ls "$F/opt" | paste -sd '|')|$(cat "$STATE/calls.log")"

echo ""
echo "  ▸ Terminal weg (SIGHUP) und Ausgabe nicht mehr lesbar: das Update läuft zu Ende"
fixture
: > "$STATE/calls.log"
chmod 666 "$STATE/calls.log"
env STATE_DIR="$STATE" KNOWSTEAD_UNIT_FILE="$UNIT" KNOWSTEAD_UPDATE_TRIES=3 KNOWSTEAD_UPDATE_PAUSE=0 START_DELAY=2 PATH="$F/bin:$PATH" \
  bash "$TARGET/update.sh" "$ARCHIVE" --yes > "$F/out" 2> "$F/err" < /dev/null &
pid=$!
for _ in $(seq 1 100); do
  if grep -q '^systemctl start' "$STATE/calls.log"; then break; fi
  sleep 0.1
done
kill -HUP "$pid" 2>/dev/null
STATUS=0
wait "$pid" || STATUS=$?
equal "SIGHUP mitten im Tausch: Rückgabe 0" 0 "$STATUS"
equal "SIGHUP mitten im Tausch: neuer Stand läuft" "1.8.0|1.8.0" "$(version_in "$TARGET")|$(cat "$STATE/running")"
fixture
: > "$STATE/calls.log"
chmod 666 "$STATE/calls.log"
env STATE_DIR="$STATE" KNOWSTEAD_UNIT_FILE="$UNIT" KNOWSTEAD_UPDATE_TRIES=3 KNOWSTEAD_UPDATE_PAUSE=0 PATH="$F/bin:$PATH" \
  bash "$TARGET/update.sh" "$ARCHIVE" --yes 2> "$F/err" < /dev/null | head -n 2 > /dev/null
equal "Ausgabe bricht ab: Rückgabe 0" 0 "${PIPESTATUS[0]}"
equal "Ausgabe bricht ab: neuer Stand läuft" "1.8.0|1.8.0" "$(version_in "$TARGET")|$(cat "$STATE/running")"
equal "Ausgabe bricht ab: nichts Halbes liegen geblieben" "knowstead knowstead.vor-1.8.0" "$(ls "$F/opt" | tr '\n' ' ' | sed 's/ $//')"

echo ""
echo "  ▸ Abbruch (SIGTERM) nach dem Tausch: der bisherige Stand kommt zurück"
fixture
echo 1.8.0 > "$STATE/broken"
: > "$STATE/calls.log"
chmod 666 "$STATE/calls.log"
env STATE_DIR="$STATE" KNOWSTEAD_UNIT_FILE="$UNIT" KNOWSTEAD_UPDATE_TRIES=1000 KNOWSTEAD_UPDATE_PAUSE=0.2 PATH="$F/bin:$PATH" \
  bash "$TARGET/update.sh" "$ARCHIVE" --yes > "$F/out" 2> "$F/err" < /dev/null &
pid=$!
for _ in $(seq 1 100); do
  if grep -q '^cli 1.8.0 doctor' "$STATE/calls.log"; then break; fi
  sleep 0.1
done
kill -TERM "$pid" 2>/dev/null
STATUS=0
wait "$pid" || STATUS=$?
equal "Rückgabe 130" 130 "$STATUS"
equal "bisheriger Stand ist zurück und läuft" "1.7.0|1.7.0" "$(version_in "$TARGET")|$(cat "$STATE/running")"
contains "Meldung" "$F/out" 'Der bisherige Stand läuft wieder: Knowstead 1\.7\.0'

echo ""
echo "  ▸ Abbruch (SIGTERM) vor dem Tausch: der Dienst läuft weiter"
fixture
: > "$STATE/calls.log"
chmod 666 "$STATE/calls.log"
# Das Anhalten dauert: Die Kommandozeile des bisherigen Stands wartet (hier: ein langsames »systemctl stop«)
sed -i 's/^  stop) rm -f/  stop) sleep 2; rm -f/' "$F/bin/systemctl"
env STATE_DIR="$STATE" KNOWSTEAD_UNIT_FILE="$UNIT" KNOWSTEAD_UPDATE_TRIES=3 KNOWSTEAD_UPDATE_PAUSE=0 PATH="$F/bin:$PATH" \
  bash "$TARGET/update.sh" "$ARCHIVE" --yes > "$F/out" 2> "$F/err" < /dev/null &
pid=$!
for _ in $(seq 1 100); do
  if grep -q '^systemctl stop' "$STATE/calls.log"; then break; fi
  sleep 0.1
done
kill -TERM "$pid" 2>/dev/null
STATUS=0
wait "$pid" || STATUS=$?
equal "Rückgabe 130" 130 "$STATUS"
equal "Programmordner unverändert, Dienst wieder gestartet" "1.7.0|1.7.0" "$(version_in "$TARGET")|$(cat "$STATE/running")"
equal "nichts Halbes liegen geblieben" "knowstead" "$(ls "$F/opt" | tr '\n' ' ' | sed 's/ $//')"
contains "Meldung" "$F/err" 'Abgebrochen, bevor der Programmordner getauscht war'

equal "Arbeitskopien des Skripts weggeräumt" "$runners_before" "$(ls /tmp/knowstead-update.* 2>/dev/null | wc -l)"

# ------------------------------------------------------------------------------------------------
# Installation aus der Zeit, als Knowstead noch „Doku“ hieß (bis 1.9)
echo ""
echo "  ▸ Frühere Installation (Dienst »doku«): das installierte update.sh von 1.9 spielt das Paket 2.0 ein"
fixture legacy
echo 24 > "$STATE/schema"
env_before="$(cat "$TARGET/.env")"
run_update "$TARGET/update.sh" "$ARCHIVE" --yes
equal "Rückgabe 0" 0 "$STATUS"
equal "neuer Stand im Programmordner, der weiter doku heißt" 2.0.0 "$(version_in "$TARGET")"
equal "bisheriger Stand aufbewahrt" 1.9.0 "$(version_in "$F/opt/doku.vor-2.0.0")"
equal "nichts Halbes liegen geblieben" "doku doku.vor-2.0.0" "$(ls "$F/opt" | tr '\n' ' ' | sed 's/ $//')"
equal "Programmordner gehört wie zuvor root" "root:root" "$(stat -c %U:%G "$TARGET")"
equal "kein Eintrag des Pakets gehört dem fremden Konto aus dem Archiv" "" "$(find "$TARGET" -not -user root -not -path "$TARGET/plugins/eigenes*" | head -n 5)"
equal "nichts ist für Gruppe oder alle schreibbar" "" "$(find "$TARGET" -perm /022 -not -type l | head -n 5)"
equal ".env: Eigentümer, Gruppe und Rechte übernommen" "root:$GROUP 640" "$(stat -c '%U:%G %a' "$TARGET/.env")"
equal ".env: unverändert, die Einträge mit DOKU_ bleiben" "$env_before" "$(cat "$TARGET/.env")"
equal "Datenverzeichnis: doku.db bleibt, keine zweite Datenbank" "backups doku.db" "$(ls "$DATA" | tr '\n' ' ' | sed 's/ $//')"
equal "Sicherung vor dem Umstellen gehört dem Dienstkonto" "nobody:$GROUP" "$(stat -c %U:%G "$DATA/backups/backup-20261005-090000-update")"
contains "bisherige Installation aus .doku-package.json beschrieben" "$F/out" 'Bisher: +Knowstead 1\.9\.0 \(Paket vom 2026-10-04T11:01:30\.000Z\)'
contains "läuft und antwortet" "$F/out" 'Knowstead 2\.0\.0 \(Paket vom 2026-10-05T09:00:00\.000Z\) läuft und antwortet\.'
contains "Rückweg nennt den Ordner der Installation" "$F/out" 'bash .*/opt/doku/update\.sh --rollback'
lacks "Windows-Skripte des früheren Pakets gelten nicht als eigene Dateien" "$F/out" 'nicht übernommen'
equal "Reihenfolge: Dienst »doku« anhalten, Kommandozeile von 1.9, Dienst »doku« starten" "systemctl stop doku|cli 1.9.0 stop --timeout 60|systemctl start doku" "$(head -n 3 "$STATE/calls.log" | sed 's/ \[.*//' | paste -sd '|')"
lacks "kein Aufruf für einen Dienst »knowstead«" "$STATE/calls.log" '^systemctl .*knowstead'
equal "keine Fehlermeldungen" "" "$(cat "$F/err")"
cli_as_service
equal "Arbeitskopien beider Skripte weggeräumt" "$runners_before|$legacy_runners_before" "$(ls /tmp/knowstead-update.* 2>/dev/null | wc -l)|$(ls /tmp/doku-update.* 2>/dev/null | wc -l)"

echo ""
echo "  ▸ Frühere Installation: --rollback zurück auf 1.9, Datenbank von davor"
run_update "$TARGET/update.sh" --rollback --yes
equal "Rückgabe 0" 0 "$STATUS"
equal "früherer Stand im Programmordner" 1.9.0 "$(version_in "$TARGET")"
contains "Warnung vor dem Zurücksetzen der Datenbank" "$F/out" 'Das Update hat die Datenbank umgestellt'
equal "Reihenfolge: nachsehen, anhalten, zurückspielen, tauschen, starten" "cli 1.9.0 doctor --json|systemctl stop doku|cli 2.0.0 stop --timeout 60|cli 1.9.0 restore backup-20261005-090000-update|systemctl start doku" "$(head -n 5 "$STATE/calls.log" | sed 's/ \[.*//' | paste -sd '|')"
equal "zurückgespielte Datenbank ist doku.db und gehört dem Dienstkonto" "nobody:$GROUP" "$(stat -c %U:%G "$DATA/doku.db")"
equal "keine Datenbank unter dem neuen Namen entstanden" "" "$(ls "$DATA" | grep knowstead || true)"
equal "nichts im Datenverzeichnis gehört root" "" "$(find "$DATA" -user root | head -n 5)"
cli_as_service

echo ""
echo "  ▸ Frühere Installation: der neue Stand antwortet nicht, die Datenbank ist schon umgestellt"
fixture legacy
echo 24 > "$STATE/schema"
echo 2.0.0 > "$STATE/broken"
run_update "$TARGET/update.sh" "$ARCHIVE" --yes
equal "Rückgabe 1" 1 "$STATUS"
equal "bisheriger Stand ist zurück" 1.9.0 "$(version_in "$TARGET")"
equal "Dienst läuft wieder mit dem bisherigen Stand" 1.9.0 "$(cat "$STATE/running")"
contains "Sicherung von diesem Update mit der Kommandozeile von 1.9 zurückgespielt" "$STATE/calls.log" '^cli 1\.9\.0 restore backup-20261005-090000-update \[nobody\]'
equal "Schema wieder auf dem Stand davor" 24 "$(cat "$STATE/schema")"
equal "nichts im Datenverzeichnis gehört root" "" "$(find "$DATA" -user root | head -n 5)"
contains "Meldung" "$F/out" 'Der bisherige Stand läuft wieder: Knowstead 1\.9\.0'
contains "gescheiterter Stand bleibt zur Fehlersuche" "$F/out" 'Der gescheiterte Stand liegt zur Fehlersuche in .*/opt/doku\.fehlgeschlagen-[0-9]{8}-[0-9]{6}$'
cli_as_service

echo ""
echo "  ▸ Frühere Installation: aus dem entpackten Paket, Ziel aus dem Dienst-Eintrag »doku«"
fixture legacy
run_update "$PKG/update.sh" --yes
equal "Rückgabe 0" 0 "$STATUS"
equal "neuer Stand im Programmordner" 2.0.0 "$(version_in "$TARGET")"
equal "Dienst »doku« angehalten und gestartet" "systemctl stop doku|cli 1.9.0 stop --timeout 60|systemctl start doku" "$(head -n 3 "$STATE/calls.log" | sed 's/ \[.*//' | paste -sd '|')"
cli_as_service

for dir in "${FIXTURES[@]}"; do
  case "$dir" in /tmp/knowstead-update-check.*) rm -rf "$dir" ;; esac
done
echo ""
echo "  $PASSED in Ordnung, $FAILED fehlgeschlagen"
[ "$FAILED" -eq 0 ]

#!/usr/bin/env bash
# ---------------------------------------------------------------------------------------------
#  Knowstead aktualisieren – mit einem Befehl (Linux)
#
#  Aus der Installation:      sudo bash /opt/knowstead/update.sh /tmp/knowstead-<version>-linux-x64.tar.gz
#  Aus dem entpackten Paket:  sudo bash /tmp/knowstead-<version>-linux-x64/update.sh
#  Probelauf:                 bash update.sh <paket.tar.gz> --dry-run
#  Zurück zum Stand davor:    sudo bash /opt/knowstead/update.sh --rollback
#
#  Ablauf: Prüfsumme prüfen → neues Programm neben das alte legen (Knowstead läuft dabei weiter) →
#  Dienst anhalten → Ordner tauschen, .env, eigene Plugins und ein Datenverzeichnis im Programmordner
#  übernehmen → Dienst starten → prüfen, dass der neue Stand läuft und antwortet. Gelingt das nicht,
#  kommt der bisherige Stand zurück – samt Datenbank, falls das Update sie schon umgestellt hatte.
#  Der bisherige Programmordner bleibt als <ordner>.vor-<version> liegen.
# ---------------------------------------------------------------------------------------------
set -euo pipefail

# Alles steht in Funktionen: Bash liest die Datei so vollständig ein, bevor etwas läuft – das Skript
# tauscht den Ordner, in dem es selbst liegt.
main() {
  SELF="${BASH_SOURCE[0]}"
  SELF_DIR="$(cd "$(dirname "$SELF")" && pwd)"
  ARCHIVE=""
  TARGET=""
  SHA256=""
  KEEP=2
  WAIT=120
  ASSUME_YES=0
  DRY_RUN=0
  HANDBOOK=1
  ROLLBACK=0
  FORCE=0
  # Nur intern: ausgepacktes Paket (--staged, --package) und die laufende Kopie des Skripts (--runner)
  STAGED=""
  PACKAGE=""
  RUNNER=""
  PASS=()
  # Zustand für das Aufräumen am Ende (auch nach einem Abbruch)
  STAGED_DIR=""
  BACKUP=""
  STOPPED=0
  SWAPPED=0
  STARTED_AT=0

  while [ $# -gt 0 ]; do
    case "$1" in
      --target | --sha256 | --keep | --wait | --staged | --package | --runner)
        [ $# -ge 2 ] || fail "$1 erwartet einen Wert."
        case "$1" in
          --target) TARGET="$2" ;;
          --sha256) SHA256="$2"; PASS+=(--sha256 "$2") ;;
          --keep) KEEP="$2"; PASS+=(--keep "$2") ;;
          --wait) WAIT="$2"; PASS+=(--wait "$2") ;;
          --staged) STAGED="$2" ;;
          --package) PACKAGE="$2" ;;
          --runner) RUNNER="$2" ;;
        esac
        shift
        ;;
      --yes) ASSUME_YES=1; PASS+=(--yes) ;;
      --force) FORCE=1; PASS+=(--force) ;;
      --no-handbook) HANDBOOK=0; PASS+=(--no-handbook) ;;
      --rollback) ROLLBACK=1 ;;
      --dry-run) DRY_RUN=1; PASS+=(--dry-run) ;;
      -h | --help) usage; return 0 ;;
      --*) echo "Unbekannte Option: $1" >&2; usage; return 2 ;;
      *)
        if [ -n "$ARCHIVE" ]; then echo "Bitte nur ein Paket angeben." >&2; return 2; fi
        ARCHIVE="$1"
        ;;
    esac
    shift
  done
  case "$KEEP" in '' | *[!0-9]*) fail "--keep erwartet eine Zahl." ;; esac
  case "$WAIT" in '' | *[!0-9]*) fail "--wait erwartet eine Zahl (Sekunden)." ;; esac
  if [ "$ROLLBACK" = 1 ] && [ -n "$ARCHIVE" ]; then fail "--rollback kehrt zum aufbewahrten Stand zurück – bitte ohne Paket aufrufen."; fi

  # Bricht die Verbindung zum Terminal ab, läuft das Update trotzdem zu Ende; Strg+C räumt geordnet auf
  trap '' HUP PIPE
  trap 'exit 130' INT TERM

  # ------------------------------------------------------------------ Dienst, Node.js, Ziel
  # Dienst »knowstead« – oder »doku«, wenn die Installation aus der Zeit vor der Umbenennung stammt (bis 1.9):
  # Sie behält ihren Dienst, ihr Konto und ihren Ordner, getauscht wird nur das Programm darin.
  # Abweichender Ort der Dienst-Einträge nur für die Prüfung der Routine ohne Root-Rechte (server/test/update-script.test.ts)
  UNIT_DIR="${KNOWSTEAD_UNIT_DIR:-/etc/systemd/system}"
  if [ -n "${KNOWSTEAD_UNIT_FILE:-}" ]; then
    UNIT_FILE="$KNOWSTEAD_UNIT_FILE"
  elif [ ! -f "$UNIT_DIR/knowstead.service" ] && [ -f "$UNIT_DIR/doku.service" ]; then
    UNIT_FILE="$UNIT_DIR/doku.service"
  else
    UNIT_FILE="$UNIT_DIR/knowstead.service"
  fi
  SERVICE="$(basename "$UNIT_FILE" .service)"
  HAS_UNIT=0
  if command -v systemctl >/dev/null 2>&1 && { [ -f "$UNIT_FILE" ] || systemctl cat "$SERVICE.service" >/dev/null 2>&1; }; then HAS_UNIT=1; fi

  # Node.js: dasselbe, mit dem der Dienst läuft – sonst das aus dem Suchpfad
  NODE_BIN=""
  if [ -f "$UNIT_FILE" ]; then
    NODE_BIN="$(sed -n 's/^ExecStart="\{0,1\}\([^" ]*\)"\{0,1\} .*server\/src\/index\.ts.*/\1/p' "$UNIT_FILE" | tail -n 1)"
    if [ -z "$NODE_BIN" ] || ! "$NODE_BIN" -e '' >/dev/null 2>&1; then NODE_BIN=""; fi
  fi
  if [ -z "$NODE_BIN" ]; then NODE_BIN="$(command -v node || true)"; fi
  [ -n "$NODE_BIN" ] || fail "Node.js wurde nicht gefunden."

  if [ -z "$TARGET" ]; then
    # Aus der Installation aufgerufen (mit Paket oder zum Zurückkehren): Der Ordner dieses Skripts ist die Installation
    if { [ -n "$ARCHIVE" ] || [ "$ROLLBACK" = 1 ]; } && [ -f "$SELF_DIR/.env" ]; then TARGET="$SELF_DIR"; fi
    if [ -z "$TARGET" ] && [ -f "$UNIT_FILE" ]; then TARGET="$(sed -n 's/^WorkingDirectory=//p' "$UNIT_FILE" | tail -n 1)"; fi
    TARGET="${TARGET:-/opt/knowstead}"
    # Ohne Dienst-Eintrag: der frühere Standardordner, falls dort die Installation liegt
    if [ ! -f "$TARGET/.env" ] && [ -f /opt/doku/.env ]; then TARGET=/opt/doku; fi
  fi
  TARGET="${TARGET%/}"
  case "$TARGET" in /?*) ;; *) fail "Bitte den Programmordner als vollständigen Pfad angeben (--target /opt/knowstead)." ;; esac
  if [ ! -f "$TARGET/.env" ] || [ ! -f "$TARGET/server/src/cli.ts" ]; then
    fail "$TARGET ist keine Knowstead-Installation (.env oder Programm fehlt). Für eine neue Installation: bash install.sh"
  fi
  if [ "$DRY_RUN" = 0 ] && [ "$(id -u)" -ne 0 ]; then
    fail "Bitte als root ausführen (sudo bash update.sh …) – der Dienst wird angehalten und der Programmordner getauscht."
  fi

  # Datenverzeichnis: Liegt es im Programmordner, zieht es beim Tausch mit um
  DATA_DIR="$(env_value "$TARGET/.env" DATA_DIR)"
  DATA_DIR="${DATA_DIR:-data}"
  DATA_INSIDE=""
  case "$DATA_DIR" in
    /*) case "$DATA_DIR/" in "$TARGET"/*) DATA_INSIDE="${DATA_DIR#"$TARGET"/}" ;; esac ;;
    *) DATA_INSIDE="${DATA_DIR#./}"; DATA_DIR="$TARGET/$DATA_INSIDE" ;;
  esac
  DATA_INSIDE="${DATA_INSIDE%/}"
  DATA_DIR="${DATA_DIR%/}"
  # Wem die Installation gehört – der neue Programmordner bekommt denselben Eigentümer
  OWNER="$(stat -c %U:%G "$TARGET" 2>/dev/null || echo root:root)"

  # Beim Zurückkehren wird der Ordner verschoben, in dem dieses Skript liegt – deshalb aus einer eigenen Kopie laufen
  if [ "$ROLLBACK" = 1 ] && [ -z "$RUNNER" ]; then
    RUNNER="$(mktemp "${TMPDIR:-/tmp}/knowstead-update.XXXXXX")"
    cp "$SELF" "$RUNNER"
    exec bash "$RUNNER" --rollback --target "$TARGET" --runner "$RUNNER" ${PASS[@]+"${PASS[@]}"}
  fi

  trap on_exit EXIT
  if [ "$ROLLBACK" = 1 ]; then
    go_back
  elif [ -n "$ARCHIVE" ]; then
    unpack_and_continue
  else
    install_this_package
  fi
}

usage() {
  sed -n '3,14p' "$SELF" | sed 's/^# \{0,1\}//'
  cat <<'EOF'
Optionen:
  --target <ordner>     Programmordner der Installation (Standard: Arbeitsverzeichnis des Dienstes, sonst /opt/knowstead)
  --sha256 <prüfsumme>  erwartete Prüfsumme des Pakets (sonst die Datei <paket>.sha256 daneben, falls vorhanden)
  --keep <zahl>         so viele frühere Programmordner aufbewahren (Standard 2)
  --wait <sekunden>     so lange auf den neuen Stand warten, bevor der bisherige zurückkommt (Standard 120)
  --yes                 ohne Rückfrage
  --force               auch einspielen, wenn dieser Stand schon installiert ist
  --no-handbook         das Handbuch nach dem Update nicht ergänzen
  --rollback            zum zuletzt aufbewahrten Programmordner zurückkehren
  --dry-run             nur anzeigen, was geschehen würde
EOF
}

# Ausgaben dürfen das Update nicht abbrechen (Terminal weg): Fehler beim Schreiben werden übergangen
say() { printf '%s\n' "$*" || true; }
step() { printf '\n  ▸ %s\n' "$*" || true; }
fail() {
  printf '\n  [!] %s\n' "$*" >&2 || true
  exit 1
}
run() {
  if [ "$DRY_RUN" = 1 ]; then say "    (Probelauf) $*"; else "$@"; fi
}

# Rückfrage – ohne Terminal (Skript, Aufgabe) nur mit --yes
confirm() { # $1 = Frage, $2 = Vorgabe (j|n)
  local answer
  if [ "$ASSUME_YES" = 1 ] || [ "$DRY_RUN" = 1 ]; then return 0; fi
  if [ ! -t 0 ]; then fail "Ohne Terminal bitte --yes angeben."; fi
  read -r -p "  $1 (j/n) [$2]: " answer || answer=""
  case "${answer:-$2}" in j | J | y | Y) return 0 ;; *) return 1 ;; esac
}

# Feld aus einer JSON-Datei – leer, wenn es Datei oder Feld nicht gibt
json_field() { # $1 = Datei, $2 = Feld
  "$NODE_BIN" -e 'try { const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]]; if (v != null) process.stdout.write(String(v)); } catch {}' "$1" "$2"
}

# Beschreibung eines Pakets: .knowstead-package.json – bei Paketen und Installationen bis 1.9 .doku-package.json
package_info() { # $1 = Programmordner; gibt den Pfad aus, leer wenn die Datei fehlt
  if [ -f "$1/.knowstead-package.json" ]; then
    printf '%s' "$1/.knowstead-package.json"
  elif [ -f "$1/.doku-package.json" ]; then
    printf '%s' "$1/.doku-package.json"
  fi
}

# „Knowstead 2.0.0 (Paket vom 2026-10-04T12:00:00.000Z)“
describe() { # $1 = Programmordner
  local version built info
  version="$(json_field "$1/package.json" version)"
  info="$(package_info "$1")"
  built="$(json_field "${info:-$1/.knowstead-package.json}" builtAt)"
  printf 'Knowstead %s%s' "${version:-?}" "${built:+ (Paket vom $built)}"
}

# Wert aus einer .env lesen (ohne sie auszuführen)
env_value() { # $1 = Datei, $2 = Schlüssel
  [ -f "$1" ] || return 0
  sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\{0,1\}$2[[:space:]]*=[[:space:]]*//p" "$1" | tail -n 1 | sed -e "s/^'\(.*\)'$/\1/" -e 's/^"\(.*\)"$/\1/' -e 's/[[:space:]]\+#.*$//'
}

# Konto, dem das Datenverzeichnis gehört – unter ihm läuft der Dienst. Leer: root (oder nicht feststellbar)
service_account() {
  local user
  user="$(stat -c %U "$DATA_DIR" 2>/dev/null || true)"
  case "$user" in '' | root | UNKNOWN) return 0 ;; esac
  if id -u "$user" >/dev/null 2>&1; then printf '%s' "$user"; fi
}

# Befehl im Namen des Dienstkontos ausführen: Was die Kommandozeile im Datenverzeichnis anlegt (Sicherung,
# zurückgespielte Datenbank), muss dem Dienst gehören – sonst kann er es danach nicht mehr schreiben.
as_service() {
  local user
  user="$(service_account)"
  if [ -z "$user" ] || [ "$(id -u)" -ne 0 ]; then
    "$@"
  elif command -v runuser >/dev/null 2>&1; then
    runuser -u "$user" -- "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo -u "$user" -- "$@"
  else
    "$@"
  fi
}

# Kommandozeile eines Programmordners – immer mit dem Datenverzeichnis der Installation, auch wenn der Ordner
# gerade beiseite liegt (eine relative Angabe in dessen .env zeigte sonst ins Leere)
cli() { # $1 = Programmordner, Rest = Befehl
  local dir="$1"
  shift
  (cd "$dir" && as_service env "DATA_DIR=$DATA_DIR" "$NODE_BIN" --disable-warning=ExperimentalWarning server/src/cli.ts "$@")
}

# Ergebnis der Prüfung (doctor --json) auswerten. Die Prüfung endet bei Befunden mit Rückgabe 1 –
# deshalb erst einsammeln, dann auswerten.
doctor_says() { # $1 = Programmordner, $2 = Ausdruck über checks/by(id), der wahr sein muss
  local report
  report="$(cli "$1" doctor --json 2>/dev/null || true)"
  printf '%s' "$report" | "$NODE_BIN" -e '
    let text = "";
    process.stdin.on("data", (d) => (text += d)).on("end", () => {
      try {
        const checks = JSON.parse(text).checks;
        const by = (id) => checks.find((c) => c.id === id);
        process.exit(new Function("checks", "by", "return (" + process.argv[1] + ")")(checks, by) ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });' "$2"
}

# Der Server läuft, antwortet und arbeitet mit dem Stand im Ordner. Ältere Versionen kennen die Prüfungen
# »http« und »program« noch nicht – dort genügt, dass der Server läuft. Andere Befunde der Prüfung (Adresse,
# Sicherungen …) gab es schon vor dem Update; sie entscheiden nicht darüber, ob der neue Stand bleibt.
healthy() { # $1 = Programmordner
  doctor_says "$1" '/^läuft$/.test(by("server")?.message ?? "") && (!by("http") || by("http").status === "ok") && !by("program") && by("database")?.status !== "error"'
}

# Stammt die Datenbank von einer neueren Version als das Programm im Ordner?
database_newer() { # $1 = Programmordner
  # Die Kommandozeile einer Version bis 1.9 nennt das Programm noch „Doku“
  doctor_says "$1" '/neueren (Knowstead|Doku)-Version/.test(by("database")?.message ?? "")'
}

wait_healthy() { # $1 = Programmordner
  local deadline tries=0
  deadline=$(($(date +%s) + WAIT))
  while :; do
    if healthy "$1"; then return 0; fi
    tries=$((tries + 1))
    # Feste Zahl an Versuchen nur für die Prüfung der Routine
    if [ -n "${KNOWSTEAD_UPDATE_TRIES:-}" ]; then
      if [ "$tries" -ge "$KNOWSTEAD_UPDATE_TRIES" ]; then return 1; fi
    elif [ "$(date +%s)" -ge "$deadline" ]; then
      return 1
    fi
    sleep "${KNOWSTEAD_UPDATE_PAUSE:-2}"
  done
}

stop_knowstead() { # $1 = Programmordner, dessen Kommandozeile den Server beendet
  if [ "$HAS_UNIT" = 1 ]; then run systemctl stop "$SERVICE"; fi
  # Auch ein von Hand gestarteter Server hält die Datenbank – geordnet beenden
  if [ "$DRY_RUN" = 1 ]; then
    say "    (Probelauf) node server/src/cli.ts stop --timeout 60"
  else
    cli "$1" stop --timeout 60 >/dev/null || fail "Der laufende Knowstead-Server ließ sich nicht beenden."
  fi
}

start_knowstead() {
  if [ "$HAS_UNIT" = 1 ]; then run systemctl start "$SERVICE"; fi
}

# Sicherung, die ein Update vor dem Umstellen der Datenbank anlegte: die jüngste ab dem Zeitpunkt $1 (leer: keine)
update_backup() { # $1 = frühester Zeitpunkt (Sekunden seit 1970)
  local backups="$DATA_DIR/backups" candidate
  [ -d "$backups" ] || return 0
  while IFS= read -r candidate; do
    if [ "$(stat -c %Y "$backups/$candidate" 2>/dev/null || echo 0)" -ge "$1" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done < <(ls -1 "$backups" 2>/dev/null | grep -E '^backup-[0-9]{8}-[0-9]{6}-update$' | sort -r || true)
}

# Datenbank auf den Stand vor dem Update bringen
restore_database() { # $1 = Programmordner, dessen Kommandozeile zurückspielt, $2 = Name der Sicherung
  local output result=0
  say "    Datenbank aus $2 zurückspielen (der jetzige Stand wird dabei zusätzlich gesichert)"
  # Erst das Ergebnis, dann die Ausgabe: Ein nicht mehr lesbares Terminal darf nicht wie ein Fehlschlag aussehen
  output="$(cli "$1" restore "$2" 2>&1)" || result=1
  printf '%s\n' "$output" | sed 's/^/      /' || true
  # Ohne runuser und sudo lief das als root – was dabei entstand, dem Dienstkonto geben
  if [ -n "$(service_account)" ] && ! command -v runuser >/dev/null 2>&1 && ! command -v sudo >/dev/null 2>&1; then
    chown -R "$(stat -c %U:%G "$DATA_DIR")" "$DATA_DIR" 2>/dev/null || true
  fi
  return "$result"
}

# Der neue Stand läuft nicht: bisherigen Programmordner zurückholen, Datenbank falls nötig auch
rollback() {
  local failed="" name
  say ""
  say "  [!] Der neue Stand läuft nicht – der bisherige kommt zurück."
  if [ "$HAS_UNIT" = 1 ]; then systemctl stop "$SERVICE" >/dev/null 2>&1 || true; fi
  if [ -e "$TARGET" ]; then
    cli "$TARGET" stop --timeout 60 >/dev/null 2>&1 || true
    failed="$TARGET.fehlgeschlagen-$(date +%Y%m%d-%H%M%S)"
    if ! mv "$TARGET" "$failed"; then
      say "  [!] $TARGET ließ sich nicht beiseitelegen – bitte von Hand:"
      say "      mv \"$TARGET\" \"$failed\" && mv \"$BACKUP\" \"$TARGET\" && systemctl start $SERVICE"
      return 0
    fi
  fi
  if ! mv "$BACKUP" "$TARGET"; then
    say "  [!] $BACKUP ließ sich nicht zurückschieben – bitte von Hand: mv \"$BACKUP\" \"$TARGET\" && systemctl start $SERVICE"
    return 0
  fi
  if [ -n "$DATA_INSIDE" ] && [ -n "$failed" ] && [ -e "$failed/$DATA_INSIDE" ] && [ ! -e "$TARGET/$DATA_INSIDE" ]; then
    mv "$failed/$DATA_INSIDE" "$TARGET/$DATA_INSIDE" || say "  [!] Das Datenverzeichnis liegt noch in $failed/$DATA_INSIDE – bitte nach $TARGET/$DATA_INSIDE verschieben."
  fi
  if database_newer "$TARGET"; then
    name="$(update_backup "$STARTED_AT")"
    if [ -n "$name" ]; then
      restore_database "$TARGET" "$name" || say "    [!] Die Datenbank ließ sich nicht zurückspielen."
    else
      say "    [!] Die Datenbank wurde umgestellt, eine Sicherung von diesem Update fand sich aber nicht in $DATA_DIR/backups."
      say "        Von Hand: cd $TARGET && npm run cli -- backup:list   und   npm run cli -- restore <sicherung>"
    fi
  fi
  if [ "$HAS_UNIT" = 1 ]; then
    systemctl start "$SERVICE" >/dev/null 2>&1 || true
    if wait_healthy "$TARGET"; then
      say "  Der bisherige Stand läuft wieder: $(describe "$TARGET")"
    else
      say "  [!] Der bisherige Stand antwortet (noch) nicht – Protokoll: journalctl -u $SERVICE -n 50"
    fi
  else
    say "  Der bisherige Stand liegt wieder in $TARGET – Knowstead bitte wie gewohnt starten."
  fi
  if [ -n "$failed" ]; then say "  Der gescheiterte Stand liegt zur Fehlersuche in $failed"; fi
}

on_exit() {
  local code=$?
  set +e
  trap '' INT TERM
  if [ "$code" -ne 0 ] && [ "$SWAPPED" = 1 ]; then
    rollback
  elif [ "$code" -ne 0 ] && [ "$STOPPED" = 1 ] && [ "$HAS_UNIT" = 1 ]; then
    printf '\n  Abgebrochen, bevor der Programmordner getauscht war – der Dienst wird wieder gestartet.\n' >&2
    systemctl start "$SERVICE" >/dev/null 2>&1
  fi
  # Bereitgelegtes, das nicht mehr gebraucht wird
  if [ "$code" -ne 0 ] && [ -n "$STAGED_DIR" ] && [ -d "$STAGED_DIR" ]; then
    case "$STAGED_DIR" in "$TARGET".neu) rm -rf "$STAGED_DIR" ;; esac
  fi
  if [ -n "$STAGED" ] && [ -d "$STAGED" ]; then
    case "$STAGED" in "$TARGET".update-*) rm -rf "$STAGED" ;; esac
  fi
  if [ -n "$RUNNER" ]; then rm -f "$RUNNER" 2>/dev/null; fi
  return 0
}

# ------------------------------------------------------------------ Zurück zum Stand davor
go_back() {
  local previous set_aside restore_from="" since
  previous="$(ls -1dt "$TARGET".vor-* 2>/dev/null | head -n 1 || true)"
  if [ -z "$previous" ] || [ ! -f "$previous/server/src/cli.ts" ]; then fail "Neben $TARGET liegt kein früherer Programmordner (….vor-<version>)."; fi

  # Kann der frühere Stand mit der Datenbank arbeiten? Hat das Update sie umgestellt, braucht er die von davor –
  # das klärt sich, bevor irgendetwas angefasst wird.
  if database_newer "$previous"; then
    since="$(stat -c %Y "$previous" 2>/dev/null || echo 0)"
    restore_from="$(update_backup "$since")"
    if [ -z "$restore_from" ]; then
      fail "Die Datenbank wurde seit dem früheren Stand umgestellt, und die Sicherung von diesem Update liegt nicht mehr
      in $DATA_DIR/backups. Der frühere Stand kann mit der jetzigen Datenbank nicht arbeiten – es wurde nichts verändert.
      Vorhandene Sicherungen: cd $TARGET && npm run cli -- backup:list"
    fi
  fi

  say ""
  say "  Zurück von  $(describe "$TARGET")"
  say "        auf   $(describe "$previous")   ($previous)"
  if [ -n "$restore_from" ]; then
    say ""
    say "  [!] Das Update hat die Datenbank umgestellt – der frühere Stand braucht die Datenbank von davor."
    say "      Sie wird aus der Sicherung $restore_from zurückgespielt: Was seit dem Update eingetragen"
    say "      wurde, ist danach nicht mehr zu sehen. Der jetzige Stand wird vorher zusätzlich gesichert."
  fi
  confirm "Jetzt zurückkehren? Knowstead ist dabei kurz nicht erreichbar." n || { say "  Abgebrochen."; return 0; }

  set_aside="$TARGET.zurueckgenommen-$(date +%Y%m%d-%H%M%S)"
  if [ -e "$set_aside" ]; then fail "$set_aside gibt es schon – bitte in einer Minute noch einmal."; fi
  step "Dienst anhalten"
  if [ "$DRY_RUN" = 0 ]; then STOPPED=1; fi
  stop_knowstead "$TARGET"
  if [ -n "$restore_from" ]; then
    # Vor dem Tausch: Scheitert es, bleibt alles beim jetzigen Stand
    step "Datenbank auf den Stand vor dem Update bringen"
    if [ "$DRY_RUN" = 1 ]; then
      say "    (Probelauf) node server/src/cli.ts restore $restore_from"
    else
      restore_database "$previous" "$restore_from" || fail "Die Datenbank ließ sich nicht zurückspielen – es bleibt beim jetzigen Stand."
    fi
  fi
  step "Programmordner tauschen"
  run mv "$TARGET" "$set_aside"
  if ! run mv "$previous" "$TARGET"; then
    mv "$set_aside" "$TARGET" || true
    fail "$previous ließ sich nicht nach $TARGET schieben."
  fi
  if [ "$DRY_RUN" = 1 ]; then
    say ""
    say "  Probelauf beendet – nichts wurde verändert."
    return 0
  fi
  if [ -n "$DATA_INSIDE" ] && [ -e "$set_aside/$DATA_INSIDE" ] && [ ! -e "$TARGET/$DATA_INSIDE" ]; then
    mkdir -p "$(dirname "$TARGET/$DATA_INSIDE")"
    mv "$set_aside/$DATA_INSIDE" "$TARGET/$DATA_INSIDE"
  fi
  step "Dienst starten"
  start_knowstead
  STOPPED=0
  if [ "$HAS_UNIT" = 1 ]; then
    wait_healthy "$TARGET" || fail "Der frühere Stand antwortet nicht – Protokoll: journalctl -u $SERVICE -n 50
      Der zurückgenommene Stand liegt in $set_aside"
  else
    say "    Kein systemd-Dienst »$SERVICE« gefunden – Knowstead bitte jetzt wie gewohnt starten (z. B. bash start.sh)."
  fi
  say ""
  say "  Fertig: $(describe "$TARGET") läuft wieder."
  say "  Der zurückgenommene Stand liegt in $set_aside"
}

# ------------------------------------------------------------------ Paket prüfen, auspacken, an das neue Skript übergeben
unpack_and_continue() {
  local actual expected stage
  [ -f "$ARCHIVE" ] || fail "Paket nicht gefunden: $ARCHIVE"
  step "Paket prüfen"
  expected="$SHA256"
  actual="$(sha256sum "$ARCHIVE" | cut -d' ' -f1)"
  if [ -z "$expected" ] && [ -f "$ARCHIVE.sha256" ]; then expected="$(sed -n '1s/[[:space:]].*//p' "$ARCHIVE.sha256")"; fi
  if [ -n "$expected" ]; then
    if [ "$actual" != "$(printf '%s' "$expected" | tr 'A-F' 'a-f')" ]; then
      fail "Die Prüfsumme stimmt nicht – das Paket ist beschädigt oder ein anderes.
      erwartet: $expected
      gefunden: $actual"
    fi
    say "    Prüfsumme stimmt: $actual"
  else
    say "    Prüfsumme (nicht verglichen – keine .sha256-Datei neben dem Paket, kein --sha256): $actual"
  fi
  step "Paket auspacken"
  # Neben dem Ziel: gleiches Laufwerk, der spätere Tausch ist dann nur ein Umbenennen
  stage="$TARGET.update-$$"
  if [ "$DRY_RUN" = 1 ]; then
    say "    (Probelauf) tar -xzf $ARCHIVE nach $stage – danach übernimmt das update.sh aus dem neuen Paket"
    say ""
    say "  Bisher:  $(describe "$TARGET")   in $TARGET"
    say "  Probelauf beendet – nichts wurde verändert."
    return 0
  fi
  STAGED="$stage"
  rm -rf "$stage"
  mkdir -p "$stage/neu"
  # Über die Standardeingabe: tar hielte einen Dateinamen mit Doppelpunkt sonst für einen anderen Rechner
  tar -xz -f - -C "$stage/neu" --strip-components=1 --no-same-owner < "$ARCHIVE" || fail "Das Paket ließ sich nicht auspacken."
  if [ ! -f "$stage/neu/update.sh" ] || [ -z "$(package_info "$stage/neu")" ]; then
    fail "Das ist kein Knowstead-Installationspaket ab Version 1.8.0 (update.sh oder .knowstead-package.json fehlt)."
  fi
  # Ab hier arbeitet das Skript des neuen Pakets – es kennt dessen Eigenheiten. Es läuft aus einer eigenen Kopie:
  # Der Ordner, in dem es im Paket liegt, wird gleich verschoben.
  RUNNER="$(mktemp "${TMPDIR:-/tmp}/knowstead-update.XXXXXX")"
  cp "$stage/neu/update.sh" "$RUNNER"
  trap - EXIT
  exec bash "$RUNNER" --staged "$stage" --package "$stage/neu" --runner "$RUNNER" --target "$TARGET" ${PASS[@]+"${PASS[@]}"}
}

# ------------------------------------------------------------------ Dieses Paket einspielen
install_this_package() {
  local NEW="${PACKAGE:-$SELF_DIR}" platform arch machine major old_desc new_desc new_version plugin old kept entry content extras="" sudo=""
  local info
  info="$(package_info "$NEW")"
  if [ -z "$info" ] || [ ! -f "$NEW/server/src/index.ts" ]; then
    fail "Aufruf: bash update.sh <paket.tar.gz>   (oder das update.sh eines entpackten Installationspakets starten)"
  fi
  if [ -f "$NEW/.env" ] || [ "$NEW" = "$TARGET" ]; then fail "Dieser Ordner ist selbst eine Installation. Aufruf: bash update.sh <paket.tar.gz>"; fi
  [ -d "$NEW/node_modules" ] || fail "Im Paket fehlen die Abhängigkeiten (node_modules) – bitte ein fertiges Installationspaket verwenden."
  platform="$(json_field "$info" platform)"
  arch="$(json_field "$info" arch)"
  machine="$(uname -m)"
  case "$machine" in x86_64 | amd64) machine=x64 ;; aarch64 | arm64) machine=arm64 ;; esac
  if [ "$platform" != linux ] || { [ -n "$arch" ] && [ "$arch" != "$machine" ]; }; then
    fail "Das Paket ist für ${platform:-?}-${arch:-?} gebaut, dieser Rechner ist linux-$machine."
  fi
  major="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
  [ "$major" -ge 24 ] || fail "Node.js 24 oder neuer wird benötigt (gefunden: $("$NODE_BIN" -v))."

  old_desc="$(describe "$TARGET")"
  new_desc="$(describe "$NEW")"
  new_version="$(json_field "$NEW/package.json" version)"
  say ""
  say "  Bisher:  $old_desc   in $TARGET"
  say "  Neu:     $new_desc"
  say "  Daten:   $DATA_DIR${DATA_INSIDE:+   (liegt im Programmordner und zieht mit um)}"
  if [ "$old_desc" = "$new_desc" ] && [ "$FORCE" = 0 ]; then
    say ""
    say "  Dieser Stand ist bereits installiert – nichts zu tun (erzwingen mit --force)."
    return 0
  fi
  confirm "Jetzt aktualisieren? Knowstead ist dabei kurz nicht erreichbar." j || { say "  Abgebrochen."; return 0; }

  # 1. Neues Programm neben das alte legen – Knowstead läuft so lange weiter
  step "Neues Programm bereitlegen"
  content="$NEW"
  if [ "$DRY_RUN" = 1 ]; then
    say "    (Probelauf) $NEW nach $TARGET.neu, dazu .env und eigene Plugins aus $TARGET"
  else
    STAGED_DIR="$TARGET.neu"
    rm -rf "$STAGED_DIR"
    if [ -n "$STAGED" ]; then mv "$NEW" "$STAGED_DIR"; else cp -a "$NEW" "$STAGED_DIR"; fi
    content="$STAGED_DIR"
    chown -R "$OWNER" "$STAGED_DIR" 2>/dev/null || true
    chmod -R go-w "$STAGED_DIR"
    # Erst danach: .env und eigene Plugins behalten Eigentümer, Gruppe und Rechte (die .env liest nur das Dienstkonto)
    cp -p "$TARGET/.env" "$STAGED_DIR/.env"
    if [ -d "$TARGET/plugins" ]; then
      for plugin in "$TARGET"/plugins/*; do
        [ -e "$plugin" ] || continue
        if [ ! -e "$STAGED_DIR/plugins/$(basename "$plugin")" ]; then
          mkdir -p "$STAGED_DIR/plugins"
          cp -a "$plugin" "$STAGED_DIR/plugins/"
        fi
      done
    fi
  fi
  # Was sonst noch im bisherigen Ordner liegt und das Paket nicht kennt (eigene Dateien): bleibt dort, wird aber genannt
  while IFS= read -r entry; do
    if [ -e "$content/$entry" ] || [ "$entry" = .env ] || [ "$entry" = "${DATA_INSIDE%%/*}" ]; then continue; fi
    # Dateien der Pakete bis 1.9, die heute anders heißen, sind keine eigenen Dateien
    case "$entry" in Doku-Dienst.cmd | Doku-Installation.cmd) continue ;; esac
    extras="$extras $entry"
  done < <(ls -1A "$TARGET")

  # 2. Anhalten, tauschen, starten – ab hier zählt jede Sekunde
  BACKUP="$TARGET.vor-$new_version"
  if [ -e "$BACKUP" ]; then BACKUP="$BACKUP-$(date +%Y%m%d-%H%M%S)"; fi
  STARTED_AT="$(date +%s)"
  step "Dienst anhalten"
  if [ "$DRY_RUN" = 0 ]; then STOPPED=1; fi
  stop_knowstead "$TARGET"
  step "Programmordner tauschen"
  run mv "$TARGET" "$BACKUP"
  if [ "$DRY_RUN" = 0 ]; then SWAPPED=1; fi
  run mv "${STAGED_DIR:-$TARGET.neu}" "$TARGET"
  if [ -n "$DATA_INSIDE" ] && { [ "$DRY_RUN" = 1 ] || [ -e "$BACKUP/$DATA_INSIDE" ]; }; then
    run mkdir -p "$(dirname "$TARGET/$DATA_INSIDE")"
    run mv "$BACKUP/$DATA_INSIDE" "$TARGET/$DATA_INSIDE"
  fi
  # Der jüngste Tausch soll auch der jüngste Ordner sein (Reihenfolge beim Aufräumen und Zurückkehren)
  run touch "$BACKUP"
  step "Dienst starten"
  start_knowstead
  if [ "$DRY_RUN" = 1 ]; then
    if [ -n "$extras" ]; then say "    Nur im bisherigen Ordner, würde nicht übernommen:$extras"; fi
    say ""
    say "  Probelauf beendet – nichts wurde verändert."
    return 0
  fi

  # 3. Läuft der neue Stand?
  if [ "$HAS_UNIT" = 1 ]; then
    step "Prüfen, ob der neue Stand läuft"
    if ! wait_healthy "$TARGET"; then
      # Was die Prüfung sieht und was der Server zuletzt gemeldet hat – danach ist das Protokoll vom bisherigen Stand überlagert
      cli "$TARGET" doctor 2>&1 | sed 's/^/    /' || true
      if command -v journalctl >/dev/null 2>&1; then
        say "    Letzte Meldungen des Dienstes (journalctl -u $SERVICE):"
        journalctl -u "$SERVICE" -n 15 --no-pager 2>/dev/null | cut -c1-600 | sed 's/^/      /' || true
      fi
      exit 1
    fi
    say "    $(describe "$TARGET") läuft und antwortet."
  else
    say "    Kein systemd-Dienst »$SERVICE« gefunden – Knowstead bitte jetzt wie gewohnt starten (z. B. bash start.sh)."
  fi
  SWAPPED=0
  STOPPED=0
  STAGED_DIR=""

  # 4. Nacharbeiten: Handbuch ergänzen, ältere Programmordner und Reste früherer Versuche aufräumen
  if [ "$HANDBOOK" = 1 ] && [ "$HAS_UNIT" = 1 ]; then
    step "Handbuch ergänzen"
    cli "$TARGET" handbook:sync 2>&1 | sed 's/^/    /' || say "    [!] Das Handbuch ließ sich nicht ergänzen – später unter Administration → Wartung nachholen."
  fi
  kept=0
  while IFS= read -r old; do
    kept=$((kept + 1))
    if [ "$kept" -gt "$KEEP" ]; then
      step "Älteren Programmordner entfernen: $old"
      case "$old" in "$TARGET".vor-*) rm -rf "$old" ;; esac
    fi
  done < <(ls -1dt "$TARGET".vor-* 2>/dev/null || true)
  for old in "$TARGET".fehlgeschlagen-* "$TARGET".zurueckgenommen-* "$TARGET".update-*; do
    if [ ! -d "$old" ] || [ "$old" = "$STAGED" ]; then continue; fi
    step "Rest eines früheren Versuchs entfernen: $old"
    rm -rf "$old"
  done

  if command -v sudo >/dev/null 2>&1; then sudo="sudo "; fi
  say ""
  say "  Fertig: $(describe "$TARGET")"
  if [ -d "$BACKUP" ]; then
    say "  Der bisherige Stand liegt in $BACKUP"
    say "  Zurück zum Stand davor:  ${sudo}bash $TARGET/update.sh --rollback"
  fi
  if [ -n "$extras" ]; then
    say "  Nur im bisherigen Ordner, nicht übernommen:$extras"
    say "    Bei Bedarf herüberkopieren, z. B.: cp -a \"$BACKUP/<name>\" \"$TARGET/\""
  fi
  say ""
}

main "$@"; exit $?

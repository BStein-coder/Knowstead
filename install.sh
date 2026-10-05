#!/usr/bin/env bash
# ---------------------------------------------------------------------------------------------
#  Knowstead installieren, Einstellungen ändern oder Update abschließen (Linux)
#
#  Geführt:          sudo bash install.sh
#  Ohne Rückfragen:  sudo bash install.sh --unattended --data-dir /var/lib/knowstead \
#                         --base-url https://knowstead.firma.de --access local-proxy
#  Probelauf:        bash install.sh --unattended --dry-run
#  Autostart weg:    sudo bash install.sh --uninstall
#
#  Richtet ein: Node.js 24 (auf Wunsch), Systemkonto, Datenverzeichnis, .env, Abhängigkeiten und
#  Oberfläche, Probestart, systemd-Dienst mit Härtung, Firewall (ufw/firewalld) und – auf Wunsch
#  samt Installation über die Paketverwaltung – Tesseract (Texterkennung) und LibreOffice
#  (Office-Vorschau). Läuft auch in LXC-Containern (Proxmox). Programm und Daten bleiben beim
#  Entfernen erhalten.
#
#  Zusatzprogramme nachrüsten:  sudo bash install.sh --unattended --install-ocr --install-office
# ---------------------------------------------------------------------------------------------
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

UNATTENDED=0
INSTALL_NODE=0
DRY_RUN=0
UNINSTALL=0
SKIP_PREPARE=0
DATA_DIR=""
PORT=""
BASE_URL=""
ACCESS=""
PROXY_ADDRESS=""
SERVICE=""
RUN_USER=""
OCR_PATH=""
OFFICE_PATH=""
INSTALL_OCR=0
INSTALL_OFFICE=0
OCR_LANGS=""
# Dienst »knowstead« – oder der bestehende Dienst »doku« einer Installation aus der Zeit vor der Umbenennung
# (bis 1.9): Sie behält Dienst, Konto und Datenverzeichnis. Ein zweiter Dienst daneben würde sich mit ihr um
# Port und Datenbank streiten. Abweichender Ort nur für die Prüfung der Routine ohne Root-Rechte
# (server/test/install-extras.test.ts).
UNIT_DIR="${KNOWSTEAD_UNIT_DIR:-/etc/systemd/system}"
if [ -n "${KNOWSTEAD_UNIT_FILE:-}" ]; then
  UNIT_FILE="$KNOWSTEAD_UNIT_FILE"
elif [ ! -f "$UNIT_DIR/knowstead.service" ] && [ -f "$UNIT_DIR/doku.service" ]; then
  UNIT_FILE="$UNIT_DIR/doku.service"
else
  UNIT_FILE="$UNIT_DIR/knowstead.service"
fi
SERVICE_NAME="$(basename "$UNIT_FILE" .service)"
# Für den Neustart mit sudo (die Schleife unten verbraucht die Argumente)
ORIGINAL_ARGS=("$@")

usage() {
  sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'
Optionen:
  --unattended                 ohne Rückfragen (nicht angegebene Werte aus .env bzw. Standard)
  --install-node               Node.js 24 bei Bedarf aus der Paketquelle von NodeSource installieren (apt/dnf)
  --data-dir <pfad>            Datenverzeichnis (Standard /var/lib/knowstead)
  --port <zahl>                Port (Standard 3000)
  --base-url <url>             öffentliche Adresse, z. B. https://knowstead.firma.de
  --access <art>               local-proxy (Proxy auf diesem Server, empfohlen) | remote-proxy | direct
  --proxy-address <ip>         Adresse des Proxys bei remote-proxy
  --service <art>              systemd (Standard) | none
  --user <konto>               Systemkonto für den Dienst (Standard knowstead)
  --install-ocr                Texterkennung: Tesseract samt Sprachdaten bei Bedarf installieren (apt/dnf) und einschalten
  --ocr-languages <kürzel>     Sprachen der Texterkennung als Tesseract-Kürzel, z. B. deu+eng (Standard) oder deu+eng+fra
  --install-office             Office-Vorschau: LibreOffice ohne Oberfläche bei Bedarf installieren (apt/dnf) und einschalten
  --ocr-path <pfad>            vorhandenes Tesseract eintragen und Texterkennung einschalten
  --office-path <pfad>         vorhandenes LibreOffice (soffice) eintragen und Office-Vorschau einschalten
  --skip-prepare               Abhängigkeiten/Oberfläche nicht prüfen (fertiges Installationspaket)
  --dry-run                    nur anzeigen, was geschehen würde
  --uninstall                  systemd-Dienst und Firewall-Regel entfernen (Daten bleiben)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --unattended) UNATTENDED=1 ;;
    --install-node) INSTALL_NODE=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    --skip-prepare) SKIP_PREPARE=1 ;;
    --data-dir) DATA_DIR="$2"; shift ;;
    --port) PORT="$2"; shift ;;
    --base-url) BASE_URL="$2"; shift ;;
    --access) ACCESS="$2"; shift ;;
    --proxy-address) PROXY_ADDRESS="$2"; shift ;;
    --service) SERVICE="$2"; shift ;;
    --user) RUN_USER="$2"; shift ;;
    --install-ocr) INSTALL_OCR=1 ;;
    --install-office) INSTALL_OFFICE=1 ;;
    --ocr-languages) OCR_LANGS="$2"; shift ;;
    --ocr-path) OCR_PATH="$2"; shift ;;
    --office-path) OFFICE_PATH="$2"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unbekannte Option: $1" >&2; usage; exit 2 ;;
  esac
  shift
done

# Konto des Dienstes: wie angegeben, sonst das des bestehenden Dienstes, sonst »knowstead«
if [ -z "$RUN_USER" ] && [ -f "$UNIT_FILE" ]; then RUN_USER="$(sed -n 's/^User=//p' "$UNIT_FILE" | tail -n 1)"; fi
RUN_USER="${RUN_USER:-knowstead}"

say() { printf '%s\n' "$*"; }
step() { printf '\n  ▸ %s\n' "$*"; }
fail() { printf '\n  [!] %s\n' "$*" >&2; exit 1; }
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '    (Probelauf) %s\n' "$*"; else "$@"; fi
}

# Hinweise zu den Zusatzprogrammen: Sie halten die Installation nicht auf und stehen am Ende noch einmal.
NOTES=""
note() { NOTES="$NOTES$*"$'\n'; }

# Geht nach dem Anhalten des Dienstes etwas schief, soll ein Update kein stehendes Knowstead hinterlassen:
# Der Dienst lief vorher, also wird er wieder gestartet.
SERVICE_STOPPED=0
REPORT=""
on_exit() {
  local code=$?
  if [ -n "$REPORT" ]; then rm -f "$REPORT"; fi
  if [ "$code" -ne 0 ] && [ "$SERVICE_STOPPED" = 1 ]; then
    printf '\n  Die Einrichtung wurde nicht abgeschlossen. Der Dienst »%s« lief vorher – er wird wieder gestartet.\n' "$SERVICE_NAME" >&2
    if systemctl start "$SERVICE_NAME" >/dev/null 2>&1; then
      printf '  Dienst gestartet. Bitte die Ursache oben beheben und install.sh erneut ausführen.\n' >&2
    else
      printf '  [!] Der Dienst ließ sich nicht starten – Protokoll: journalctl -u %s -n 50\n' "$SERVICE_NAME" >&2
    fi
  fi
  return 0
}
trap on_exit EXIT

# Tesseract und LibreOffice: Paketnamen je Distribution, Installation, Sprachdaten
# shellcheck source=scripts/install/linux/extras.sh
. "$ROOT/scripts/install/linux/extras.sh"

# Wert aus der vorhandenen .env lesen (ohne sie auszuführen)
env_value() {
  [ -f "$ROOT/.env" ] || return 0
  sed -n "s/^[[:space:]]*\(export[[:space:]]\+\)\{0,1\}$1[[:space:]]*=[[:space:]]*//p" "$ROOT/.env" | tail -n 1 | sed -e "s/^'\(.*\)'$/\1/" -e 's/^"\(.*\)"$/\1/' -e 's/[[:space:]]\+#.*$//'
}

if [ "$DRY_RUN" = 0 ] && [ "$(id -u)" -ne 0 ]; then
  if command -v sudo >/dev/null 2>&1; then
    say "Für Dienst, Konto und Firewall sind Root-Rechte nötig – Neustart mit sudo …"
    exec sudo bash "$0" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
  fi
  fail "Bitte als root ausführen (sudo bash install.sh)."
fi

# Frisch entpacktes Paket, der Dienst zeigt aber auf eine Installation in einem anderen Ordner: Hier neu
# einzurichten hieße, den Dienst auf einen leeren Stand umzubiegen – das Wiki sähe aus wie verloren.
if [ "$UNINSTALL" = 0 ] && [ ! -f "$ROOT/.env" ] && [ -f "$UNIT_FILE" ]; then
  installed="$(sed -n 's/^WorkingDirectory=//p' "$UNIT_FILE" | tail -n 1)"
  installed="${installed%/}"
  if [ -n "$installed" ] && [ "$installed" != "$ROOT" ] && [ -f "$installed/.env" ]; then
    fail "Auf diesem Rechner ist Knowstead bereits eingerichtet: Dienst »$SERVICE_NAME«, Programmordner $installed.
      Aktualisieren:  bash $ROOT/update.sh
      Soll stattdessen dieser Ordner die Installation ablösen, zuerst deren Einstellungen übernehmen
      (cp -p $installed/.env $ROOT/.env) und install.sh erneut starten."
  fi
fi

# ------------------------------------------------------------------------------ Entfernen
if [ "$UNINSTALL" = 1 ]; then
  step "Autostart entfernen"
  if [ -f "$UNIT_FILE" ]; then
    run systemctl disable --now "$SERVICE_NAME"
    run rm -f "$UNIT_FILE"
    run systemctl daemon-reload
  else
    say "    Kein systemd-Dienst »$SERVICE_NAME« eingerichtet."
  fi
  port="$(env_value PORT)"; port="${port:-3000}"
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
    # Regeln mit dem Vermerk »knowstead« – und »doku« aus der Zeit vor der Umbenennung
    while ufw status numbered 2>/dev/null | grep -Eq "# (knowstead|doku)\b"; do
      num="$(ufw status numbered | grep -E '# (knowstead|doku)\b' | head -n1 | sed 's/^\[\s*\([0-9]\+\)\].*/\1/')"
      run ufw --force delete "$num"
      [ "$DRY_RUN" = 1 ] && break
    done
  fi
  say "    Programm ($ROOT) und Daten ($(env_value DATA_DIR)) bleiben erhalten."
  exit 0
fi

# ------------------------------------------------------------------------------ Voraussetzungen
step "Voraussetzungen"
node_ready() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 24 ]; }

# Node.js 24 aus der offiziellen Paketquelle von NodeSource (Debian/Ubuntu bzw. RHEL/Rocky)
install_node() {
  step "Node.js 24 installieren (Paketquelle von NodeSource)"
  local setup
  local -a packages
  if command -v apt-get >/dev/null 2>&1; then
    run apt-get update
    run apt-get install -y ca-certificates curl
    setup="https://deb.nodesource.com/setup_24.x"
    packages=(apt-get install -y nodejs)
  elif command -v dnf >/dev/null 2>&1; then
    command -v curl >/dev/null 2>&1 || run dnf install -y curl
    setup="https://rpm.nodesource.com/setup_24.x"
    packages=(dnf install -y nodejs)
  else
    fail "Keine Paketverwaltung (apt-get/dnf) gefunden – bitte Node.js 24 selbst installieren: https://nodejs.org/"
  fi
  if [ "$DRY_RUN" = 1 ]; then
    say "    (Probelauf) curl -fsSL $setup | bash -"
  elif ! curl -fsSL "$setup" | bash -; then
    fail "Die Paketquelle von NodeSource ließ sich nicht einrichten – besteht Internetzugang?"
  fi
  run "${packages[@]}"
  hash -r
}

if ! node_ready; then
  found="$(command -v node >/dev/null 2>&1 && node -v || echo "nicht installiert")"
  if [ "$INSTALL_NODE" = 0 ] && [ "$UNATTENDED" = 0 ] && [ -t 0 ]; then
    question="Knowstead braucht Node.js 24 oder neuer (gefunden: $found). Jetzt aus der offiziellen Paketquelle von NodeSource installieren?"
    if command -v whiptail >/dev/null 2>&1; then
      whiptail --backtitle "Knowstead – Installation" --title "Node.js" --yesno "$question" 10 76 && INSTALL_NODE=1
    else
      read -r -p "  $question (j/n) [j]: " answer
      case "${answer:-j}" in j|J|y|Y) INSTALL_NODE=1 ;; esac
    fi
  fi
  [ "$INSTALL_NODE" = 1 ] && install_node
  if [ "$DRY_RUN" = 1 ] && [ "$INSTALL_NODE" = 1 ] && ! node_ready; then
    say "    (Probelauf) Die weiteren Schritte brauchen Node.js – der Probelauf endet hier."
    exit 0
  fi
  node_ready || fail "Node.js 24 oder neuer wird benötigt (gefunden: $found). Installation mit: bash install.sh --install-node
      oder von Hand – Debian/Ubuntu:  apt-get install -y curl && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs
                     RHEL/Rocky:     curl -fsSL https://rpm.nodesource.com/setup_24.x | bash - && dnf install -y nodejs"
fi
NODE_BIN="$(command -v node)"
say "    Node.js $("$NODE_BIN" -v) ($NODE_BIN)"

# Vorgaben aus einer vorhandenen Installation
existing_host="$(env_value HOST)"
existing_trust="$(env_value TRUST_PROXY)"
DATA_DIR="${DATA_DIR:-$(env_value DATA_DIR)}"; DATA_DIR="${DATA_DIR:-/var/lib/knowstead}"
PORT="${PORT:-$(env_value PORT)}"; PORT="${PORT:-3000}"
if [ -z "$ACCESS" ]; then
  if [ ! -f "$ROOT/.env" ] || [ "$existing_host" = "127.0.0.1" ]; then ACCESS="local-proxy"
  elif [ -n "$existing_trust" ] && [ "$existing_trust" != "false" ] && [ "$existing_trust" != "loopback" ]; then ACCESS="remote-proxy"; PROXY_ADDRESS="${PROXY_ADDRESS:-$existing_trust}"
  else ACCESS="direct"; fi
fi
HOSTNAME_FQDN="$(hostname -f 2>/dev/null || hostname)"
default_url() { if [ "$ACCESS" = "direct" ]; then echo "http://$HOSTNAME_FQDN:$PORT"; else echo "https://$HOSTNAME_FQDN"; fi; }
BASE_URL="${BASE_URL:-$(env_value BASE_URL)}"
if [ -z "$SERVICE" ]; then if [ -f "$UNIT_FILE" ] || [ ! -f "$ROOT/.env" ]; then SERVICE="systemd"; else SERVICE="none"; fi; fi
detected_ocr="$(command -v tesseract || true)"
detected_office="$(extras_find_office)"
OCR_LANGS_GIVEN="$OCR_LANGS"
OCR_LANGS="${OCR_LANGS:-deu+eng}"
extras_valid_languages "$OCR_LANGS" || fail "Sprachen der Texterkennung bitte als Tesseract-Kürzel angeben, z. B. deu+eng (--ocr-languages)."
PKG="$(extras_pkg_manager)"
# Tesseract ist da, aber nicht jede gewünschte Sprache? Dann lohnt das Nachinstallieren der Sprachdaten.
missing_langs=""
[ -n "$detected_ocr" ] && missing_langs="$(extras_missing_languages "$OCR_LANGS" "$detected_ocr")"

# Fragen zu den Zusatzprogrammen – für beide Arten der Abfrage (Dialog und Zeile) dieselben.
# yesno <text mit \n> <vorgabe j|n> liefert 0 bei Ja.
ask_extras() {
  if [ -n "$detected_ocr" ] && [ -z "$missing_langs" ]; then
    yesno "Tesseract gefunden ($detected_ocr).\nTexterkennung für eingescannte PDFs und Bilder einschalten?" j && OCR_PATH="$detected_ocr"
  elif [ -n "$detected_ocr" ] && [ -n "$PKG" ]; then
    yesno "Tesseract gefunden ($detected_ocr), es fehlen aber Sprachdaten für: ${missing_langs//+/, }.\nSprachdaten nachinstallieren und Texterkennung einschalten?" j && INSTALL_OCR=1
  elif [ -n "$detected_ocr" ]; then
    yesno "Tesseract gefunden ($detected_ocr), es fehlen aber Sprachdaten für: ${missing_langs//+/, }.\nTexterkennung mit den vorhandenen Sprachen einschalten?" j && OCR_PATH="$detected_ocr"
  elif [ -n "$PKG" ]; then
    yesno "Texterkennung (OCR) installieren?\nTesseract macht eingescannte PDFs und Bilder durchsuchbar. Installiert werden Tesseract und die Sprachdaten ${OCR_LANGS//+/, } aus der Paketquelle der Distribution (rund 25 MB)." j && INSTALL_OCR=1
  fi
  if [ -n "$detected_office" ]; then
    yesno "LibreOffice gefunden ($detected_office).\nVorschau für Office- und Visio-Dateien einschalten?" j && OFFICE_PATH="$detected_office"
  elif [ -n "$PKG" ]; then
    yesno "LibreOffice installieren?\nDamit zeigt Knowstead Word-, Excel-, PowerPoint- und Visio-Dateien als Vorschau im Browser. Installiert wird LibreOffice ohne grafische Oberfläche aus der Paketquelle der Distribution (rund 400 MB)." n && INSTALL_OFFICE=1
  fi
  return 0
}

# ------------------------------------------------------------------------------ Abfragen
if [ "$UNATTENDED" = 0 ]; then
  if command -v whiptail >/dev/null 2>&1 && [ -t 0 ]; then
    W=(whiptail --backtitle "Knowstead – Installation" --title "Knowstead installieren")
    ask() { "${W[@]}" --inputbox "$1" 12 76 "$2" 3>&1 1>&2 2>&3; }
    "${W[@]}" --msgbox "Dieser Assistent richtet Knowstead ein: Datenverzeichnis, Konfiguration, systemd-Dienst, Firewall und Zusatzprogramme. Danach folgt die Ersteinrichtung im Browser.\n\nProgrammordner: $ROOT\nNode.js: $("$NODE_BIN" -v)" 14 76
    DATA_DIR="$(ask "Datenverzeichnis (lokales Laufwerk, außerhalb des Programmordners):" "$DATA_DIR")" || exit 1
    ACCESS="$("${W[@]}" --radiolist "Wie erreichen die Nutzenden Knowstead?" 14 76 3 \
      local-proxy "Reverse-Proxy auf diesem Server (empfohlen)" "$([ "$ACCESS" = local-proxy ] && echo ON || echo OFF)" \
      remote-proxy "Reverse-Proxy auf einem anderen Rechner" "$([ "$ACCESS" = remote-proxy ] && echo ON || echo OFF)" \
      direct "Direkt im Netzwerk ohne HTTPS (nur Tests)" "$([ "$ACCESS" = direct ] && echo ON || echo OFF)" 3>&1 1>&2 2>&3)" || exit 1
    if [ "$ACCESS" = "remote-proxy" ]; then PROXY_ADDRESS="$(ask "IP-Adresse des Reverse-Proxys:" "$PROXY_ADDRESS")" || exit 1; fi
    PORT="$(ask "Interner Port von Knowstead:" "$PORT")" || exit 1
    BASE_URL="$(ask "Adresse für die Nutzenden (steht in Links und E-Mails):" "${BASE_URL:-$(default_url)}")" || exit 1
    SERVICE="$("${W[@]}" --radiolist "Autostart" 12 76 2 \
      systemd "systemd-Dienst »$SERVICE_NAME« (empfohlen)" "$([ "$SERVICE" = systemd ] && echo ON || echo OFF)" \
      none "Kein Autostart (Start von Hand mit start.sh)" "$([ "$SERVICE" = none ] && echo ON || echo OFF)" 3>&1 1>&2 2>&3)" || exit 1
    yesno() { if [ "$2" = n ]; then "${W[@]}" --defaultno --yesno "$1" 13 76; else "${W[@]}" --yesno "$1" 13 76; fi; }
    ask_extras
  else
    prompt() { local answer; read -r -p "  $1 [$2]: " answer; echo "${answer:-$2}"; }
    say ""
    say "  Knowstead – Installation (Programmordner $ROOT)"
    DATA_DIR="$(prompt "Datenverzeichnis" "$DATA_DIR")"
    say "  Zugriff: 1 = Reverse-Proxy auf diesem Server (empfohlen), 2 = Proxy auf anderem Rechner, 3 = direkt ohne HTTPS"
    case "$(prompt "Auswahl" "$(case "$ACCESS" in remote-proxy) echo 2;; direct) echo 3;; *) echo 1;; esac)")" in
      2) ACCESS="remote-proxy"; PROXY_ADDRESS="$(prompt "IP-Adresse des Proxys" "$PROXY_ADDRESS")" ;;
      3) ACCESS="direct" ;;
      *) ACCESS="local-proxy" ;;
    esac
    PORT="$(prompt "Port" "$PORT")"
    BASE_URL="$(prompt "Adresse für die Nutzenden" "${BASE_URL:-$(default_url)}")"
    SERVICE="$(prompt "Autostart (systemd/none)" "$SERVICE")"
    yesno() { case "$(prompt "${1//\\n/ } (j/n)" "$2")" in j|J|y|Y|ja|Ja) return 0 ;; *) return 1 ;; esac; }
    ask_extras
  fi
fi
BASE_URL="${BASE_URL:-$(default_url)}"

case "$ACCESS" in
  local-proxy) LISTEN="127.0.0.1"; TRUST="loopback" ;;
  remote-proxy) [ -n "$PROXY_ADDRESS" ] || fail "Bitte --proxy-address angeben."; LISTEN="0.0.0.0"; TRUST="$PROXY_ADDRESS" ;;
  direct) LISTEN="0.0.0.0"; TRUST="false" ;;
  *) fail "Unbekannter Zugriff: $ACCESS (local-proxy, remote-proxy, direct)" ;;
esac
case "$SERVICE" in systemd|none) ;; *) fail "Unbekannter Autostart: $SERVICE (systemd, none)" ;; esac
case "$DATA_DIR" in /*) ;; *) fail "Bitte einen absoluten Pfad für das Datenverzeichnis angeben." ;; esac

say ""
say "  Datenverzeichnis:  $DATA_DIR"
say "  Adresse:           $BASE_URL"
say "  Port:              $PORT (lauscht auf $LISTEN, Proxy-Header von: $TRUST)"
say "  Autostart:         $SERVICE (Konto $RUN_USER)"
# Ohne Rückfragen: Was schon installiert ist, wird nur eingeschaltet
if [ "$INSTALL_OCR" = 1 ] && [ -n "$detected_ocr" ] && [ -z "$missing_langs" ]; then INSTALL_OCR=0; OCR_PATH="${OCR_PATH:-$detected_ocr}"; fi
if [ "$INSTALL_OFFICE" = 1 ] && [ -n "$detected_office" ]; then INSTALL_OFFICE=0; OFFICE_PATH="${OFFICE_PATH:-$detected_office}"; fi
if [ "$INSTALL_OCR" = 1 ] && [ -z "$PKG" ]; then say "  Texterkennung:     Installation hier nicht möglich (keine Paketverwaltung apt-get oder dnf)"
elif [ "$INSTALL_OCR" = 1 ]; then say "  Texterkennung:     wird installiert (Tesseract, Sprachen ${OCR_LANGS//+/, })"
elif [ -n "$OCR_PATH" ]; then say "  Texterkennung:     $OCR_PATH"; fi
if [ "$INSTALL_OFFICE" = 1 ] && [ -z "$PKG" ]; then say "  Office-Vorschau:   Installation hier nicht möglich (keine Paketverwaltung apt-get oder dnf)"
elif [ "$INSTALL_OFFICE" = 1 ]; then say "  Office-Vorschau:   wird installiert (LibreOffice ohne grafische Oberfläche)"
elif [ -n "$OFFICE_PATH" ]; then say "  Office-Vorschau:   $OFFICE_PATH"; fi

# ------------------------------------------------------------------------------ Ausführen
# Zusatzprogramme zuerst: Das Laden der Pakete dauert – so lange läuft ein vorhandener Dienst weiter.
# Scheitert die Installation (kein Internet, Paket fehlt), geht es ohne die Zusatzfunktion weiter.
EXTRAS_PENDING=""
if [ "$INSTALL_OCR" = 1 ]; then
  step "Texterkennung installieren (Tesseract, Sprachen ${OCR_LANGS//+/, })"
  if extras_install_ocr "$PKG" "$OCR_LANGS"; then
    OCR_PATH="$EXTRAS_OCR_PATH"
    OCR_LANGS_GIVEN="$OCR_LANGS"
    [ -z "$OCR_PATH" ] && EXTRAS_PENDING="$EXTRAS_PENDING Texterkennung"
  elif [ -n "$detected_ocr" ]; then
    # Tesseract war schon da, nur weitere Sprachdaten kamen nicht hinzu: mit den vorhandenen Sprachen einschalten.
    # Welche das sind, prüft der Installationskern – er meldet auch, was fehlt.
    OCR_PATH="$detected_ocr"
    OCR_LANGS_GIVEN="$OCR_LANGS"
  else
    note "Texterkennung: Tesseract wurde nicht installiert (Einzelheiten weiter oben)."
  fi
fi
if [ "$INSTALL_OFFICE" = 1 ]; then
  step "LibreOffice installieren (ohne grafische Oberfläche)"
  if extras_install_office "$PKG"; then
    OFFICE_PATH="$EXTRAS_OFFICE_PATH"
    [ -z "$OFFICE_PATH" ] && EXTRAS_PENDING="$EXTRAS_PENDING Office-Vorschau"
  else
    note "Office-Vorschau: LibreOffice wurde nicht installiert (Einzelheiten weiter oben)."
  fi
fi
# Nur im Probelauf: installiert wurde nichts, eingeschaltet würde es aber
[ -n "$EXTRAS_PENDING" ] && say "    (Probelauf) Danach eingeschaltet:$EXTRAS_PENDING"

if [ -f "$UNIT_FILE" ] && systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  step "Laufenden Dienst beenden"
  run systemctl stop "$SERVICE_NAME"
  if [ "$DRY_RUN" = 0 ]; then SERVICE_STOPPED=1; fi
fi

if [ "$SERVICE" = "systemd" ] && ! id -u "$RUN_USER" >/dev/null 2>&1; then
  step "Systemkonto »$RUN_USER« anlegen"
  run useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$RUN_USER"
fi

args=(scripts/install.mjs --data-dir "$DATA_DIR" --port "$PORT" --host "$LISTEN" --base-url "$BASE_URL" --trust-proxy "$TRUST" --service "$SERVICE")
[ "$SKIP_PREPARE" = 1 ] && args+=(--skip-prepare)
[ "$DRY_RUN" = 1 ] && args+=(--dry-run)
[ -n "$OCR_PATH" ] && args+=(--ocr-path "$OCR_PATH")
# Sprachen nur übergeben, wenn sie gewählt oder gerade installiert wurden – sonst bleibt die Einstellung der Administration
[ -n "$OCR_PATH" ] && [ -n "$OCR_LANGS_GIVEN" ] && args+=(--ocr-languages "$OCR_LANGS_GIVEN")
[ -n "$OFFICE_PATH" ] && args+=(--office-path "$OFFICE_PATH")
# Was sich bei den Zusatzprogrammen nicht eintragen ließ, schreibt der Installationskern in diese Datei
REPORT="$(mktemp 2>/dev/null || true)"
[ -n "$REPORT" ] && args+=(--report "$REPORT")
"$NODE_BIN" "${args[@]}"
if [ -n "$REPORT" ] && [ -s "$REPORT" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    if [ -n "$line" ]; then note "$line"; fi
  done < "$REPORT"
fi

if [ "$SERVICE" = "systemd" ]; then
  # Programm oder Daten unter /home: der Dienst braucht dort Lesezugriff (ProtectHome sperrt sonst alles)
  PROTECT_HOME="true"
  case "$ROOT/ $DATA_DIR/" in */home/*|*/root/*) PROTECT_HOME="read-only" ;; esac
  case "$DATA_DIR/" in /home/*|/root/*) fail "Das Datenverzeichnis unter /home oder /root ist für einen Dienst ungeeignet – bitte z. B. /var/lib/knowstead verwenden." ;; esac
  if [ "$DRY_RUN" = 0 ] && command -v runuser >/dev/null 2>&1 && ! runuser -u "$RUN_USER" -- test -r "$ROOT/server/src/index.ts"; then
    fail "Das Konto »$RUN_USER« kann den Programmordner $ROOT nicht lesen. Programm z. B. nach /opt/knowstead verschieben (sudo mv \"$ROOT\" /opt/knowstead) und dort erneut ausführen."
  fi

  step "Rechte setzen"
  # Programmdateien nur für den Besitzer beschreibbar – ein unter Windows gepacktes Archiv bringt sonst 666/777 mit
  run chmod -R go-w "$ROOT"
  run chown -R "$RUN_USER:$RUN_USER" "$DATA_DIR"
  run chmod 750 "$DATA_DIR"
  if [ -f "$ROOT/.env" ]; then run chgrp "$RUN_USER" "$ROOT/.env"; run chmod 640 "$ROOT/.env"; fi

  # Die Schutzoptionen brauchen eigene Mount-Namespaces. In LXC-Containern ohne »Nesting« (Proxmox) scheitert
  # der Dienst damit beim Start (»226/NAMESPACE«) – dann läuft er ohne sie, mit Hinweis.
  SANDBOX="PrivateTmp=true
ProtectSystem=strict
ProtectHome=$PROTECT_HOME
ReadWritePaths=$DATA_DIR
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true"
  if [ "$DRY_RUN" = 0 ] && command -v systemd-run >/dev/null 2>&1; then
    step "Schutzoptionen des Dienstes prüfen"
    probe=(systemd-run --quiet --wait --collect)
    command -v timeout >/dev/null 2>&1 && probe=(timeout 60 "${probe[@]}")
    while IFS= read -r option; do probe+=(-p "$option"); done <<<"$SANDBOX"
    if "${probe[@]}" /bin/true >/dev/null 2>&1; then
      say "    verfügbar"
    else
      SANDBOX="# PrivateTmp, ProtectSystem und ProtectHome sind hier nicht verfügbar (keine eigenen Mount-Namespaces).
# LXC-Container (Proxmox): »Nesting« einschalten und install.sh --unattended erneut ausführen."
      say "    Nicht verfügbar – der Dienst läuft ohne PrivateTmp, ProtectSystem und ProtectHome."
      if [ "$(cat /run/systemd/container 2>/dev/null || true)" = "lxc" ]; then
        say "    LXC-Container: in Proxmox unter Container → Optionen → Funktionen »Nesting« einschalten,"
        say "    den Container neu starten und danach erneut ausführen: bash install.sh --unattended"
      fi
    fi
  fi

  step "systemd-Dienst einrichten"
  unit="[Unit]
Description=Knowstead – Dokumentation und Wissen
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
Group=$RUN_USER
WorkingDirectory=$ROOT
ExecStart="$NODE_BIN" --disable-warning=ExperimentalWarning server/src/index.ts
Restart=on-failure
RestartSec=5
# Offene Bearbeitungsstände vor dem Beenden schreiben lassen
KillSignal=SIGTERM
TimeoutStopSec=20
LimitNOFILE=65536
# Härtung
NoNewPrivileges=true
RestrictSUIDSGID=true
$SANDBOX

[Install]
WantedBy=multi-user.target"
  if [ "$DRY_RUN" = 1 ]; then
    say "    (Probelauf) $UNIT_FILE:"
    printf '%s\n' "$unit" | sed 's/^/      /'
  else
    printf '%s\n' "$unit" > "$UNIT_FILE"
    systemctl daemon-reload
    systemctl enable --now "$SERVICE_NAME"
    SERVICE_STOPPED=0
  fi

  if [ "$ACCESS" != "local-proxy" ]; then
    step "Firewall"
    if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "^Status: active"; then
      if [ "$ACCESS" = "remote-proxy" ]; then run ufw allow from "$PROXY_ADDRESS" to any port "$PORT" proto tcp comment knowstead
      else run ufw allow "$PORT/tcp" comment knowstead; fi
    elif command -v firewall-cmd >/dev/null 2>&1 && firewall-cmd --state >/dev/null 2>&1; then
      if [ "$ACCESS" = "remote-proxy" ]; then run firewall-cmd --permanent --add-rich-rule="rule family=ipv4 source address=$PROXY_ADDRESS port port=$PORT protocol=tcp accept"
      else run firewall-cmd --permanent --add-port="$PORT/tcp"; fi
      run firewall-cmd --reload
    else
      say "    Keine aktive Firewall (ufw/firewalld) gefunden – Port $PORT ggf. selbst freigeben."
    fi
  fi

  if [ "$DRY_RUN" = 0 ]; then
    step "Erreichbarkeit prüfen"
    for _ in $(seq 1 120); do
      if "$NODE_BIN" -e "fetch('http://127.0.0.1:$PORT/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
        say "    Knowstead läuft."
        break
      fi
      sleep 0.5
    done
    systemctl is-active --quiet "$SERVICE_NAME" || fail "Der Dienst läuft nicht – Protokoll: journalctl -u $SERVICE_NAME -n 50"
  fi
fi

# Proxmox-Container haben meist kein sudo
if command -v sudo >/dev/null 2>&1; then AS_USER="sudo -u $RUN_USER"; else AS_USER="runuser -u $RUN_USER --"; fi
[ "$SERVICE" = "systemd" ] || AS_USER=""
if command -v sudo >/dev/null 2>&1; then AS_ROOT="sudo "; else AS_ROOT=""; fi

cat <<EOF

  Fertig.

  Ersteinrichtung:
    • auf dem Server selbst ohne Code:   http://localhost:$PORT/setup
    • von Ihrem Rechner über SSH:        ssh -L $PORT:127.0.0.1:$PORT $(whoami)@$HOSTNAME_FQDN
                                         dann im Browser http://localhost:$PORT/setup
    • über die öffentliche Adresse:      $BASE_URL/setup
                                         Einrichtungscode: journalctl -u $SERVICE_NAME | grep Einrichtungscode
    • danach führt Administration → Nächste Schritte durch E-Mail, Sicherung, Personen und Bereiche

  Steuern:  systemctl start|stop|restart|status $SERVICE_NAME   ·   Protokoll: journalctl -u $SERVICE_NAME -f
  Prüfen:   ${AS_USER:+$AS_USER }$NODE_BIN $ROOT/server/src/cli.ts doctor
  Update:   ${AS_ROOT}bash $ROOT/update.sh <neues-paket.tar.gz>   ·   zurück zum Stand davor: ${AS_ROOT}bash $ROOT/update.sh --rollback
  Zusatz:   Texterkennung und Office-Vorschau nachrüsten: ${AS_ROOT}bash install.sh --unattended --install-ocr --install-office

EOF

if [ -n "$NOTES" ]; then
  say "  Hinweise – Knowstead ist eingerichtet, bei den Zusatzprogrammen blieb etwas offen:"
  printf '%s' "$NOTES" | sed 's/^/    [!] /'
  say "    → Nachholen: Administration → KI & Dateien, oder erneut: bash install.sh --unattended --install-ocr --install-office"
  say ""
fi

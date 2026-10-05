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
#
#  Sprache der Meldungen: Deutsch oder Englisch – --lang de|en, sonst die Umgebungsvariable
#  KNOWSTEAD_LANG, sonst die Sprache des Systems (LC_ALL, LC_MESSAGES, LANG).
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

# Sprache der Meldungen – vor allem anderen, damit schon die erste Meldung stimmt. Ausdrücklich gewählt
# (--lang de|en), sonst KNOWSTEAD_LANG, sonst die Sprache des Systems: Deutsch, wenn sie mit »de« beginnt,
# sonst Englisch. »C« und »POSIX« sagen nichts über die Sprache der Person.
UI_LANG=""
LANG_CHOSEN=0
previous=""
DETECTED=""
for argument in "$@"; do
  if [ "$previous" = "--lang" ]; then UI_LANG="$argument"; LANG_CHOSEN=1; fi
  # Vom Neustart mit sudo: die dort erkannte Sprache (sudo reicht LANG und KNOWSTEAD_LANG nicht unbedingt weiter)
  if [ "$previous" = "--lang-detected" ]; then DETECTED="$argument"; fi
  previous="$argument"
done
if [ "$LANG_CHOSEN" = 1 ]; then
  case "$UI_LANG" in
    de | en) ;;
    *)
      printf '\n  [!] Unbekannte Sprache / unknown language: %s (de, en)\n' "$UI_LANG" >&2
      exit 2
      ;;
  esac
else
  UI_LANG="${KNOWSTEAD_LANG:-}"
  if [ -n "$UI_LANG" ]; then
    LANG_CHOSEN=1
  elif [ "$DETECTED" = de ] || [ "$DETECTED" = en ]; then
    UI_LANG="$DETECTED"
  else
    for candidate in "${LC_ALL:-}" "${LC_MESSAGES:-}" "${LANG:-}"; do
      case "$candidate" in "" | C | C.* | POSIX | POSIX.*) continue ;; esac
      UI_LANG="$candidate"
      break
    done
  fi
  case "$UI_LANG" in de* | DE*) UI_LANG="de" ;; *) UI_LANG="en" ;; esac
fi
# L "deutscher Text" "English text" – gibt den Text in der gewählten Sprache aus
L() { if [ "$UI_LANG" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }
YES="$(L j y)"

usage() {
  if [ "$UI_LANG" = en ]; then
    cat <<'EOF'
Install Knowstead, change its settings or finish an update (Linux)

Guided:            sudo bash install.sh
Without prompts:   sudo bash install.sh --unattended --data-dir /var/lib/knowstead \
                        --base-url https://knowstead.example.com --access local-proxy
Dry run:           bash install.sh --unattended --dry-run
Remove autostart:  sudo bash install.sh --uninstall

Sets up: Node.js 24 (on request), system account, data directory, .env, dependencies and
interface, trial start, hardened systemd service, firewall (ufw/firewalld) and – on request,
including installation through the package manager – Tesseract (text recognition) and
LibreOffice (Office preview). Also runs in LXC containers (Proxmox). Program and data are
kept when the autostart is removed.

Add the extra programs later:  sudo bash install.sh --unattended --install-ocr --install-office

Options:
  --lang <de|en>               language of the messages (default: KNOWSTEAD_LANG, otherwise the system language)
  --unattended                 no prompts (values not given come from .env or the defaults)
  --install-node               install Node.js 24 from the NodeSource package source if needed (apt/dnf)
  --data-dir <path>            data directory (default /var/lib/knowstead)
  --port <number>              port (default 3000)
  --base-url <url>             public address, e.g. https://knowstead.example.com
  --access <kind>              local-proxy (proxy on this server, recommended) | remote-proxy | direct
  --proxy-address <ip>         address of the proxy for remote-proxy
  --service <kind>             systemd (default) | none
  --user <account>             system account for the service (default knowstead)
  --install-ocr                text recognition: install Tesseract with language data if needed (apt/dnf) and enable it
  --ocr-languages <codes>      text recognition languages as Tesseract codes, e.g. deu+eng (default) or deu+eng+fra
  --install-office             Office preview: install headless LibreOffice if needed (apt/dnf) and enable it
  --ocr-path <path>            register an existing Tesseract and enable text recognition
  --office-path <path>         register an existing LibreOffice (soffice) and enable the Office preview
  --skip-prepare               do not check dependencies/interface (ready-made installation package)
  --dry-run                    only show what would happen
  --uninstall                  remove the systemd service and the firewall rule (data is kept)
EOF
    return
  fi
  sed -n '3,17p' "$0" | sed 's/^# \{0,1\}//'
  cat <<'EOF'
Optionen:
  --lang <de|en>               Sprache der Meldungen (Standard: KNOWSTEAD_LANG, sonst die Sprache des Systems)
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
    --lang | --lang-detected) shift ;;
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
    *) echo "$(L "Unbekannte Option" "Unknown option"): $1" >&2; usage; exit 2 ;;
  esac
  shift
done

# Konto des Dienstes: wie angegeben, sonst das des bestehenden Dienstes, sonst »knowstead«
if [ -z "$RUN_USER" ] && [ -f "$UNIT_FILE" ]; then RUN_USER="$(sed -n 's/^User=//p' "$UNIT_FILE" | tail -n 1)"; fi
RUN_USER="${RUN_USER:-knowstead}"

say() { printf '%s\n' "$*"; }
step() { printf '\n  ▸ %s\n' "$*"; }
fail() { printf '\n  [!] %s\n' "$*" >&2; exit 1; }
DRY="$(L "Probelauf" "dry run")"
run() {
  if [ "$DRY_RUN" = 1 ]; then printf '    (%s) %s\n' "$DRY" "$*"; else "$@"; fi
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
    printf '\n  %s\n' "$(L "Die Einrichtung wurde nicht abgeschlossen. Der Dienst »$SERVICE_NAME« lief vorher – er wird wieder gestartet." "The setup was not completed. The service “$SERVICE_NAME” was running before – it is being started again.")" >&2
    if systemctl start "$SERVICE_NAME" >/dev/null 2>&1; then
      printf '  %s\n' "$(L "Dienst gestartet. Bitte die Ursache oben beheben und install.sh erneut ausführen." "Service started. Please fix the cause shown above and run install.sh again.")" >&2
    else
      printf '  [!] %s\n' "$(L "Der Dienst ließ sich nicht starten – Protokoll: journalctl -u $SERVICE_NAME -n 50" "The service could not be started – log: journalctl -u $SERVICE_NAME -n 50")" >&2
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
    say "$(L "Für Dienst, Konto und Firewall sind Root-Rechte nötig – Neustart mit sudo …" "Service, account and firewall need root privileges – restarting with sudo …")"
    # Die Sprache mitgeben: sudo reicht die Umgebung (LANG, KNOWSTEAD_LANG) nicht unbedingt weiter
    if [ "$LANG_CHOSEN" = 1 ]; then LANG_ARGS=(--lang "$UI_LANG"); else LANG_ARGS=(--lang-detected "$UI_LANG"); fi
    exec sudo bash "$0" "${LANG_ARGS[@]}" ${ORIGINAL_ARGS[@]+"${ORIGINAL_ARGS[@]}"}
  fi
  fail "$(L "Bitte als root ausführen (sudo bash install.sh)." "Please run as root (sudo bash install.sh).")"
fi

# Frisch entpacktes Paket, der Dienst zeigt aber auf eine Installation in einem anderen Ordner: Hier neu
# einzurichten hieße, den Dienst auf einen leeren Stand umzubiegen – das Wiki sähe aus wie verloren.
if [ "$UNINSTALL" = 0 ] && [ ! -f "$ROOT/.env" ] && [ -f "$UNIT_FILE" ]; then
  installed="$(sed -n 's/^WorkingDirectory=//p' "$UNIT_FILE" | tail -n 1)"
  installed="${installed%/}"
  if [ -n "$installed" ] && [ "$installed" != "$ROOT" ] && [ -f "$installed/.env" ]; then
    fail "$(L "Auf diesem Rechner ist Knowstead bereits eingerichtet: Dienst »$SERVICE_NAME«, Programmordner $installed.
      Aktualisieren:  bash $ROOT/update.sh
      Soll stattdessen dieser Ordner die Installation ablösen, zuerst deren Einstellungen übernehmen
      (cp -p $installed/.env $ROOT/.env) und install.sh erneut starten." "Knowstead is already set up on this computer: service “$SERVICE_NAME”, program folder $installed.
      Update:  bash $ROOT/update.sh
      If this folder is to replace that installation instead, first take over its settings
      (cp -p $installed/.env $ROOT/.env) and start install.sh again.")"
  fi
fi

# ------------------------------------------------------------------------------ Entfernen
if [ "$UNINSTALL" = 1 ]; then
  step "$(L "Autostart entfernen" "Removing the autostart")"
  if [ -f "$UNIT_FILE" ]; then
    run systemctl disable --now "$SERVICE_NAME"
    run rm -f "$UNIT_FILE"
    run systemctl daemon-reload
  else
    say "    $(L "Kein systemd-Dienst »$SERVICE_NAME« eingerichtet." "No systemd service “$SERVICE_NAME” is set up.")"
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
  say "    $(L "Programm ($ROOT) und Daten ($(env_value DATA_DIR)) bleiben erhalten." "Program ($ROOT) and data ($(env_value DATA_DIR)) are kept.")"
  exit 0
fi

# ------------------------------------------------------------------------------ Voraussetzungen
step "$(L "Voraussetzungen" "Requirements")"
node_ready() { command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 24 ]; }

# Node.js 24 aus der offiziellen Paketquelle von NodeSource (Debian/Ubuntu bzw. RHEL/Rocky)
install_node() {
  step "$(L "Node.js 24 installieren (Paketquelle von NodeSource)" "Installing Node.js 24 (NodeSource package source)")"
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
    fail "$(L "Keine Paketverwaltung (apt-get/dnf) gefunden – bitte Node.js 24 selbst installieren: https://nodejs.org/" "No package manager (apt-get/dnf) found – please install Node.js 24 yourself: https://nodejs.org/")"
  fi
  if [ "$DRY_RUN" = 1 ]; then
    say "    ($DRY) curl -fsSL $setup | bash -"
  elif ! curl -fsSL "$setup" | bash -; then
    fail "$(L "Die Paketquelle von NodeSource ließ sich nicht einrichten – besteht Internetzugang?" "The NodeSource package source could not be set up – is there internet access?")"
  fi
  run "${packages[@]}"
  hash -r
}

if ! node_ready; then
  found="$(command -v node >/dev/null 2>&1 && node -v || L "nicht installiert" "not installed")"
  if [ "$INSTALL_NODE" = 0 ] && [ "$UNATTENDED" = 0 ] && [ -t 0 ]; then
    question="$(L "Knowstead braucht Node.js 24 oder neuer (gefunden: $found). Jetzt aus der offiziellen Paketquelle von NodeSource installieren?" "Knowstead needs Node.js 24 or newer (found: $found). Install it now from the official NodeSource package source?")"
    if command -v whiptail >/dev/null 2>&1; then
      whiptail --backtitle "Knowstead – $(L "Installation" "installation")" --title "Node.js" --yes-button "$(L "Ja" "Yes")" --no-button "$(L "Nein" "No")" --yesno "$question" 10 76 && INSTALL_NODE=1
    else
      read -r -p "  $question ($YES/n) [$YES]: " answer
      case "${answer:-$YES}" in j|J|y|Y) INSTALL_NODE=1 ;; esac
    fi
  fi
  [ "$INSTALL_NODE" = 1 ] && install_node
  if [ "$DRY_RUN" = 1 ] && [ "$INSTALL_NODE" = 1 ] && ! node_ready; then
    say "    ($DRY) $(L "Die weiteren Schritte brauchen Node.js – der Probelauf endet hier." "The remaining steps need Node.js – the dry run ends here.")"
    exit 0
  fi
  node_ready || fail "$(L "Node.js 24 oder neuer wird benötigt (gefunden: $found). Installation mit: bash install.sh --install-node
      oder von Hand – Debian/Ubuntu:  apt-get install -y curl && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs
                     RHEL/Rocky:     curl -fsSL https://rpm.nodesource.com/setup_24.x | bash - && dnf install -y nodejs" "Node.js 24 or newer is required (found: $found). Install it with: bash install.sh --install-node
      or by hand – Debian/Ubuntu:  apt-get install -y curl && curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt-get install -y nodejs
                   RHEL/Rocky:     curl -fsSL https://rpm.nodesource.com/setup_24.x | bash - && dnf install -y nodejs")"
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
extras_valid_languages "$OCR_LANGS" || fail "$(L "Sprachen der Texterkennung bitte als Tesseract-Kürzel angeben, z. B. deu+eng (--ocr-languages)." "Please give the text recognition languages as Tesseract codes, e.g. deu+eng (--ocr-languages).")"
PKG="$(extras_pkg_manager)"
# Tesseract ist da, aber nicht jede gewünschte Sprache? Dann lohnt das Nachinstallieren der Sprachdaten.
missing_langs=""
[ -n "$detected_ocr" ] && missing_langs="$(extras_missing_languages "$OCR_LANGS" "$detected_ocr")"

# Fragen zu den Zusatzprogrammen – für beide Arten der Abfrage (Dialog und Zeile) dieselben.
# yesno <text mit \n> <vorgabe j|n> liefert 0 bei Ja.
ask_extras() {
  if [ -n "$detected_ocr" ] && [ -z "$missing_langs" ]; then
    yesno "$(L "Tesseract gefunden ($detected_ocr).\nTexterkennung für eingescannte PDFs und Bilder einschalten?" "Tesseract found ($detected_ocr).\nEnable text recognition for scanned PDFs and images?")" j && OCR_PATH="$detected_ocr"
  elif [ -n "$detected_ocr" ] && [ -n "$PKG" ]; then
    yesno "$(L "Tesseract gefunden ($detected_ocr), es fehlen aber Sprachdaten für: ${missing_langs//+/, }.\nSprachdaten nachinstallieren und Texterkennung einschalten?" "Tesseract found ($detected_ocr), but language data is missing for: ${missing_langs//+/, }.\nInstall the language data and enable text recognition?")" j && INSTALL_OCR=1
  elif [ -n "$detected_ocr" ]; then
    yesno "$(L "Tesseract gefunden ($detected_ocr), es fehlen aber Sprachdaten für: ${missing_langs//+/, }.\nTexterkennung mit den vorhandenen Sprachen einschalten?" "Tesseract found ($detected_ocr), but language data is missing for: ${missing_langs//+/, }.\nEnable text recognition with the languages that are there?")" j && OCR_PATH="$detected_ocr"
  elif [ -n "$PKG" ]; then
    yesno "$(L "Texterkennung (OCR) installieren?\nTesseract macht eingescannte PDFs und Bilder durchsuchbar. Installiert werden Tesseract und die Sprachdaten ${OCR_LANGS//+/, } aus der Paketquelle der Distribution (rund 25 MB)." "Install text recognition (OCR)?\nTesseract makes scanned PDFs and images searchable. Tesseract and the language data ${OCR_LANGS//+/, } are installed from the distribution's package source (about 25 MB).")" j && INSTALL_OCR=1
  fi
  if [ -n "$detected_office" ]; then
    yesno "$(L "LibreOffice gefunden ($detected_office).\nVorschau für Office- und Visio-Dateien einschalten?" "LibreOffice found ($detected_office).\nEnable the preview for Office and Visio files?")" j && OFFICE_PATH="$detected_office"
  elif [ -n "$PKG" ]; then
    yesno "$(L "LibreOffice installieren?\nDamit zeigt Knowstead Word-, Excel-, PowerPoint- und Visio-Dateien als Vorschau im Browser. Installiert wird LibreOffice ohne grafische Oberfläche aus der Paketquelle der Distribution (rund 400 MB)." "Install LibreOffice?\nWith it Knowstead shows Word, Excel, PowerPoint and Visio files as a preview in the browser. Headless LibreOffice is installed from the distribution's package source (about 400 MB).")" n && INSTALL_OFFICE=1
  fi
  return 0
}

# Wer die Sprache nicht ausdrücklich gewählt hat, erfährt, wie es in der anderen geht
if [ "$LANG_CHOSEN" = 1 ]; then LANG_HINT=""; else LANG_HINT="$(L "Sprache: Deutsch – in English: bash install.sh --lang en" "Language: English – auf Deutsch: bash install.sh --lang de")"; fi

# ------------------------------------------------------------------------------ Abfragen
if [ "$UNATTENDED" = 0 ]; then
  if command -v whiptail >/dev/null 2>&1 && [ -t 0 ]; then
    W=(whiptail --backtitle "Knowstead – $(L "Installation" "installation")" --title "$(L "Knowstead installieren" "Install Knowstead")" --ok-button "OK" --cancel-button "$(L "Abbrechen" "Cancel")" --yes-button "$(L "Ja" "Yes")" --no-button "$(L "Nein" "No")")
    ask() { "${W[@]}" --inputbox "$1" 12 76 "$2" 3>&1 1>&2 2>&3; }
    "${W[@]}" --msgbox "$(L "Dieser Assistent richtet Knowstead ein: Datenverzeichnis, Konfiguration, systemd-Dienst, Firewall und Zusatzprogramme. Danach folgt die Ersteinrichtung im Browser.\n\nProgrammordner: $ROOT\nNode.js: $("$NODE_BIN" -v)" "This assistant sets up Knowstead: data directory, configuration, systemd service, firewall and additional programs. The first-time setup in the browser follows afterwards.\n\nProgram folder: $ROOT\nNode.js: $("$NODE_BIN" -v)")${LANG_HINT:+\n\n$LANG_HINT}" 16 76
    DATA_DIR="$(ask "$(L "Datenverzeichnis (lokales Laufwerk, außerhalb des Programmordners):" "Data directory (local drive, outside the program folder):")" "$DATA_DIR")" || exit 1
    ACCESS="$("${W[@]}" --radiolist "$(L "Wie erreichen die Nutzenden Knowstead?" "How do users reach Knowstead?")" 14 76 3 \
      local-proxy "$(L "Reverse-Proxy auf diesem Server (empfohlen)" "Reverse proxy on this server (recommended)")" "$([ "$ACCESS" = local-proxy ] && echo ON || echo OFF)" \
      remote-proxy "$(L "Reverse-Proxy auf einem anderen Rechner" "Reverse proxy on another computer")" "$([ "$ACCESS" = remote-proxy ] && echo ON || echo OFF)" \
      direct "$(L "Direkt im Netzwerk ohne HTTPS (nur Tests)" "Directly on the network without HTTPS (tests only)")" "$([ "$ACCESS" = direct ] && echo ON || echo OFF)" 3>&1 1>&2 2>&3)" || exit 1
    if [ "$ACCESS" = "remote-proxy" ]; then PROXY_ADDRESS="$(ask "$(L "IP-Adresse des Reverse-Proxys:" "IP address of the reverse proxy:")" "$PROXY_ADDRESS")" || exit 1; fi
    PORT="$(ask "$(L "Interner Port von Knowstead:" "Internal port of Knowstead:")" "$PORT")" || exit 1
    BASE_URL="$(ask "$(L "Adresse für die Nutzenden (steht in Links und E-Mails):" "Address for the users (appears in links and e-mails):")" "${BASE_URL:-$(default_url)}")" || exit 1
    SERVICE="$("${W[@]}" --radiolist "$(L "Autostart" "Autostart")" 12 76 2 \
      systemd "$(L "systemd-Dienst »$SERVICE_NAME« (empfohlen)" "systemd service “$SERVICE_NAME” (recommended)")" "$([ "$SERVICE" = systemd ] && echo ON || echo OFF)" \
      none "$(L "Kein Autostart (Start von Hand mit start.sh)" "No autostart (start by hand with start.sh)")" "$([ "$SERVICE" = none ] && echo ON || echo OFF)" 3>&1 1>&2 2>&3)" || exit 1
    yesno() { if [ "$2" = n ]; then "${W[@]}" --defaultno --yesno "$1" 13 76; else "${W[@]}" --yesno "$1" 13 76; fi; }
    ask_extras
  else
    prompt() { local answer; read -r -p "  $1 [$2]: " answer; echo "${answer:-$2}"; }
    say ""
    say "  Knowstead – $(L "Installation (Programmordner $ROOT)" "installation (program folder $ROOT)")"
    [ -n "$LANG_HINT" ] && say "  $LANG_HINT"
    DATA_DIR="$(prompt "$(L "Datenverzeichnis" "Data directory")" "$DATA_DIR")"
    say "  $(L "Zugriff: 1 = Reverse-Proxy auf diesem Server (empfohlen), 2 = Proxy auf anderem Rechner, 3 = direkt ohne HTTPS" "Access: 1 = reverse proxy on this server (recommended), 2 = proxy on another computer, 3 = directly without HTTPS")"
    case "$(prompt "$(L "Auswahl" "Choice")" "$(case "$ACCESS" in remote-proxy) echo 2;; direct) echo 3;; *) echo 1;; esac)")" in
      2) ACCESS="remote-proxy"; PROXY_ADDRESS="$(prompt "$(L "IP-Adresse des Proxys" "IP address of the proxy")" "$PROXY_ADDRESS")" ;;
      3) ACCESS="direct" ;;
      *) ACCESS="local-proxy" ;;
    esac
    PORT="$(prompt "Port" "$PORT")"
    BASE_URL="$(prompt "$(L "Adresse für die Nutzenden" "Address for the users")" "${BASE_URL:-$(default_url)}")"
    SERVICE="$(prompt "$(L "Autostart" "Autostart") (systemd/none)" "$SERVICE")"
    # Vorgabe j|n – in der englischen Fassung als y|n gezeigt; angenommen wird beides
    yesno() { case "$(prompt "${1//\\n/ } ($YES/n)" "$(if [ "$2" = j ]; then echo "$YES"; else echo n; fi)")" in j|J|y|Y|ja|Ja|yes|Yes) return 0 ;; *) return 1 ;; esac; }
    ask_extras
  fi
fi
BASE_URL="${BASE_URL:-$(default_url)}"

case "$ACCESS" in
  local-proxy) LISTEN="127.0.0.1"; TRUST="loopback" ;;
  remote-proxy) [ -n "$PROXY_ADDRESS" ] || fail "$(L "Bitte --proxy-address angeben." "Please give --proxy-address.")"; LISTEN="0.0.0.0"; TRUST="$PROXY_ADDRESS" ;;
  direct) LISTEN="0.0.0.0"; TRUST="false" ;;
  *) fail "$(L "Unbekannter Zugriff" "Unknown access"): $ACCESS (local-proxy, remote-proxy, direct)" ;;
esac
case "$SERVICE" in systemd|none) ;; *) fail "$(L "Unbekannter Autostart" "Unknown autostart"): $SERVICE (systemd, none)" ;; esac
case "$DATA_DIR" in /*) ;; *) fail "$(L "Bitte einen absoluten Pfad für das Datenverzeichnis angeben." "Please give an absolute path for the data directory.")" ;; esac

say ""
if [ "$UI_LANG" = en ]; then
  say "  Data directory:    $DATA_DIR"
  say "  Address:           $BASE_URL"
  say "  Port:              $PORT (listens on $LISTEN, proxy headers from: $TRUST)"
  say "  Autostart:         $SERVICE (account $RUN_USER)"
else
  say "  Datenverzeichnis:  $DATA_DIR"
  say "  Adresse:           $BASE_URL"
  say "  Port:              $PORT (lauscht auf $LISTEN, Proxy-Header von: $TRUST)"
  say "  Autostart:         $SERVICE (Konto $RUN_USER)"
fi
# Ohne Rückfragen: Was schon installiert ist, wird nur eingeschaltet
if [ "$INSTALL_OCR" = 1 ] && [ -n "$detected_ocr" ] && [ -z "$missing_langs" ]; then INSTALL_OCR=0; OCR_PATH="${OCR_PATH:-$detected_ocr}"; fi
if [ "$INSTALL_OFFICE" = 1 ] && [ -n "$detected_office" ]; then INSTALL_OFFICE=0; OFFICE_PATH="${OFFICE_PATH:-$detected_office}"; fi
LABEL_OCR="$(L "Texterkennung:    " "Text recognition: ")"
LABEL_OFFICE="$(L "Office-Vorschau:  " "Office preview:   ")"
NO_PKG="$(L "Installation hier nicht möglich (keine Paketverwaltung apt-get oder dnf)" "cannot be installed here (no package manager apt-get or dnf)")"
if [ "$INSTALL_OCR" = 1 ] && [ -z "$PKG" ]; then say "  $LABEL_OCR $NO_PKG"
elif [ "$INSTALL_OCR" = 1 ]; then say "  $LABEL_OCR $(L "wird installiert (Tesseract, Sprachen ${OCR_LANGS//+/, })" "will be installed (Tesseract, languages ${OCR_LANGS//+/, })")"
elif [ -n "$OCR_PATH" ]; then say "  $LABEL_OCR $OCR_PATH"; fi
if [ "$INSTALL_OFFICE" = 1 ] && [ -z "$PKG" ]; then say "  $LABEL_OFFICE $NO_PKG"
elif [ "$INSTALL_OFFICE" = 1 ]; then say "  $LABEL_OFFICE $(L "wird installiert (LibreOffice ohne grafische Oberfläche)" "will be installed (headless LibreOffice)")"
elif [ -n "$OFFICE_PATH" ]; then say "  $LABEL_OFFICE $OFFICE_PATH"; fi

# ------------------------------------------------------------------------------ Ausführen
# Zusatzprogramme zuerst: Das Laden der Pakete dauert – so lange läuft ein vorhandener Dienst weiter.
# Scheitert die Installation (kein Internet, Paket fehlt), geht es ohne die Zusatzfunktion weiter.
EXTRAS_PENDING=""
if [ "$INSTALL_OCR" = 1 ]; then
  step "$(L "Texterkennung installieren (Tesseract, Sprachen ${OCR_LANGS//+/, })" "Installing text recognition (Tesseract, languages ${OCR_LANGS//+/, })")"
  if extras_install_ocr "$PKG" "$OCR_LANGS"; then
    OCR_PATH="$EXTRAS_OCR_PATH"
    OCR_LANGS_GIVEN="$OCR_LANGS"
    [ -z "$OCR_PATH" ] && EXTRAS_PENDING="$EXTRAS_PENDING $(L "Texterkennung" "text recognition")"
  elif [ -n "$detected_ocr" ]; then
    # Tesseract war schon da, nur weitere Sprachdaten kamen nicht hinzu: mit den vorhandenen Sprachen einschalten.
    # Welche das sind, prüft der Installationskern – er meldet auch, was fehlt.
    OCR_PATH="$detected_ocr"
    OCR_LANGS_GIVEN="$OCR_LANGS"
  else
    note "$(L "Texterkennung: Tesseract wurde nicht installiert (Einzelheiten weiter oben)." "Text recognition: Tesseract was not installed (details further up).")"
  fi
fi
if [ "$INSTALL_OFFICE" = 1 ]; then
  step "$(L "LibreOffice installieren (ohne grafische Oberfläche)" "Installing LibreOffice (headless)")"
  if extras_install_office "$PKG"; then
    OFFICE_PATH="$EXTRAS_OFFICE_PATH"
    [ -z "$OFFICE_PATH" ] && EXTRAS_PENDING="$EXTRAS_PENDING $(L "Office-Vorschau" "Office preview")"
  else
    note "$(L "Office-Vorschau: LibreOffice wurde nicht installiert (Einzelheiten weiter oben)." "Office preview: LibreOffice was not installed (details further up).")"
  fi
fi
# Nur im Probelauf: installiert wurde nichts, eingeschaltet würde es aber
[ -n "$EXTRAS_PENDING" ] && say "    ($DRY) $(L "Danach eingeschaltet:" "Enabled afterwards:")$EXTRAS_PENDING"

if [ -f "$UNIT_FILE" ] && systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  step "$(L "Laufenden Dienst beenden" "Stopping the running service")"
  run systemctl stop "$SERVICE_NAME"
  if [ "$DRY_RUN" = 0 ]; then SERVICE_STOPPED=1; fi
fi

if [ "$SERVICE" = "systemd" ] && ! id -u "$RUN_USER" >/dev/null 2>&1; then
  step "$(L "Systemkonto »$RUN_USER« anlegen" "Creating the system account “$RUN_USER”")"
  run useradd --system --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$RUN_USER"
fi

args=(scripts/install.mjs --lang "$UI_LANG" --data-dir "$DATA_DIR" --port "$PORT" --host "$LISTEN" --base-url "$BASE_URL" --trust-proxy "$TRUST" --service "$SERVICE")
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
  case "$DATA_DIR/" in /home/*|/root/*) fail "$(L "Das Datenverzeichnis unter /home oder /root ist für einen Dienst ungeeignet – bitte z. B. /var/lib/knowstead verwenden." "A data directory under /home or /root is unsuitable for a service – please use e.g. /var/lib/knowstead.")" ;; esac
  if [ "$DRY_RUN" = 0 ] && command -v runuser >/dev/null 2>&1 && ! runuser -u "$RUN_USER" -- test -r "$ROOT/server/src/index.ts"; then
    fail "$(L "Das Konto »$RUN_USER« kann den Programmordner $ROOT nicht lesen. Programm z. B. nach /opt/knowstead verschieben (sudo mv \"$ROOT\" /opt/knowstead) und dort erneut ausführen." "The account “$RUN_USER” cannot read the program folder $ROOT. Move the program e.g. to /opt/knowstead (sudo mv \"$ROOT\" /opt/knowstead) and run it again from there.")"
  fi

  step "$(L "Rechte setzen" "Setting permissions")"
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
    step "$(L "Schutzoptionen des Dienstes prüfen" "Checking the protection options of the service")"
    probe=(systemd-run --quiet --wait --collect)
    command -v timeout >/dev/null 2>&1 && probe=(timeout 60 "${probe[@]}")
    while IFS= read -r option; do probe+=(-p "$option"); done <<<"$SANDBOX"
    if "${probe[@]}" /bin/true >/dev/null 2>&1; then
      say "    $(L "verfügbar" "available")"
    else
      SANDBOX="$(L "# PrivateTmp, ProtectSystem und ProtectHome sind hier nicht verfügbar (keine eigenen Mount-Namespaces).
# LXC-Container (Proxmox): »Nesting« einschalten und install.sh --unattended erneut ausführen." "# PrivateTmp, ProtectSystem and ProtectHome are not available here (no separate mount namespaces).
# LXC container (Proxmox): enable “Nesting” and run install.sh --unattended again.")"
      say "    $(L "Nicht verfügbar – der Dienst läuft ohne PrivateTmp, ProtectSystem und ProtectHome." "Not available – the service runs without PrivateTmp, ProtectSystem and ProtectHome.")"
      if [ "$(cat /run/systemd/container 2>/dev/null || true)" = "lxc" ]; then
        say "    $(L "LXC-Container: in Proxmox unter Container → Optionen → Funktionen »Nesting« einschalten," "LXC container: in Proxmox enable “Nesting” under Container → Options → Features,")"
        say "    $(L "den Container neu starten und danach erneut ausführen: bash install.sh --unattended" "restart the container and then run again: bash install.sh --unattended")"
      fi
    fi
  fi

  step "$(L "systemd-Dienst einrichten" "Setting up the systemd service")"
  unit="[Unit]
Description=Knowstead – $(L "Dokumentation und Wissen" "documentation and knowledge")
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
# $(L "Offene Bearbeitungsstände vor dem Beenden schreiben lassen" "Let open editing states be written before stopping")
KillSignal=SIGTERM
TimeoutStopSec=20
LimitNOFILE=65536
# $(L "Härtung" "Hardening")
NoNewPrivileges=true
RestrictSUIDSGID=true
$SANDBOX

[Install]
WantedBy=multi-user.target"
  if [ "$DRY_RUN" = 1 ]; then
    say "    ($DRY) $UNIT_FILE:"
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
      say "    $(L "Keine aktive Firewall (ufw/firewalld) gefunden – Port $PORT ggf. selbst freigeben." "No active firewall (ufw/firewalld) found – open port $PORT yourself if needed.")"
    fi
  fi

  if [ "$DRY_RUN" = 0 ]; then
    step "$(L "Erreichbarkeit prüfen" "Checking availability")"
    for _ in $(seq 1 120); do
      if "$NODE_BIN" -e "fetch('http://127.0.0.1:$PORT/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; then
        say "    $(L "Knowstead läuft." "Knowstead is running.")"
        break
      fi
      sleep 0.5
    done
    systemctl is-active --quiet "$SERVICE_NAME" || fail "$(L "Der Dienst läuft nicht – Protokoll: journalctl -u $SERVICE_NAME -n 50" "The service is not running – log: journalctl -u $SERVICE_NAME -n 50")"
  fi
fi

# Proxmox-Container haben meist kein sudo
if command -v sudo >/dev/null 2>&1; then AS_USER="sudo -u $RUN_USER"; else AS_USER="runuser -u $RUN_USER --"; fi
[ "$SERVICE" = "systemd" ] || AS_USER=""
if command -v sudo >/dev/null 2>&1; then AS_ROOT="sudo "; else AS_ROOT=""; fi

if [ "$UI_LANG" = en ]; then
  cat <<EOF

  Done.

  First-time setup:
    • on the server itself, no code:     http://localhost:$PORT/setup
    • from your computer via SSH:        ssh -L $PORT:127.0.0.1:$PORT $(whoami)@$HOSTNAME_FQDN
                                         then open http://localhost:$PORT/setup in the browser
    • via the public address:            $BASE_URL/setup
                                         setup code: journalctl -u $SERVICE_NAME | grep -i "setup code"
    • afterwards Administration → Next steps guides you through e-mail, backup, people and spaces

  Control:  systemctl start|stop|restart|status $SERVICE_NAME   ·   log: journalctl -u $SERVICE_NAME -f
  Check:    ${AS_USER:+$AS_USER }$NODE_BIN $ROOT/server/src/cli.ts doctor --lang en
  Update:   ${AS_ROOT}bash $ROOT/update.sh <new-package.tar.gz>   ·   back to the previous state: ${AS_ROOT}bash $ROOT/update.sh --rollback
  Extras:   add text recognition and Office preview later: ${AS_ROOT}bash install.sh --unattended --install-ocr --install-office

EOF
else
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
fi

if [ -n "$NOTES" ]; then
  say "  $(L "Hinweise – Knowstead ist eingerichtet, bei den Zusatzprogrammen blieb etwas offen:" "Notes – Knowstead is set up, but something remained open with the additional programs:")"
  printf '%s' "$NOTES" | sed 's/^/    [!] /'
  say "    → $(L "Nachholen: Administration → KI & Dateien, oder erneut: bash install.sh --unattended --install-ocr --install-office" "To catch up: Administration → AI & files, or again: bash install.sh --unattended --install-ocr --install-office")"
  say ""
fi

#!/usr/bin/env bash
# ---------------------------------------------------------------------------------------------
#  Zusatzprogramme für Knowstead unter Linux: Tesseract (Texterkennung) und LibreOffice (Office-Vorschau)
#
#  Wird von install.sh eingebunden (source). Die Funktionen stehen einzeln, damit sie sich ohne
#  Root-Rechte und ohne echte Paketverwaltung prüfen lassen (server/test/install-extras.test.ts).
#
#  Erwartet vom Aufrufer:
#    run <befehl …>   führt aus – im Probelauf wird der Befehl nur angezeigt
#    say <text>       Ausgabe
#    DRY_RUN          1 = Probelauf
#
#  Nichts hiervon bricht die Installation von Knowstead ab: Scheitert ein Zusatzprogramm, melden die
#  Funktionen das mit Rückgabe 1 und einem Hinweis, wie es sich nachholen lässt.
# ---------------------------------------------------------------------------------------------

# Paketverwaltung dieser Distribution: apt (Debian, Ubuntu) oder dnf (RHEL, Rocky, Alma, Fedora) – sonst leer
extras_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    echo apt
  elif command -v dnf >/dev/null 2>&1; then
    echo dnf
  else
    echo ""
  fi
}

# Sprachkürzel prüfen wie der Server: drei oder mehr Kleinbuchstaben je Sprache, mit + verbunden, höchstens sechs
extras_valid_languages() {
  [[ "$1" =~ ^[a-z_]{3,20}(\+[a-z_]{3,20}){0,5}$ ]]
}

# Sprachen, die ein installiertes Tesseract kennt – eine je Zeile. „osd“ (Schrift- und Lageerkennung) ist keine Sprache.
extras_tesseract_languages() { # $1 = Pfad zu tesseract
  "$1" --list-langs 2>&1 | tr -d '\r' | grep -E '^[a-z_]{3,20}$' | grep -vx osd || true
}

# Welche der gewünschten Sprachen fehlen? Ausgabe wie die Eingabe mit + verbunden (leer = alle vorhanden).
extras_missing_languages() { # $1 = gewünschte Sprachen (deu+eng), $2 = Pfad zu tesseract
  local have lang missing=""
  have="$(extras_tesseract_languages "$2")"
  for lang in ${1//+/ }; do
    printf '%s\n' "$have" | grep -qx "$lang" || missing="${missing:+$missing+}$lang"
  done
  printf '%s' "$missing"
}

# LibreOffice suchen. Der Server nimmt nur das Programm »soffice« an – ein Starter mit anderem Namen
# (»libreoffice«) zählt deshalb nur, wenn er auf soffice verweist. Der Snap-Starter (/snap/bin/libreoffice
# → snap) bleibt außen vor: Im Snap sieht LibreOffice das Arbeitsverzeichnis des Dienstes nicht.
extras_find_office() {
  local candidate resolved
  candidate="$(command -v soffice 2>/dev/null || true)"
  if [ -n "$candidate" ]; then
    printf '%s' "$candidate"
    return 0
  fi
  for candidate in "$(command -v libreoffice 2>/dev/null || true)" /usr/lib/libreoffice/program/soffice \
    /usr/lib64/libreoffice/program/soffice /opt/libreoffice*/program/soffice; do
    [ -n "$candidate" ] && [ -e "$candidate" ] || continue
    resolved="$(readlink -f "$candidate" 2>/dev/null || true)"
    case "${resolved##*/}" in
      soffice | soffice.bin)
        printf '%s' "$resolved"
        return 0
        ;;
    esac
  done
  return 0
}

# Pakete für die Texterkennung – eines je Zeile
extras_ocr_packages() { # $1 = Paketverwaltung, $2 = Sprachen (deu+eng)
  local lang
  case "$1" in
    apt)
      printf '%s\n' tesseract-ocr
      # Debian schreibt Kürzel mit Bindestrich: chi_sim → tesseract-ocr-chi-sim
      for lang in ${2//+/ }; do printf 'tesseract-ocr-%s\n' "${lang//_/-}"; done
      ;;
    dnf)
      printf '%s\n' tesseract
      for lang in ${2//+/ }; do printf 'tesseract-langpack-%s\n' "$lang"; done
      ;;
  esac
}

# Pakete für die Office-Vorschau – eines je Zeile. Schriften gehören dazu: Ohne Ersatz für Calibri, Cambria,
# Arial und Times verrutscht der Umbruch der Vorschau.
extras_office_packages() { # $1 = Paketverwaltung
  local suffix=""
  case "$1" in
    apt)
      # Ohne grafische Oberfläche, wo die Distribution das anbietet (Debian ab 11, Ubuntu ab 20.10): kein X11,
      # weniger Pakete. Der Kern wird ausdrücklich genannt – die Teilpakete nehmen beide Kerne an, und apt wählt
      # sonst den mit Oberfläche. Ältere Ausgaben bekommen die üblichen Pakete.
      if apt-cache show libreoffice-core-nogui >/dev/null 2>&1 && apt-cache show libreoffice-writer-nogui >/dev/null 2>&1; then
        suffix="-nogui"
        printf '%s\n' libreoffice-core-nogui
      fi
      printf '%s\n' "libreoffice-writer$suffix" "libreoffice-calc$suffix" "libreoffice-impress$suffix" "libreoffice-draw$suffix" \
        fonts-liberation fonts-dejavu-core fonts-crosextra-carlito fonts-crosextra-caladea
      ;;
    dnf)
      printf '%s\n' libreoffice-writer libreoffice-calc libreoffice-impress libreoffice-draw liberation-fonts
      ;;
  esac
}

EXTRAS_APT_UPDATED=0

# Pakete installieren – ohne Rückfragen der Paketverwaltung, und nur hinzufügen: Müsste dafür ein vorhandenes
# Paket weichen, bricht apt ab (--no-remove); dnf entfernt ohne --allowerasing ohnehin nichts.
extras_pkg_install() { # $1 = Paketverwaltung, Rest = Pakete
  local manager="$1"
  shift
  case "$manager" in
    apt)
      if [ "$EXTRAS_APT_UPDATED" = 0 ]; then
        # Eine einzelne nicht erreichbare Paketquelle lässt »apt-get update« scheitern – die Pakete der
        # Distribution lassen sich dann meist trotzdem installieren.
        run apt-get update || say "    Die Paketlisten ließen sich nicht vollständig aktualisieren – die Installation wird trotzdem versucht."
        EXTRAS_APT_UPDATED=1
      fi
      run env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends --no-remove "$@"
      ;;
    dnf) run dnf install -y "$@" ;;
    *) return 1 ;;
  esac
}

# Liest die Paketliste einer Funktion in das Feld EXTRAS_PACKAGES
extras_collect() { # $@ = Befehl, der Paketnamen zeilenweise ausgibt
  local line
  EXTRAS_PACKAGES=()
  while IFS= read -r line; do
    [ -n "$line" ] && EXTRAS_PACKAGES+=("$line")
  done < <("$@")
  return 0
}

# Tesseract samt Sprachdaten installieren. Ergebnis: EXTRAS_OCR_PATH (leer = nicht verfügbar).
# Rückgabe 1, wenn es nicht geklappt hat – die Installation von Knowstead läuft dann ohne Texterkennung weiter.
extras_install_ocr() { # $1 = Paketverwaltung, $2 = Sprachen (deu+eng)
  EXTRAS_OCR_PATH=""
  if [ -z "$1" ]; then
    say "    [!] Keine Paketverwaltung (apt-get oder dnf) gefunden – Tesseract bitte selbst installieren."
    say "        Danach: bash install.sh --unattended --install-ocr   oder   Administration → KI & Dateien"
    return 1
  fi
  extras_collect extras_ocr_packages "$1" "$2"
  if ! extras_pkg_install "$1" "${EXTRAS_PACKAGES[@]}"; then
    if command -v tesseract >/dev/null 2>&1; then
      # Tesseract war schon da – es ging nur um weitere Sprachen
      say "    [!] Die Sprachdaten ließen sich nicht installieren – es bleibt bei den vorhandenen Sprachen."
    else
      say "    [!] Tesseract ließ sich nicht installieren – Knowstead wird ohne Texterkennung eingerichtet."
    fi
    if [ "$1" = dnf ]; then
      say "        RHEL, Rocky und Alma führen Tesseract in der Paketquelle EPEL: dnf install -y epel-release"
    else
      say "        Besteht Internetzugang? Gibt es für jede Sprache ein Paket (apt-cache search tesseract-ocr-)?"
    fi
    say "        Später nachholen: bash install.sh --unattended --install-ocr"
    return 1
  fi
  hash -r
  EXTRAS_OCR_PATH="$(command -v tesseract || true)"
  if [ -z "$EXTRAS_OCR_PATH" ]; then
    # Im Probelauf wurde nichts installiert – das ist kein Fehler
    [ "$DRY_RUN" = 1 ] && return 0
    say "    [!] Die Pakete sind installiert, »tesseract« liegt aber nicht im Suchpfad – Texterkennung bleibt aus."
    return 1
  fi
  say "    Tesseract: $EXTRAS_OCR_PATH (Sprachen: $(extras_tesseract_languages "$EXTRAS_OCR_PATH" | tr '\n' ' ' | sed 's/ $//'))"
  return 0
}

# LibreOffice ohne Oberfläche installieren. Ergebnis: EXTRAS_OFFICE_PATH (leer = nicht verfügbar).
extras_install_office() { # $1 = Paketverwaltung
  EXTRAS_OFFICE_PATH=""
  if [ -z "$1" ]; then
    say "    [!] Keine Paketverwaltung (apt-get oder dnf) gefunden – LibreOffice bitte selbst installieren."
    say "        Danach: bash install.sh --unattended --install-office   oder   Administration → KI & Dateien"
    return 1
  fi
  if [ "$1" = apt ] && [ "$EXTRAS_APT_UPDATED" = 0 ]; then
    # Erst die Paketlisten: Ob es die Pakete ohne Oberfläche gibt, weiß apt-cache nur mit aktuellem Stand
    run apt-get update || true
    EXTRAS_APT_UPDATED=1
  fi
  extras_collect extras_office_packages "$1"
  if ! extras_pkg_install "$1" "${EXTRAS_PACKAGES[@]}"; then
    say "    [!] LibreOffice ließ sich nicht installieren – Knowstead wird ohne Office-Vorschau eingerichtet."
    say "        Besteht Internetzugang, reicht der Speicherplatz (rund 400 MB)?"
    say "        Später nachholen: bash install.sh --unattended --install-office"
    return 1
  fi
  hash -r
  EXTRAS_OFFICE_PATH="$(extras_find_office)"
  if [ -z "$EXTRAS_OFFICE_PATH" ]; then
    [ "$DRY_RUN" = 1 ] && return 0
    say "    [!] Die Pakete sind installiert, »soffice« liegt aber nicht im Suchpfad – Office-Vorschau bleibt aus."
    return 1
  fi
  say "    LibreOffice: $EXTRAS_OFFICE_PATH"
  return 0
}

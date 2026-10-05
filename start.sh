#!/usr/bin/env bash
# ---------------------------------------------------------------------------
#  Knowstead starten (Linux/macOS)
#
#  Prüft Node.js, installiert bzw. aktualisiert die Abhängigkeiten, baut die
#  Oberfläche (auch nach einem Update) und startet den Server. Vor
#  Datenbank-Änderungen legt der Server selbst eine Sicherung an.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")"

# Sprache der Meldungen: KNOWSTEAD_LANG, sonst die Sprache des Systems (LC_ALL, LC_MESSAGES, LANG) – Deutsch,
# wenn sie mit »de« beginnt, sonst Englisch. scripts/prepare.mjs übernimmt die Wahl.
UI_LANG="${KNOWSTEAD_LANG:-}"
if [ -z "$UI_LANG" ]; then
  for candidate in "${LC_ALL:-}" "${LC_MESSAGES:-}" "${LANG:-}"; do
    case "$candidate" in "" | C | C.* | POSIX | POSIX.*) continue ;; esac
    UI_LANG="$candidate"
    break
  done
fi
case "$UI_LANG" in de* | DE*) UI_LANG="de" ;; *) UI_LANG="en" ;; esac
export KNOWSTEAD_LANG="$UI_LANG"
L() { if [ "$UI_LANG" = en ]; then printf '%s' "$2"; else printf '%s' "$1"; fi; }

printf '\n  ####   Knowstead – %s\n\n' "$(L "Dokumentation und Wissen" "documentation and knowledge")"

if ! command -v node >/dev/null 2>&1; then
  echo "  [!] $(L "Node.js wurde nicht gefunden. Bitte Node.js 24 oder neuer installieren: https://nodejs.org/" "Node.js was not found. Please install Node.js 24 or newer: https://nodejs.org/")"
  exit 1
fi

# Abhängigkeiten und Oberfläche prüfen – nach einem Update wird beides automatisch aktualisiert
node scripts/prepare.mjs

port="${PORT:-3000}"
echo "  [3/3] $(L "Server startet …" "Starting the server …")"
printf '\n  %s http://localhost:%s\n  %s\n\n' "$(L "Adresse:" "Address:")" "$port" "$(L "Beenden: Strg+C" "Stop: Ctrl+C")"

npm start

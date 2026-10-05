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

printf '\n  ####   Knowstead – Dokumentation und Wissen\n\n'

if ! command -v node >/dev/null 2>&1; then
  echo "  [!] Node.js wurde nicht gefunden. Bitte Node.js 24 oder neuer installieren: https://nodejs.org/"
  exit 1
fi

# Abhängigkeiten und Oberfläche prüfen – nach einem Update wird beides automatisch aktualisiert
node scripts/prepare.mjs

port="${PORT:-3000}"
echo "  [3/3] Server startet …"
printf '\n  Adresse: http://localhost:%s\n  Beenden: Strg+C\n\n' "$port"

npm start

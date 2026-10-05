import { LEGACY_STOP_FILE } from './legacy.ts';

/**
 * Steuerung eines laufenden Servers ohne Signale: Windows kennt für Prozesse ohne Konsole kein
 * „Strg+C“. Die Kommandozeile (`stop`) legt diese Datei im Datenverzeichnis an; der Server prüft sie
 * sekündlich und fährt dann geordnet herunter (offene Bearbeitungsstände werden geschrieben).
 */
export const STOP_FILE = 'knowstead.stop';

/**
 * Beide Namen der Stopp-Datei: Während eines Updates (und beim Zurückkehren) beendet die Kommandozeile der
 * einen Version den Server der anderen – bis 1.9 hieß die Datei `doku.stop`. Die Kommandozeile legt deshalb
 * beide an, der Server achtet auf beide.
 */
export const STOP_FILES: readonly string[] = [STOP_FILE, LEGACY_STOP_FILE];

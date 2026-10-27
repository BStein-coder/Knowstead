// Typen von release.mjs – nur für die Tests (server/test), das Skript selbst läuft ohne sie.

export const EXAMPLE_FILES: string[];
/** −1, 0 oder 1 wie bei `Array.sort`. */
export function compareVersions(a: string, b: string): number;
export function currentVersion(root?: string): string;
/** Versionsnummer überall setzen; Rückgabe: geänderte Dateien (relativ zum Wurzelordner). */
export function bump(root: string, version: string, options?: { date?: string; dryRun?: boolean; force?: boolean }): string[];
export function check(
  root: string,
  options?: { version?: string; tag?: string; git?: boolean },
): { version: string; errors: string[]; warnings: string[]; passed: string[] };

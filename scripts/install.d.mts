// Typen der Hilfsfunktionen aus install.mjs – nur für die Tests (server/test), das Skript selbst läuft ohne sie.

/** Tesseract-Kürzel, mit + verbunden (wie server/src/modules/attachments/ocr.ts). */
export const OCR_LANGUAGES: RegExp;
export function parseTesseractLanguages(output: unknown): string[];
export function pickOcrLanguages(wanted: string, available: string[]): { languages: string; missing: string[] };
/** `language` ist die Sprache der Meldung (Standard Deutsch). */
export function planOcrLanguages(wanted: string, available: string[] | null, language?: 'de' | 'en'): { languages: string | null; level: 'info' | 'warn'; message: string };
export function formatEnvValue(value: unknown): string;
export function updateEnv(text: string, values: Record<string, string | null>): string;
export function readEnv(text: string | null | undefined): Record<string, string>;
/** `DOKU_…`-Einträge einer Installation aus der Zeit vor der Umbenennung heißen danach `KNOWSTEAD_…`. */
export function renameLegacyEnv(text: string | null | undefined): string;

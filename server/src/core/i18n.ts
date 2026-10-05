/**
 * Sprache der Serverantworten. Die Texte im Code sind deutsch; für englischsprachige Personen übersetzt
 * `translate` sie über den Katalog in i18n/en.ts – auch zusammengesetzte Texte mit eingesetzten Werten.
 */
import type { FastifyRequest } from 'fastify';
import { EN_TEXTS } from '../i18n/en.ts';
import { headerValue } from './legacy.ts';

export type Locale = 'de' | 'en';

interface Pattern {
  re: RegExp;
  en: string;
  /** Länge des festen Textes – spezifischere Muster zuerst */
  weight: number;
}

const MAX_PATTERN_INPUT = 2000;

let exact: Map<string, string> | null = null;
let patterns: Pattern[] = [];

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compile(): Map<string, string> {
  if (exact) return exact;
  exact = new Map();
  patterns = [];
  for (const [de, en] of Object.entries(EN_TEXTS)) {
    if (!de.includes('{}')) {
      exact.set(de, en);
      continue;
    }
    const parts = de.split('{}');
    patterns.push({ re: new RegExp(`^${parts.map(escapeRe).join('([\\s\\S]*?)')}$`), en, weight: parts.join('').length });
  }
  patterns.sort((a, b) => b.weight - a.weight);
  return exact;
}

export function isLocale(value: unknown): value is Locale {
  return value === 'de' || value === 'en';
}

/**
 * Text in die Zielsprache übertragen; Unbekanntes bleibt unverändert. `minFixed` begrenzt Muster auf solche mit
 * ausreichend festem Text – für Felder, in denen auch frei geschriebener Text stehen kann (Kommentarauszüge,
 * Änderungsnotizen), damit kurze Muster wie „Bild: {}“ keine Sätze der Nutzerinnen und Nutzer verändern.
 */
export function translate(text: string, locale: Locale, minFixed = 0): string {
  if (locale === 'de' || !text) return text;
  const table = compile();
  const direct = table.get(text);
  if (direct !== undefined) return direct;
  // Muster nur für übliche Längen – lange Texte (z. B. eingefügte Inhalte) bleiben unverändert, statt die
  // Musterprüfung mit vielen Rückverfolgungsschritten zu belasten
  if (text.length > MAX_PATTERN_INPUT) return text;
  for (const pattern of patterns) {
    if (pattern.weight < minFixed) break;
    const match = pattern.re.exec(text);
    if (!match) continue;
    let next = 0;
    // Eingesetzte Werte nur übersetzen, wenn sie selbst ein fester Katalogtext sind (z. B. „morgen“)
    return pattern.en.replace(/\{(\d*)\}/g, (_, index: string) => {
      const value = match[index ? Number(index) : ++next] ?? '';
      return table.get(value) ?? value;
    });
  }
  return text;
}

/** Mindestlänge festen Textes für Muster in Feldern mit möglichem Freitext. */
export const FREE_TEXT_MIN_FIXED = 14;

/** Übersetzer für eine Sprache – praktisch für mehrere Texte hintereinander. */
export function translator(locale: Locale): (text: string) => string {
  return (text) => translate(text, locale);
}

/**
 * Sprache einer Anfrage: ausdrücklich gewählt (Kopfzeile X-Knowstead-Locale der Oberfläche), persönliche
 * Einstellung, sonst die Standardsprache der Installation. Die Browsersprache zählt nur für Anfragen ohne
 * Sitzung (Skripte, API-Tokens) – angemeldete Personen sehen dieselbe Sprache wie in der Oberfläche.
 */
export function requestLocale(req: FastifyRequest, fallback: Locale): Locale {
  const header = headerValue(req.headers, 'locale');
  if (isLocale(header)) return header;
  const preference = req.auth?.user?.preferences?.locale;
  if (isLocale(preference)) return preference;
  if (req.auth?.via === 'session') return fallback;
  const accepted = String(req.headers['accept-language'] ?? '')
    .split(',')[0]
    ?.trim()
    .slice(0, 2)
    .toLowerCase();
  if (isLocale(accepted)) return accepted;
  return fallback;
}

/** Sprache für E-Mails und Benachrichtigungen an eine Person. */
export function localeOfPreferences(preferences: Record<string, unknown> | null | undefined, fallback: Locale): Locale {
  return isLocale(preferences?.locale) ? preferences.locale : fallback;
}

/** Datum im üblichen Format der Sprache. */
export function formatDay(value: string | Date, locale: Locale): string {
  return new Date(value).toLocaleDateString(locale === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Typen von lang.mjs – nur für die Tests (server/test), die Skripte selbst laufen ohne sie.

export type Lang = 'de' | 'en';
/** Sprache der Meldungen: ausdrücklich gewählt, sonst KNOWSTEAD_LANG, sonst die Sprache des Systems. */
export function resolveLanguage(explicit?: string | null, env?: Record<string, string | undefined>): Lang;
export function texts(lang: Lang): (de: string, en: string) => string;

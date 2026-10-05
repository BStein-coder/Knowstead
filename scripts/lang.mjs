/**
 * Sprache der Meldungen von Installation und Start: Deutsch oder Englisch.
 *
 * Reihenfolge: ausdrücklich gewählt (--lang de|en) → Umgebungsvariable KNOWSTEAD_LANG → Sprache des Systems
 * (LC_ALL, LC_MESSAGES, LANG; unter Windows die Regionseinstellung). Deutsch, wenn die Angabe mit „de“
 * beginnt – sonst Englisch. Dieselbe Regel gilt in install.sh, start.sh und im Assistenten unter Windows.
 */

/** @typedef {'de' | 'en'} Lang */

/**
 * @param {string | undefined | null} [explicit] Wert von --lang
 * @param {Record<string, string | undefined>} [env]
 * @returns {Lang}
 */
export function resolveLanguage(explicit, env = process.env) {
  if (explicit !== undefined && explicit !== null && explicit !== '') {
    if (explicit !== 'de' && explicit !== 'en') throw new Error(`Unbekannte Sprache / unknown language: ${explicit} (de, en)`);
    return explicit;
  }
  /** @returns {Lang | null} */
  const pick = (value) => (typeof value === 'string' && value.trim() ? (/^de/i.test(value.trim()) ? 'de' : 'en') : null);
  const chosen = pick(env.KNOWSTEAD_LANG);
  if (chosen) return chosen;
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = env[name];
    // „C“ und „POSIX“ sagen nichts über die Sprache der Person – dann entscheidet die Regionseinstellung
    if (value && !/^(C|POSIX)(\.|$)/i.test(value)) return pick(value) ?? 'en';
  }
  let system = '';
  try {
    system = new Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    /* ohne Sprachdaten: Englisch */
  }
  return pick(system) ?? 'en';
}

/**
 * Text in der gewählten Sprache: `const L = texts(lang); L('deutsch', 'english')`.
 * @param {Lang} lang
 * @returns {(de: string, en: string) => string}
 */
export function texts(lang) {
  return (de, en) => (lang === 'en' ? en : de);
}

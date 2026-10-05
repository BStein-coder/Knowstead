const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };

/** URL-freundlicher Slug, z. B. „Über uns & Team“ → „ueber-uns-team“. */
export function slugify(input: string, maxLength = 80): string {
  return (
    input
      .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c] ?? c)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLength)
      .replace(/-+$/g, '') || 'seite'
  );
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

export function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

/** Stabile, angenehme Avatarfarbe aus einem String. */
export function colorFor(seed: string): string {
  const palette = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#0891b2', '#4f46e5'];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/** Wie die Prüfung beim Versand (`EMAIL_RE`): Adressen, die nicht zustellbar wären, gar nicht erst speichern. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(value);
}

/** Einfaches Platzhalter-Matching für Ereignistypen: `*`, `page.*`, `page.updated`. */
export function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === '*' || pattern === value) return true;
  if (pattern.endsWith('.*')) return value.startsWith(pattern.slice(0, -1));
  return false;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function formatDateDe(date: Date): string {
  return new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

export function toInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : fallback;
}

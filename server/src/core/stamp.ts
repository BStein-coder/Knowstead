/**
 * „Stand: 03.11.2026 09:15“ – eine Zeitangabe, die jemand beim Prüfen einer Seite nachführt. Unterscheiden sich zwei
 * Fassungen nur in solchen Angaben, ist das keine neue Version wert (`PageService.save`).
 *
 * Erkannt wird ein Hinweiswort („Stand“, „Zuletzt aktualisiert“, „Last updated“, „As of“), danach ein vollständiges
 * Datum (03.11.2026, 3.11.26, 2026-11-03, 11/03/2026, 3. November 2026, November 3, 2026) und danach, wenn vorhanden,
 * eine Uhrzeit (09:15, 9.15 Uhr, 09:15:22, 9:15 PM). Dazwischen dürfen Leerraum, Doppelpunkt, Komma, „um“ und
 * einfache Auszeichnung (fett, kursiv, Spanne, Tabellenzelle; Markdown-Sterne) stehen – aber keine Absätze, damit ein
 * Datum im nächsten Absatz nicht mit verschluckt wird. „Stand 2026“ (ohne vollständiges Datum) ist keine Angabe.
 *
 * Jede Schleife besteht nur aus Alternativen mit verschiedenem ersten Zeichen und hat damit keine überlappenden
 * Möglichkeiten: die Laufzeit wächst linear mit der Länge (wichtig, weil der Inhalt von außen kommt).
 */

const INLINE = String.raw`(?:strong|b|em|i|u|s|span|code|small|mark|font|sub|sup)`;
const INLINE_TAG = String.raw`<\/?${INLINE}\b[^>]{0,200}>`;
const CELL_TAG = String.raw`<\/?(?:td|th)\b[^>]{0,200}>`;

/** Zwischen Hinweiswort und Datum: Leerraum, Doppelpunkt, Markdown-Auszeichnung, einfache Tags, Tabellenzellen. */
const BEFORE_DATE = String.raw`(?:[\s:*_]|&nbsp;|${INLINE_TAG}|${CELL_TAG})*`;
/** Zwischen Datum und Uhrzeit. */
const BEFORE_TIME = String.raw`(?:[\s,;·–\-*_T]|&nbsp;|\bum\b|\bat\b|${INLINE_TAG})*`;

const MONTH = String.raw`(?:jan(?:uar|uary)?|feb(?:ruar|ruary)?|m(?:ä|ae)rz|mrz|mar(?:ch)?|apr(?:il)?|mai|may|jun[ie]?|jul[iy]?|aug(?:ust)?|sep(?:t(?:ember)?)?|okt(?:ober)?|oct(?:ober)?|nov(?:ember)?|dez(?:ember)?|dec(?:ember)?)`;
const SP = String.raw`[ \u00a0]?`;
const DATE = [
  String.raw`\d{1,2}\.${SP}\d{1,2}\.${SP}(?:\d{4}|\d{2})(?!\d)`,
  String.raw`\d{4}-\d{2}-\d{2}(?!\d)`,
  String.raw`\d{1,2}\/\d{1,2}\/(?:\d{4}|\d{2})(?!\d)`,
  String.raw`\d{1,2}\.?${SP}${MONTH}\.?,?${SP}\d{4}(?!\d)`,
  String.raw`${MONTH}\.?${SP}\d{1,2},?${SP}\d{4}(?!\d)`,
].join('|');
const TIME = String.raw`\d{1,2}[:.]\d{2}(?::\d{2})?(?!\d)(?:${SP}(?:uhr|h|am|pm)\b)?`;

const STAMP = new RegExp(String.raw`(\b(?:Stand|Zuletzt aktualisiert|Last updated|As of)${BEFORE_DATE})(?:${DATE})(${BEFORE_TIME})(${TIME})?`, 'gi');

/** Zwischen Datum und Uhrzeit zählt nur die Auszeichnung; ob Leerzeichen, Komma, „um“ oder „T“ trennt, nicht. */
const TAGS = /<[^>]*>/g;

/** Die Angaben durch feste Platzhalter ersetzen – nur so bleibt vergleichbar, was darum herum steht. */
export function normalizeStamps(content: string): string {
  return content.replace(STAMP, (_all, label: string, gap: string, time: string | undefined) =>
    time ? `${label}${gap.match(TAGS)?.join('') ?? ''}` : `${label}${gap}`,
  );
}

/** Unterscheiden sich die beiden Fassungen, aber ausschließlich in solchen Stand-Angaben? */
export function onlyStampsDiffer(before: string, after: string): boolean {
  return before !== after && normalizeStamps(before) === normalizeStamps(after);
}

/**
 * Schriften und Zeichenabdeckung für den PDF-Export.
 *
 * pdfmake kennt keine automatische Ersatzschrift: Zeichen, die in Roboto fehlen
 * (Pfeile, geometrische Formen …), werden deshalb abschnittsweise aus Liberation
 * Sans gesetzt, einige Symbole durch verwandte Zeichen ersetzt und Emoji entfernt,
 * statt als leere Kästchen im Dokument zu landen. Word braucht das nicht – dort
 * greift die Schriftersetzung von Office.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export type FontStyles = Record<'normal' | 'bold' | 'italics' | 'bolditalics', string>;

export interface FontFiles {
  roboto: FontStyles;
  liberation: FontStyles;
}

let files: FontFiles | null = null;

/** Mitgelieferte Schriftdateien: Roboto aus pdfmake, Liberation Sans aus pdf.js. */
export function fontFiles(): FontFiles {
  if (files) return files;
  const robotoDir = path.join(path.dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto');
  const liberationDir = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts');
  const next: FontFiles = {
    roboto: {
      normal: path.join(robotoDir, 'Roboto-Regular.ttf'),
      bold: path.join(robotoDir, 'Roboto-Medium.ttf'),
      italics: path.join(robotoDir, 'Roboto-Italic.ttf'),
      bolditalics: path.join(robotoDir, 'Roboto-MediumItalic.ttf'),
    },
    liberation: {
      normal: path.join(liberationDir, 'LiberationSans-Regular.ttf'),
      bold: path.join(liberationDir, 'LiberationSans-Bold.ttf'),
      italics: path.join(liberationDir, 'LiberationSans-Italic.ttf'),
      bolditalics: path.join(liberationDir, 'LiberationSans-BoldItalic.ttf'),
    },
  };
  for (const file of [...Object.values(next.roboto), ...Object.values(next.liberation)]) {
    if (!fs.existsSync(file)) throw new Error(`Schriftdatei fehlt: ${file}`);
  }
  files = next;
  return next;
}

interface Coverage {
  main: (cp: number) => boolean;
  fallback: (cp: number) => boolean;
}

let coverage: Coverage | null = null;

function cached(test: (cp: number) => boolean): (cp: number) => boolean {
  const memo = new Map<number, boolean>();
  return (cp) => {
    let hit = memo.get(cp);
    if (hit === undefined) {
      hit = test(cp);
      memo.set(cp, hit);
    }
    return hit;
  };
}

/** Glyphen über fontkit (Abhängigkeit von PDFKit) nachschlagen; ohne fontkit wird nichts umgestellt. */
function fontCoverage(): Coverage {
  if (coverage) return coverage;
  try {
    const pdfkit = require.resolve('pdfkit', { paths: [path.dirname(require.resolve('pdfmake/package.json'))] });
    const fontkit = createRequire(pdfkit)('fontkit') as { openSync: (file: string) => { hasGlyphForCodePoint: (cp: number) => boolean } };
    const main = fontkit.openSync(fontFiles().roboto.normal);
    const fallback = fontkit.openSync(fontFiles().liberation.normal);
    coverage = { main: cached((cp) => main.hasGlyphForCodePoint(cp)), fallback: cached((cp) => fallback.hasGlyphForCodePoint(cp)) };
  } catch {
    coverage = { main: () => true, fallback: () => false };
  }
  return coverage;
}

/** Ersatz für Zeichen, die keine der Schriften enthält. */
const SUBSTITUTES: Record<string, string> = {
  '✓': '√',
  '✔': '√',
  '✅': '√',
  '☑': '■',
  '☒': '■',
  '☐': '□',
  '✗': '×',
  '✘': '×',
  '❌': '×',
  '✕': '×',
  '✖': '×',
  '⇒': '→',
  '⟹': '→',
  '➔': '→',
  '➜': '→',
  '➡': '→',
  '⟶': '→',
  '⇐': '←',
  '⟸': '←',
  '⬅': '←',
  '⟵': '←',
  '⇔': '↔',
  '⟺': '↔',
  '⟷': '↔',
  '⬆': '↑',
  '⬇': '↓',
  '★': '*',
  '☆': '*',
  '⚠': '!',
  'ℹ': 'i',
};

/** Emoji und unsichtbare Emoji-Bestandteile (Variantenwähler, Verbinder, Hauttöne …). */
// Variantenwähler und Verbinder stehen bewusst einzeln in der Klasse – sie sollen auch allein entfernt werden
// eslint-disable-next-line no-misleading-character-class
const DROP = /[\p{Extended_Pictographic}\p{Emoji_Component}\u200d\ufe0e\ufe0f]/u;

const WIN_ANSI_EXTRA = new Set([...'€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ'].map((c) => c.codePointAt(0)!));

/** Zeichen der Standardschrift Courier (WinAnsi-Kodierung). */
function inWinAnsi(cp: number): boolean {
  return (cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff) || WIN_ANSI_EXTRA.has(cp);
}

export interface Segment {
  text: string;
  /** mit der Ersatzschrift setzen */
  fallback: boolean;
}

/** Text in Abschnitte für Haupt- und Ersatzschrift zerlegen. */
export function segments(text: string, mono = false): Segment[] {
  const cov = fontCoverage();
  const primary = mono ? inWinAnsi : cov.main;
  const out: Segment[] = [];
  const push = (chunk: string, fallback: boolean) => {
    const last = out[out.length - 1];
    if (last && last.fallback === fallback) last.text += chunk;
    else out.push({ text: chunk, fallback });
  };
  const place = (ch: string): boolean => {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80 || primary(cp)) push(ch, false);
    else if (cov.fallback(cp)) push(ch, true);
    else return false;
    return true;
  };
  for (const ch of text) {
    if (ch === '\n' || ch === '\t') {
      push(ch, false);
      continue;
    }
    if (place(ch)) continue;
    const sub = SUBSTITUTES[ch];
    if (sub !== undefined) {
      for (const s of sub) if (!place(s)) push(s, false);
      continue;
    }
    if (DROP.test(ch)) continue;
    push(ch, false);
  }
  return out;
}

/** Texte in SVG-Grafiken (dort gibt es nur eine Schrift je Textelement): ersetzen oder entfernen. */
export function svgTextForPdf(svg: string): string {
  const cov = fontCoverage();
  const clean = (text: string) => {
    let out = '';
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x80 || cov.fallback(cp)) out += ch;
      else if (SUBSTITUTES[ch] !== undefined) out += SUBSTITUTES[ch];
      else if (!DROP.test(ch)) out += ch;
    }
    return out;
  };
  // <style>-Blöcke (eingebettete Schriften) unverändert lassen
  return svg
    .split(/(<style[\s\S]*?<\/style>)/i)
    .map((part) => (/^<style/i.test(part) ? part : part.replace(/>([^<]+)</g, (_, text: string) => `>${clean(text)}<`)))
    .join('');
}

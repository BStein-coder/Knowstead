/**
 * Texterkennung (OCR) für eingescannte PDFs und Bilder – optional mit Tesseract auf dem Server.
 *
 * - Bilder (PNG, JPEG, TIFF, BMP, GIF, WebP) gehen direkt an Tesseract.
 * - Eingescannte PDFs haben keine Textebene; pdf.js liefert die eingebetteten Seitenbilder bereits
 *   dekodiert. Das größte Bild je Seite wird als Graustufenbild (PGM) geschrieben und erkannt – ohne
 *   Canvas, Ghostscript oder Poppler.
 *
 * Sicherheit wie bei LibreOffice: nur ein Programm namens `tesseract`, Aufruf ohne Shell, Sprachen
 * nur aus Buchstaben und `+`, Zeitlimit, begrenzte Ausgabe, höchstens ein Prozess gleichzeitig.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { OcrSettings } from '../../core/settings.ts';

export const TESSERACT_NAME = /^tesseract(\.exe)?$/i;
export const OCR_LANGUAGES = /^[a-z_]{3,20}(\+[a-z_]{3,20}){0,5}$/i;
export const OCR_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'jfif', 'tif', 'tiff', 'bmp', 'gif', 'webp', 'pnm', 'pgm', 'ppm']);
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
/** Kleinere Bilder (Logos, Linien) lohnen keine Erkennung */
const MIN_IMAGE_SIDE = 64;
const TIMEOUT_MS = 120_000;

const CANDIDATES =
  process.platform === 'win32'
    ? ['C:\\Program Files\\Tesseract-OCR\\tesseract.exe', 'C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe']
    : ['/usr/bin/tesseract', '/usr/local/bin/tesseract', '/opt/homebrew/bin/tesseract'];

export function findTesseract(settings: OcrSettings): string | null {
  if (!settings.enabled) return null;
  const configured = settings.tesseractPath.trim();
  if (configured) return TESSERACT_NAME.test(path.basename(configured)) && fs.existsSync(configured) ? configured : null;
  return CANDIDATES.find((c) => fs.existsSync(c)) ?? null;
}

export function isOcrImage(filename: string, mime: string): boolean {
  return OCR_IMAGE_EXTENSIONS.has(path.extname(filename).slice(1).toLowerCase()) || /^image\/(png|jpe?g|tiff|bmp|gif|webp)$/.test(mime);
}

function run(bin: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      // Ein Kern je Aufruf: Tesseract würde sonst alle Kerne belegen
      { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: { ...process.env, OMP_THREAD_LIMIT: '1' } },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message).toString().trim().split('\n').slice(-2).join(' ').slice(0, 300)));
        else resolve(stdout.toString());
      },
    );
  });
}

/** Text eines Bildes erkennen. */
export async function runTesseract(bin: string, input: string, languages: string): Promise<string> {
  if (!OCR_LANGUAGES.test(languages)) throw new Error('Ungültige OCR-Sprachen');
  if (fs.statSync(input).size > MAX_IMAGE_BYTES) throw new Error('Bild zu groß für die Texterkennung');
  return run(bin, [input, 'stdout', '-l', languages], TIMEOUT_MS);
}

/** Version und installierte Sprachen (für die Statusanzeige). */
export async function tesseractInfo(bin: string): Promise<{ version: string; languages: string[] }> {
  const version = (await run(bin, ['--version'], 10_000)).split('\n')[0].trim();
  const languages = (await run(bin, ['--list-langs'], 10_000))
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[a-z_]+$/i.test(l));
  return { version, languages };
}

/** Graustufen-PGM (P5) aus den Bilddaten von pdf.js. */
export function toPgm(width: number, height: number, data: Uint8Array | Uint8ClampedArray, kind: number): Buffer {
  const header = Buffer.from(`P5\n${width} ${height}\n255\n`, 'ascii');
  const pixels = Buffer.alloc(width * height);
  if (kind === 1) {
    // 1 Bit je Pixel, zeilenweise auf volle Bytes aufgefüllt; gesetztes Bit = weiß
    const rowBytes = (width + 7) >> 3;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        pixels[y * width + x] = bit ? 255 : 0;
      }
    }
  } else {
    const channels = kind === 3 ? 4 : 3;
    for (let i = 0; i < width * height; i++) {
      const o = i * channels;
      pixels[i] = Math.round(0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]);
    }
  }
  return Buffer.concat([header, pixels]);
}

interface PdfImage {
  width: number;
  height: number;
  kind: number;
  data?: Uint8Array | Uint8ClampedArray;
}

/**
 * Seitenbilder eines PDFs als PGM-Dateien in `outDir` schreiben (größtes Bild je Seite).
 * Läuft im Worker-Thread der Textgewinnung.
 */
export async function pdfPageImages(buf: Uint8Array, outDir: string, maxPages: number): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: buf, disableFontFace: true, useSystemFonts: false, verbosity: 0, isOffscreenCanvasSupported: false, isImageDecoderSupported: false });
  const files: string[] = [];
  try {
    const doc = await task.promise;
    const pages = Math.min(doc.numPages, Math.max(1, maxPages));
    for (let i = 1; i <= pages; i++) {
      const page = await doc.getPage(i);
      const ops = await page.getOperatorList();
      let best: PdfImage | null = null;
      for (let j = 0; j < ops.fnArray.length; j++) {
        const fn = ops.fnArray[j];
        let image: PdfImage | null = null;
        if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintImageXObjectRepeat) {
          const name = ops.argsArray[j][0] as string;
          const store = name.startsWith('g_') ? page.commonObjs : page.objs;
          image = await new Promise<PdfImage | null>((resolve) => {
            try {
              store.get(name, (obj: unknown) => resolve(obj as PdfImage));
            } catch {
              resolve(null);
            }
          });
        } else if (fn === pdfjs.OPS.paintInlineImageXObject) {
          image = ops.argsArray[j][0] as PdfImage;
        }
        if (image?.data && image.width >= MIN_IMAGE_SIDE && image.height >= MIN_IMAGE_SIDE && (!best || image.width * image.height > best.width * best.height)) best = image;
      }
      if (best?.data) {
        const file = path.join(outDir, `seite-${String(i).padStart(4, '0')}.pgm`);
        fs.writeFileSync(file, toPgm(best.width, best.height, best.data, best.kind));
        files.push(file);
      }
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return files;
}

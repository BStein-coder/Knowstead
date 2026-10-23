/**
 * Kontrastprüfung gegen die wirklich gezeichneten Bildpunkte.
 *
 * axe-core misst Text gegen die Hintergrundfarbe der Elemente darüber – Lichtflecken, Farbverläufe und Glas mit
 * Unschärfe dahinter sieht es nicht (ein Pseudo-Element ist für axe kein Hintergrund). Bei „Glas“ und „Papier“
 * liegt der Text aber genau darauf. Dieses Werkzeug macht deshalb das Gegenteil: Es blendet alle Schrift aus,
 * fotografiert die Seite und misst für jeden Text den ungünstigsten Bildpunkt hinter seinem Rahmen gegen die
 * tatsächliche Schriftfarbe (mit Deckkraft). Schwelle: 4,5 : 1, für große Schrift (ab 24 px oder ab 18,66 px fett) 3 : 1.
 *
 * Aufruf (die Oberfläche muss gebaut sein):
 *   node contrast-scan.mjs [--look classic,paper,frost] [--scheme light,dark] [--views home,board] [--width 1440] [--height 900]
 * Im Projektordner:  npm run test:contrast
 *
 * Ergebnis: Auffälligkeiten auf der Konsole und in reports/contrast-scan.txt; Rückgabewert 1, wenn es welche gibt.
 * Gemessen wird, was im Fenster zu sehen ist (kein Scrollen). Deaktivierte Bedienelemente sind ausgenommen (WCAG 1.4.3).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { startInstance } from './support/instance.mjs';
import { views } from './support/views.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const channel = process.env.E2E_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : undefined);

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const looks = option('look', 'classic,paper,frost').split(',');
const schemes = option('scheme', 'light,dark').split(',');
const width = Number(option('width', 1440));
const height = Number(option('height', 900));
const wanted = option('views', '').split(',').filter(Boolean);

/* global document, getComputedStyle, NodeFilter, window, Image -- die folgenden Funktionen laufen im Browser */

/** Alle sichtbaren Texte mit Rahmen, Farbe und Größe. */
function collect() {
  const canvas = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const rgba = (value) => {
    const m = /^rgba?\(([^)]+)\)$/.exec(value);
    if (m) {
      const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p[3] ?? 1];
    }
    const s = /^color\(srgb ([^)]+)\)$/.exec(value);
    if (s) {
      const p = s[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return [p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1];
    }
    canvas.clearRect(0, 0, 1, 1);
    canvas.fillStyle = value;
    canvas.fillRect(0, 0, 1, 1);
    const d = canvas.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2], d[3] / 255];
  };
  const out = [];
  // Ist ein Dialog offen, liegt die Seite dahinter abgedunkelt und unbedienbar – gemessen wird nur der Dialog
  const modal = document.querySelector('.modal, [role="dialog"][aria-modal="true"]');
  const walker = document.createTreeWalker(modal ?? document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    const el = node.parentElement;
    if (!text || !el || el.closest('script, style, noscript, [hidden], [aria-hidden="true"], :disabled, [aria-disabled="true"]')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== 'visible' || cs.display === 'none') continue;
    // Beschriftung eines deaktivierten Schalters oder Feldes: ausgenommen wie das Feld selbst
    if (el.closest('.switch:has(:disabled), label:has(:disabled), fieldset:disabled')) continue;
    let opacity = 1;
    for (let e = el; e; e = e.parentElement) opacity *= parseFloat(getComputedStyle(e).opacity);
    if (opacity < 0.05) continue;
    if (opacity < 0.99) {
      // Halbtransparent samt eigener Fläche (z. B. ein abgeblendeter Avatar): Das Bild enthält den Grund schon abgeblendet,
      // die Schrift ließe sich nicht mehr getrennt davon rechnen – nicht messbar
      let own = false;
      for (let e = el; e; e = e.parentElement) {
        if (rgba(getComputedStyle(e).backgroundColor)[3] > 0.5) own = true;
        if (parseFloat(getComputedStyle(e).opacity) < 1) break;
      }
      if (own) continue;
    }
    const fill = cs.webkitTextFillColor && cs.webkitTextFillColor !== 'currentcolor' ? cs.webkitTextFillColor : cs.color;
    const color = rgba(fill);
    if (color[3] === 0) continue; // Verlaufsschrift u. Ä.: nicht messbar
    const range = document.createRange();
    range.selectNodeContents(node);
    const box = el.getBoundingClientRect();
    for (const full of range.getClientRects()) {
      // Abgeschnittener Text (Auslassungspunkte): sein Rahmen reicht über das Element hinaus, sichtbar ist nur der Teil darin
      const r = { left: Math.max(full.left, box.left), top: Math.max(full.top, box.top), right: Math.min(full.right, box.right), bottom: Math.min(full.bottom, box.bottom) };
      r.width = r.right - r.left;
      r.height = r.bottom - r.top;
      if (r.width < 2 || r.height < 4 || r.right < 0 || r.bottom < 0 || r.left > window.innerWidth || r.top > window.innerHeight) continue;
      // Abgeschnitten (in einem scrollenden Bereich) oder verdeckt: Was an dieser Stelle nicht dieses Element zeigt, sieht niemand
      const top = document.elementFromPoint(Math.min(window.innerWidth - 1, Math.max(0, r.left + r.width / 2)), Math.min(window.innerHeight - 1, Math.max(0, r.top + r.height / 2)));
      if (!top || !el.contains(top)) continue;
      const size = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      out.push({
        text: text.slice(0, 50),
        selector: `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}`,
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        color,
        opacity,
        large: size >= 24 || (size >= 18.66 && bold),
      });
    }
  }
  return out;
}

/** Schrift ausblenden, damit das Bild nur noch den Hintergrund zeigt. */
function hideText() {
  const style = document.createElement('style');
  style.textContent = '*, *::before, *::after { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; } ::placeholder { color: transparent !important; }';
  document.head.append(style);
}

/** Läuft in einer leeren Seite: misst je Text den ungünstigsten Bildpunkt. */
async function analyze({ png, items }) {
  const img = new Image();
  img.src = `data:image/png;base64,${png}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const lum = (r, g, b) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const bad = [];
  for (const item of items) {
    // Der Zeilenkasten ist höher als die Buchstaben (Zeilenhöhe 1,4): Gemessen wird die Mitte, sonst zählen Pixel von
    // Rändern und Rundungen (z. B. der Kreis eines kleinen Avatars) mit
    const insetY = item.height * 0.22;
    const insetX = Math.min(2, item.width * 0.05);
    const x0 = Math.max(0, Math.floor(item.left + insetX));
    const y0 = Math.max(0, Math.floor(item.top + insetY));
    const x1 = Math.min(img.width, Math.ceil(item.left + item.width - insetX));
    const y1 = Math.min(img.height, Math.ceil(item.top + item.height - insetY));
    if (x1 <= x0 || y1 <= y0) continue;
    const { data } = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    const alpha = item.color[3] * item.opacity;
    let min = Infinity;
    let worst = '';
    for (let i = 0; i < data.length; i += 4 * 2) {
      const bg = [data[i], data[i + 1], data[i + 2]];
      const fg = [0, 1, 2].map((k) => item.color[k] * alpha + bg[k] * (1 - alpha));
      const a = lum(...fg);
      const b = lum(...bg);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      if (ratio < min) {
        min = ratio;
        worst = `${hex(...fg)} auf ${hex(...bg)}`;
      }
    }
    const need = item.large ? 3 : 4.5;
    if (min < need) bad.push({ text: item.text, selector: item.selector, ratio: Math.round(min * 100) / 100, need, worst });
  }
  return bad;
}

const instance = await startInstance({ port: process.env.E2E_SCAN_PORT ?? 3896, ui: 'en' });
const findings = [];
let measured = 0;
let browser = null;
try {
  const { base, cookie, ids } = instance;
  const name = cookie.slice(0, cookie.indexOf('='));
  const value = cookie.slice(cookie.indexOf('=') + 1);
  browser = await chromium.launch(channel ? { channel } : {});
  const list = views(ids).filter(([view]) => !wanted.length || wanted.includes(view));
  const lab = await (await browser.newContext()).newPage();
  for (const look of looks) {
    for (const scheme of schemes) {
      for (const [view, url, storage, action] of list) {
        const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, locale: 'en-GB' });
        await context.addCookies([{ name, value, url: base, httpOnly: true, sameSite: 'Lax' }]);
        await context.addInitScript(
          ([lookName, schemeName, extra]) => {
            localStorage.setItem('knowstead.locale', 'en');
            localStorage.setItem('knowstead.theme', schemeName);
            localStorage.setItem('knowstead.appearance', lookName);
            // Ruhig, aber mit Glas: „reduziert“ würde die Unschärfe abschalten und damit nicht das prüfen, was man sieht
            localStorage.setItem('knowstead.motion', 'full');
            for (const [key, entry] of Object.entries(extra ?? {})) localStorage.setItem(key, entry);
          },
          [look, scheme, storage ?? null],
        );
        const page = await context.newPage();
        try {
          await page.emulateMedia({ reducedMotion: 'reduce' });
          await page.goto(base + url, { waitUntil: 'networkidle', timeout: 30_000 });
          if (action) await action(page);
          await page.waitForTimeout(900);
          const items = await page.evaluate(collect);
          await page.evaluate(hideText);
          await page.waitForTimeout(150);
          const png = (await page.screenshot()).toString('base64');
          const bad = await lab.evaluate(analyze, { png, items });
          measured += items.length;
          for (const b of bad) findings.push({ look, scheme, view, ...b });
          console.log(`${look}-${scheme} ${view}: ${items.length} Texte, ${bad.length} unter der Schwelle`);
        } catch (err) {
          findings.push({ look, scheme, view, text: '', selector: '', ratio: 0, need: 0, worst: `nicht geprüft: ${String(err instanceof Error ? err.message : err).split('\n')[0]}` });
        }
        await context.close();
      }
    }
  }
} finally {
  await browser?.close();
  await instance.stop();
}

// Gleiche Befunde über Ansichten hinweg zusammenfassen
const merged = new Map();
for (const f of findings) {
  const key = `${f.look}-${f.scheme} | ${f.selector} | ${f.text}`;
  const entry = merged.get(key);
  if (entry) entry.views.add(f.view);
  else merged.set(key, { ...f, views: new Set([f.view]) });
}
const lines = [...merged.values()]
  .sort((a, b) => a.ratio - b.ratio)
  .map((f) => `${`${f.look}-${f.scheme}`.padEnd(13)} ${String(f.ratio).padStart(5)} (nötig ${f.need})  ${f.worst.padEnd(19)} ${f.selector}  „${f.text}“  [${[...f.views].join(', ')}]`);
fs.mkdirSync(path.join(here, 'reports'), { recursive: true });
fs.writeFileSync(path.join(here, 'reports', 'contrast-scan.txt'), lines.length ? `${lines.join('\n')}\n` : '');
for (const line of lines) console.log(line);
console.log(`\n${measured} Texte gemessen – ${lines.length ? `${lines.length} Auffälligkeiten (reports/contrast-scan.txt)` : 'alle erreichen die Schwelle'}.`);
process.exit(lines.length || !measured ? 1 : 0);

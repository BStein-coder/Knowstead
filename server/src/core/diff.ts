import { diffArrays, diffLines } from 'diff';

const TOKEN = /(<[^>]+>)|([\p{L}\p{N}_]+)|(\s+)|([^\s<])/gu;
const MAX_TOKENS = 60000;

/** Makros ohne Textinhalt, deren Änderungen als Marker angezeigt werden. */
const ATOM_LABELS: Record<string, string> = {
  mermaid: 'Diagramm',
  toc: 'Inhaltsverzeichnis',
  children: 'Unterseiten',
  'include-page': 'Eingebundene Seite',
  'api-data': 'API-Daten',
  'block-math': 'Formel',
  'inline-math': 'Formel',
  changelog: 'Änderungshistorie',
  'recent-pages': 'Zuletzt geändert',
  'properties-report': 'Eigenschaften-Bericht',
  attachments: 'Anhänge',
  embed: 'Einbettung',
  gallery: 'Galerie',
  drawio: 'draw.io-Diagramm',
  whiteboard: 'Whiteboard',
  'plugin-macro': 'Plugin-Makro',
};

function tokenize(html: string): string[] {
  const tokens: string[] = [];
  for (const m of html.matchAll(TOKEN)) tokens.push(m[0]);
  return tokens;
}

const isTag = (t: string) => t.startsWith('<');
const VOID_TAG = /^<(img|hr|iframe)\b/i;
const ATOM_TAG = /^<(?:div|span)\b[^>]*data-type="([a-z-]+)"/i;

export interface DiffStats {
  added: number;
  removed: number;
}

/**
 * Visueller HTML-Diff: Die Struktur des neuen Dokuments bleibt erhalten,
 * entfernter Text wird mit `<del>`, neuer Text mit `<ins>` markiert.
 */
export function htmlDiff(oldHtml: string, newHtml: string): { html: string; stats: DiffStats } | null {
  const a = tokenize(oldHtml);
  const b = tokenize(newHtml);
  if (a.length + b.length > MAX_TOKENS) return null;
  const changes = diffArrays(a, b);
  const out: string[] = [];
  const stats: DiffStats = { added: 0, removed: 0 };

  const emitRun = (tokens: string[], kind: 'ins' | 'del') => {
    const openTag = kind === 'ins' ? '<ins class="knowstead-diff-ins">' : '<del class="knowstead-diff-del">';
    const openBlock = kind === 'ins' ? '<ins class="knowstead-diff-ins knowstead-diff-block">' : '<del class="knowstead-diff-del knowstead-diff-block">';
    const closeTag = kind === 'ins' ? '</ins>' : '</del>';
    let open = false;
    const close = () => {
      if (open) out.push(closeTag);
      open = false;
    };
    for (const t of tokens) {
      if (isTag(t)) {
        close();
        if (VOID_TAG.test(t)) {
          out.push(openBlock, t, closeTag);
          if (kind === 'ins') stats.added++;
          else stats.removed++;
          continue;
        }
        const atom = t.match(ATOM_TAG);
        if (atom && ATOM_LABELS[atom[1]]) {
          out.push(openBlock, `⟨${ATOM_LABELS[atom[1]]}⟩`, closeTag);
          if (kind === 'ins') {
            out.push(t);
            stats.added++;
          } else stats.removed++;
          continue;
        }
        // Neue Struktur behalten, alte Struktur verwerfen.
        if (kind === 'ins') out.push(t);
        continue;
      }
      if (!open) {
        out.push(openTag);
        open = true;
      }
      out.push(t);
      if (/\S/.test(t)) {
        if (kind === 'ins') stats.added++;
        else stats.removed++;
      }
    }
    close();
  };

  for (const change of changes) {
    if (change.added) emitRun(change.value, 'ins');
    else if (change.removed) emitRun(change.value, 'del');
    else out.push(...change.value);
  }
  return { html: out.join(''), stats };
}

export interface LineChange {
  type: 'equal' | 'add' | 'del';
  text: string;
}

/** Zeilenbasierter Diff für Quelltext-/Markdown-Ansichten. */
export function lineDiff(oldText: string, newText: string): { lines: LineChange[]; stats: DiffStats } {
  // Einheitliche Zeilenenden, damit die letzte Zeile nicht nur wegen fehlendem \n als geändert gilt.
  const norm = (s: string) => {
    const t = s.replace(/\r\n/g, '\n');
    return t.endsWith('\n') ? t : `${t}\n`;
  };
  const changes = diffLines(norm(oldText), norm(newText));
  const lines: LineChange[] = [];
  const stats: DiffStats = { added: 0, removed: 0 };
  for (const c of changes) {
    const type: LineChange['type'] = c.added ? 'add' : c.removed ? 'del' : 'equal';
    const parts = c.value.replace(/\n$/, '').split('\n');
    for (const text of parts) {
      lines.push({ type, text });
      if (type === 'add') stats.added++;
      if (type === 'del') stats.removed++;
    }
  }
  return { lines, stats };
}

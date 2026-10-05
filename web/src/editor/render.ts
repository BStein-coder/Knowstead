import hljs from 'highlight.js/lib/common';
import { currentTheme } from '../lib/theme';

let mermaidPromise: Promise<typeof import('mermaid')['default']> | null = null;
let initializedTheme: string | null = null;
let counter = 0;

async function getMermaid() {
  mermaidPromise ??= import('mermaid').then((m) => m.default);
  const mermaid = await mermaidPromise;
  const theme = currentTheme() === 'dark' ? 'dark' : 'default';
  if (initializedTheme !== theme) {
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: 'inherit' });
    initializedTheme = theme;
  }
  return mermaid;
}

/** Rendert Mermaid-Code zu SVG (lazy geladen). */
export async function renderMermaid(code: string): Promise<string> {
  const mermaid = await getMermaid();
  const id = `mmd-${Date.now().toString(36)}-${counter++}`;
  try {
    const { svg } = await mermaid.render(id, code);
    return svg;
  } finally {
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
}

export function highlightCode(code: string, language?: string | null): string {
  try {
    if (language && hljs.getLanguage(language)) return hljs.highlight(code, { language, ignoreIllegals: true }).value;
    return hljs.highlightAuto(code).value;
  } catch {
    return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}

export function languageList(): string[] {
  return hljs.listLanguages().sort();
}

export const COMMON_LANGUAGES = [
  'plaintext', 'bash', 'shell', 'powershell', 'javascript', 'typescript', 'json', 'yaml', 'xml', 'html', 'css', 'scss', 'sql',
  'python', 'java', 'kotlin', 'csharp', 'cpp', 'c', 'go', 'rust', 'php', 'ruby', 'swift', 'markdown', 'ini', 'dockerfile', 'nginx', 'diff', 'http', 'graphql',
];

/** Verbessert statisches HTML: Syntaxhervorhebung, Mermaid-Diagramme, Überschriften-Anker. */
export async function enhanceHtml(root: HTMLElement): Promise<void> {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code')) {
    const lang = [...code.classList].find((c) => c.startsWith('language-'))?.slice(9);
    if (lang === 'mermaid') {
      const pre = code.parentElement!;
      const div = document.createElement('div');
      div.setAttribute('data-type', 'mermaid');
      div.setAttribute('data-code', code.textContent ?? '');
      pre.replaceWith(div);
      continue;
    }
    if (code.dataset.highlighted) continue;
    code.innerHTML = highlightCode(code.textContent ?? '', lang);
    code.classList.add('hljs');
    code.dataset.highlighted = 'yes';
  }
  for (const el of root.querySelectorAll<HTMLElement>('div[data-type="mermaid"]')) {
    const source = el.getAttribute('data-code') ?? '';
    try {
      el.innerHTML = await renderMermaid(source);
      el.classList.add('mermaid-view');
    } catch {
      el.innerHTML = '';
      const pre = document.createElement('pre');
      pre.textContent = source;
      el.appendChild(pre);
    }
  }
  const used = new Map<string, number>();
  for (const h of root.querySelectorAll<HTMLElement>('h1, h2, h3, h4')) {
    if (h.id) continue;
    const text = (h.textContent ?? '').trim();
    const base =
      text
        .toLowerCase()
        .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'abschnitt';
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    h.id = n ? `${base}-${n + 1}` : base;
  }
  for (const table of root.querySelectorAll<HTMLElement>('table')) {
    if (table.parentElement?.classList.contains('table-scroll')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'table-scroll';
    table.replaceWith(wrap);
    wrap.appendChild(table);
  }
}

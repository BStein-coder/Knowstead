import { Marked } from 'marked';
import TurndownService from 'turndown';
import { gfm } from '@joplin/turndown-plugin-gfm';
import { parse } from 'node-html-parser';
import { escapeHtml } from './html.ts';
import { badRequest } from './errors.ts';

const ALERT_VARIANTS: Record<string, string> = {
  NOTE: 'info',
  TIP: 'success',
  IMPORTANT: 'note',
  WARNING: 'warning',
  CAUTION: 'error',
};
const VARIANT_ALERTS: Record<string, string> = {
  info: 'NOTE',
  success: 'TIP',
  note: 'IMPORTANT',
  warning: 'WARNING',
  error: 'CAUTION',
};

/**
 * Zeitbudget für das Umwandeln eines Textes. Marked sucht zu jedem Unterstrich oder Stern bis zum Ende des Absatzes
 * nach dem Gegenstück; ein Absatz aus lauter einzelnen Zeichen („_x_x_x…“) braucht dadurch quadratisch lange
 * (40 KB: 1,3 s, 5 MB: Stunden). Ein echtes 5-MB-Dokument ist in unter einer Sekunde fertig.
 */
const RENDER_BUDGET_MS = 4000;
let deadline = Infinity;

/** Prüft die Frist bei jedem Schritt der Inline-Auswertung und übergibt dann an die ursprüngliche Methode (`false`). */
const withinBudget = () => {
  if (Date.now() > deadline) throw badRequest('Der Markdown-Text ist zu aufwendig zu verarbeiten – bitte in kürzere Absätze gliedern.');
  return false as const;
};

const marked = new Marked({
  gfm: true,
  breaks: false,
  tokenizer: { emStrong: withinBudget, del: withinBudget, link: withinBudget, reflink: withinBudget, url: withinBudget, inlineText: withinBudget },
});

function parseMarkdown(markdown: string): string {
  deadline = Date.now() + RENDER_BUDGET_MS;
  try {
    return marked.parse(markdown, { async: false }) as string;
  } finally {
    deadline = Infinity;
  }
}

/**
 * Markdown → HTML im Format des Knowstead-Editors.
 * Unterstützt GFM, GitHub-Hinweise (`> [!NOTE]`), Mermaid-Blöcke,
 * Aufgabenlisten und `<!-- toc -->` als Inhaltsverzeichnis-Makro.
 */
export function markdownToHtml(markdown: string): string {
  const raw = parseMarkdown(markdown.replace(/^\uFEFF/, '')).replace(
    /<!--\s*toc\s*-->/gi,
    '<div data-type="toc"></div>',
  );
  // <pre> nicht als Rohtext behandeln, damit Codeblöcke (z. B. Mermaid) als Elemente erreichbar sind.
  const root = parse(raw, { blockTextElements: { script: true, noscript: true, style: true } });

  // Mermaid-Codeblöcke → Diagramm-Makro
  for (const code of root.querySelectorAll('pre > code.language-mermaid')) {
    code.parentNode?.replaceWith(`<div data-type="mermaid" data-code="${escapeHtml(code.textContent)}"></div>`);
  }

  // GitHub-Hinweise → Hinweisboxen
  for (const bq of root.querySelectorAll('blockquote')) {
    const first = bq.querySelector('p');
    if (!first) continue;
    const m = first.innerHTML.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(<br\s*\/?>)?\s*/i);
    if (!m) continue;
    first.set_content(first.innerHTML.slice(m[0].length));
    if (!first.textContent.trim() && !first.querySelector('img')) first.remove();
    const variant = ALERT_VARIANTS[m[1].toUpperCase()] ?? 'info';
    bq.replaceWith(`<div data-type="callout" data-variant="${variant}">${bq.innerHTML || '<p></p>'}</div>`);
  }

  // Aufgabenlisten
  for (const ul of root.querySelectorAll('ul')) {
    const items = ul.childNodes.filter((n) => n.nodeType === 1) as ReturnType<typeof parse>[];
    if (!items.length || !items.every((li) => li.querySelector('input[type="checkbox"]'))) continue;
    const html = items
      .map((li) => {
        const input = li.querySelector('input[type="checkbox"]');
        const checked = input?.hasAttribute('checked') ?? false;
        input?.remove();
        const inner = li.innerHTML.trim();
        const body = /^<(p|ul|ol|div|pre|blockquote)/i.test(inner) ? inner : `<p>${inner}</p>`;
        return `<li data-type="taskItem" data-checked="${checked}">${body}</li>`;
      })
      .join('');
    ul.replaceWith(`<ul data-type="taskList">${html}</ul>`);
  }

  return root.toString();
}

/** Nur Rendern (z. B. für Markdown-Seiten), ohne Umbau in Editor-Strukturen. */
export function renderMarkdown(markdown: string): string {
  return parseMarkdown(markdown);
}

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndown) return turndown;
  // Leere Makro-Elemente (z. B. Diagramme, Formeln) würde Turndown sonst als „blank“ verwerfen.
  const blankMacros: Record<string, (el: HTMLElement) => string> = {
    mermaid: (el) => `\n\n\`\`\`mermaid\n${el.getAttribute('data-code') ?? ''}\n\`\`\`\n\n`,
    toc: () => '\n\n<!-- toc -->\n\n',
    'block-math': (el) => `\n\n$$\n${el.getAttribute('data-latex') ?? ''}\n$$\n\n`,
    'inline-math': (el) => `$${el.getAttribute('data-latex') ?? ''}$`,
  };
  const td = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    hr: '---',
    linkStyle: 'inlined',
    blankReplacement: (_content, node) => {
      const el = node as HTMLElement;
      const handler = blankMacros[el.getAttribute?.('data-type') ?? ''];
      if (handler) return handler(el);
      return (node as unknown as { isBlock?: boolean }).isBlock ? '\n\n' : '';
    },
  });
  td.use(gfm);

  td.addRule('taskItem', {
    filter: (node) => node.nodeName === 'LI' && (node as HTMLElement).getAttribute('data-type') === 'taskItem',
    replacement: (content, node) => {
      const checked = (node as HTMLElement).getAttribute('data-checked') === 'true';
      return `- [${checked ? 'x' : ' '}] ${content.replace(/^\n+|\n+$/g, '').replace(/\n+/g, '\n  ')}\n`;
    },
  });
  td.addRule('taskLabel', {
    filter: (node) => node.nodeName === 'LABEL' && (node.parentNode as HTMLElement | null)?.getAttribute?.('data-type') === 'taskItem',
    replacement: () => '',
  });
  td.addRule('callout', {
    filter: (node) => node.nodeName === 'DIV' && (node as HTMLElement).getAttribute('data-type') === 'callout',
    replacement: (content, node) => {
      const variant = (node as HTMLElement).getAttribute('data-variant') ?? 'info';
      const lines = content.trim().split('\n').map((l) => `> ${l}`.trimEnd());
      return `\n\n> [!${VARIANT_ALERTS[variant] ?? 'NOTE'}]\n${lines.join('\n')}\n\n`;
    },
  });
  td.addRule('mermaid', {
    filter: (node) => node.nodeName === 'DIV' && (node as HTMLElement).getAttribute('data-type') === 'mermaid',
    replacement: (_content, node) => `\n\n\`\`\`mermaid\n${(node as HTMLElement).getAttribute('data-code') ?? ''}\n\`\`\`\n\n`,
  });
  td.addRule('toc', {
    filter: (node) => node.nodeName === 'DIV' && (node as HTMLElement).getAttribute('data-type') === 'toc',
    replacement: () => '\n\n<!-- toc -->\n\n',
  });
  td.addRule('inlineMath', {
    filter: (node) => (node as HTMLElement).getAttribute?.('data-type') === 'inline-math',
    replacement: (_c, node) => `$${(node as HTMLElement).getAttribute('data-latex') ?? ''}$`,
  });
  td.addRule('blockMath', {
    filter: (node) => (node as HTMLElement).getAttribute?.('data-type') === 'block-math',
    replacement: (_c, node) => `\n\n$$\n${(node as HTMLElement).getAttribute('data-latex') ?? ''}\n$$\n\n`,
  });
  td.addRule('status', {
    filter: (node) => (node as HTMLElement).getAttribute?.('data-type') === 'status',
    replacement: (content) => `**[${content.trim()}]**`,
  });
  td.addRule('details', {
    filter: ['details'],
    replacement: (content, node) => {
      const summary = (node as HTMLElement).querySelector('summary')?.textContent ?? '';
      const body = content.replace(summary, '').trim();
      return `\n\n<details>\n<summary>${summary}</summary>\n\n${body}\n\n</details>\n\n`;
    },
  });
  td.addRule('summary', { filter: ['summary'], replacement: (content) => content });
  td.addRule('mark', { filter: ['mark'], replacement: (content) => `==${content}==` });
  td.addRule('iframe', {
    filter: ['iframe'],
    replacement: (_c, node) => {
      const src = (node as HTMLElement).getAttribute('src') ?? '';
      return src ? `\n\n[Eingebettet: ${src}](${src})\n\n` : '';
    },
  });
  td.keep(['sub', 'sup', 'kbd']);
  turndown = td;
  return td;
}

export function htmlToMarkdown(html: string): string {
  return getTurndown().turndown(html || '').trim() + '\n';
}

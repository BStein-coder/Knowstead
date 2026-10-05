import { Marked } from 'marked';
import DOMPurify from 'dompurify';

const marked = new Marked({ gfm: true, breaks: false });

/** Markdown → bereinigtes HTML für die Live-Vorschau im Editor. */
export function renderMarkdownPreview(markdown: string): string {
  const html = marked.parse(markdown, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-type', 'data-code'] });
}

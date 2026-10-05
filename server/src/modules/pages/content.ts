import type { ContentType } from '../../core/types.ts';
import { extractMentions, extractPageLinks, htmlToText, makeExcerpt, sanitizeRichText } from '../../core/html.ts';
import { renderMarkdown } from '../../core/markdown.ts';
import { badRequest } from '../../core/errors.ts';

export const MAX_CONTENT_BYTES = 5 * 1024 * 1024;
export const CONTENT_TYPES: ContentType[] = ['richtext', 'markdown', 'code'];

export interface PreparedContent {
  content: string;
  text: string;
  excerpt: string;
  links: number[];
  mentions: number[];
}

/**
 * Bereitet Seiteninhalt je nach Typ auf: Bereinigung (XSS-Schutz),
 * Klartext für Suche/Auszug sowie interne Links und Erwähnungen.
 */
import { rejectAllSuggestions } from './suggestions.ts';

export function prepareContent(contentType: ContentType, raw: string, iframeHosts: string[]): PreparedContent {
  if (Buffer.byteLength(raw, 'utf8') > MAX_CONTENT_BYTES) {
    throw badRequest('Der Seiteninhalt ist zu groß (max. 5 MB)');
  }
  if (contentType === 'richtext') {
    const content = sanitizeRichText(raw, iframeHosts);
    // Suche und Kurzfassung zeigen den Stand ohne offene Vorschläge
    const text = htmlToText(rejectAllSuggestions(content));
    return { content, text, excerpt: makeExcerpt(text), links: extractPageLinks(content), mentions: extractMentions(content) };
  }
  if (contentType === 'markdown') {
    const html = sanitizeRichText(renderMarkdown(raw), iframeHosts);
    const text = htmlToText(html);
    return { content: raw, text, excerpt: makeExcerpt(text), links: extractPageLinks(html), mentions: [] };
  }
  return { content: raw, text: raw, excerpt: makeExcerpt(raw, 200), links: [], mentions: [] };
}

/** Klartext eines gespeicherten Inhalts – für Suche und Kurzfassung (Rich-Text ist beim Speichern bereits bereinigt). */
export function plainText(contentType: ContentType, content: string): string {
  if (contentType === 'richtext') return htmlToText(rejectAllSuggestions(content));
  if (contentType === 'markdown') return htmlToText(renderMarkdown(content));
  return content;
}

/** Anzeige-HTML einer Seite (Markdown wird gerendert, Code als Block). */
export function toDisplayHtml(contentType: ContentType, content: string, language: string | null, iframeHosts: string[]): string {
  if (contentType === 'richtext') return rejectAllSuggestions(content);
  if (contentType === 'markdown') return sanitizeRichText(renderMarkdown(content), iframeHosts);
  const escaped = content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<pre><code class="language-${(language ?? 'plaintext').replace(/[^a-z0-9+#-]/gi, '')}">${escaped}</code></pre>`;
}

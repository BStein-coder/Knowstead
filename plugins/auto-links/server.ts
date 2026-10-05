/**
 * Plugin „Automatische Verlinkung“.
 *
 * Erkennt beim Anzeigen einer Seite konfigurierbare Textmuster (z. B.
 * Ticketnummern `ABC-123`) und ersetzt sie durch Links. Der gespeicherte
 * Seiteninhalt bleibt unverändert – die Ersetzung passiert nur in der Ausgabe.
 *
 * Dieses Plugin ist zugleich das Musterbeispiel für einen `page.render`-Filter,
 * siehe docs/PLUGINS.md.
 */
import type { PluginRegister } from '../../server/src/plugins/types.ts';

interface LinkRule {
  /** Regulärer Ausdruck (JavaScript-Syntax, ohne Schrägstriche). */
  pattern: string;
  /** Ziel-URL, `$1`…`$9` und `$&` werden durch die Treffer ersetzt. */
  url: string;
  /** Optionaler Tooltip. */
  title?: string;
  /** Zusätzliche Flags, z. B. `i`. `g` wird immer gesetzt. */
  flags?: string;
}

interface Compiled {
  re: RegExp;
  url: string;
  title: string;
}

/** Inhalte dieser Elemente werden nie angefasst. */
const SKIP_TAGS = new Set(['a', 'code', 'pre', 'kbd', 'script', 'style', 'textarea', 'svg']);
const TAG_RE = /<[^>]+>/g;
const MAX_HTML = 400_000;

const escapeHtml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function compile(raw: unknown, warn: (msg: string) => void): Compiled[] {
  const list = Array.isArray(raw) ? (raw as LinkRule[]) : [];
  const compiled: Compiled[] = [];
  for (const rule of list) {
    if (!rule || typeof rule.pattern !== 'string' || typeof rule.url !== 'string' || !rule.pattern || !rule.url) continue;
    const flags = `g${(rule.flags ?? '').replace(/[^imsu]/g, '')}`;
    try {
      compiled.push({ re: new RegExp(rule.pattern, flags), url: rule.url, title: rule.title ?? '' });
    } catch (err) {
      warn(`Regel „${rule.pattern}“ ist kein gültiger regulärer Ausdruck: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return compiled;
}

/** `$1`, `$&` usw. aus dem Treffer einsetzen. */
function expand(template: string, match: RegExpExecArray): string {
  return template.replace(/\$(\d|&)/g, (_all, key: string) => {
    if (key === '&') return match[0];
    return match[Number(key)] ?? '';
  });
}

function linkifyText(text: string, rule: Compiled, anchorAttrs: string): string {
  rule.re.lastIndex = 0;
  let result = '';
  let last = 0;
  let match: RegExpExecArray | null;
  let guard = 0;
  while ((match = rule.re.exec(text)) !== null && guard++ < 500) {
    if (match[0] === '') {
      rule.re.lastIndex++;
      continue;
    }
    const href = escapeHtml(expand(rule.url, match));
    const title = rule.title ? ` title="${escapeHtml(expand(rule.title, match))}"` : '';
    result += text.slice(last, match.index);
    result += `<a class="auto-link" href="${href}"${title}${anchorAttrs}>${match[0]}</a>`;
    last = match.index + match[0].length;
  }
  return last === 0 ? text : result + text.slice(last);
}

/**
 * Wendet eine Regel auf alle Textknoten des HTML an. Tags und die Inhalte von
 * `SKIP_TAGS` bleiben unberührt, damit keine Links in Links entstehen.
 */
function linkifyHtml(html: string, rule: Compiled, anchorAttrs: string): string {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  for (const m of html.matchAll(TAG_RE)) {
    const index = m.index ?? 0;
    const text = html.slice(last, index);
    out.push(depth > 0 || !text ? text : linkifyText(text, rule, anchorAttrs));
    last = index + m[0].length;
    const tag = m[0];
    const name = /^<\/?\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(tag)?.[1]?.toLowerCase();
    if (name && SKIP_TAGS.has(name)) {
      if (tag.startsWith('</')) depth = Math.max(0, depth - 1);
      else if (!tag.endsWith('/>')) depth++;
    }
    out.push(tag);
  }
  const rest = html.slice(last);
  out.push(depth > 0 || !rest ? rest : linkifyText(rest, rule, anchorAttrs));
  return out.join('');
}

const register: PluginRegister = (ctx) => {
  let cacheKey = '';
  let rules: Compiled[] = [];

  const currentRules = (): Compiled[] => {
    const raw = ctx.settings.get<unknown>('rules');
    const key = JSON.stringify(raw ?? null);
    if (key !== cacheKey) {
      cacheKey = key;
      rules = compile(raw, (msg) => ctx.log.warn(msg));
      ctx.log.info(`${rules.length} Verlinkungsregel(n) aktiv`);
    }
    return rules;
  };

  const transform = (html: string): string => {
    if (!html || html.length > MAX_HTML) return html;
    const active = currentRules();
    if (!active.length) return html;
    const anchorAttrs = ctx.settings.get<boolean>('openInNewTab') ? ' target="_blank" rel="noopener noreferrer"' : '';
    // Regel für Regel: Bereits erzeugte <a>-Elemente sind für die nächste Regel tabu.
    let result = html;
    for (const rule of active) result = linkifyHtml(result, rule, anchorAttrs);
    return result;
  };

  ctx.hooks.addFilter<string>('page.render', (html) => transform(html), 50);

  ctx.hooks.addFilter<string>('page.export', (html) => (ctx.settings.get<boolean>('applyToExport') ? transform(html) : html), 50);

  // Kleine Testroute: /api/v1/plugins/auto-links/preview?text=ABC-123
  ctx.routes.get('/preview', (req) => ({
    input: String(req.query.text ?? ''),
    html: transform(escapeHtml(String(req.query.text ?? ''))),
    rules: currentRules().map((r) => r.re.source),
  }));
};

export default register;

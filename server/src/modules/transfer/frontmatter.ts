/** Minimaler YAML-Frontmatter-Parser/-Writer für Markdown-Export und -Import. */

export interface FrontMatter {
  title?: string;
  labels?: string[];
  properties?: Record<string, string>;
  [key: string]: unknown;
}

function unquote(v: string): string {
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1).replace(/\\"/g, '"');
  }
  return t;
}

function parseInlineList(v: string): string[] {
  return v
    .trim()
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((x) => unquote(x))
    .filter(Boolean);
}

export function parseFrontMatter(text: string): { data: FrontMatter; body: string } {
  const src = text.replace(/^\uFEFF/, '');
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  const data: FrontMatter = {};
  let currentKey: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const nested = line.match(/^\s{2,}([^:]+):\s*(.*)$/);
    const item = line.match(/^\s*-\s+(.*)$/);
    const top = line.match(/^([A-Za-z0-9_äöüÄÖÜß-]+):\s*(.*)$/);
    if (item && currentKey) {
      const arr = (data[currentKey] as string[] | undefined) ?? [];
      arr.push(unquote(item[1]));
      data[currentKey] = arr;
    } else if (nested && currentKey) {
      const obj = (data[currentKey] as Record<string, string> | undefined) ?? {};
      if (Array.isArray(obj)) continue;
      obj[nested[1].trim()] = unquote(nested[2]);
      data[currentKey] = obj;
    } else if (top) {
      currentKey = top[1];
      const value = top[2];
      if (value === '') data[currentKey] = undefined;
      else if (value.trim().startsWith('[')) data[currentKey] = parseInlineList(value);
      else data[currentKey] = unquote(value);
    }
  }
  if (typeof data.labels === 'string') data.labels = parseInlineList(data.labels);
  if (typeof data.tags === 'string') data.labels = parseInlineList(data.tags);
  else if (Array.isArray(data.tags) && !data.labels) data.labels = data.tags as string[];
  return { data, body: src.slice(m[0].length) };
}

function quote(v: string): string {
  return /^[\w äöüÄÖÜß.,()-]*$/.test(v) && v.trim() === v && v !== '' ? v : `"${v.replace(/"/g, '\\"')}"`;
}

export function writeFrontMatter(data: Record<string, unknown>): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) lines.push(`${key}: [${value.map((v) => quote(String(v))).join(', ')}]`);
    else if (typeof value === 'object') {
      const entries = Object.entries(value as Record<string, unknown>);
      if (!entries.length) continue;
      lines.push(`${key}:`);
      for (const [k, v] of entries) lines.push(`  ${k}: ${quote(String(v))}`);
    } else lines.push(`${key}: ${quote(String(value))}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

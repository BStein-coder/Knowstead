import type { Services } from '../../services.ts';
import type { ContentType, PageRow, UserRef } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { Db, fold, parseJson } from '../../db/database.ts';
import { escapeHtml, makeExcerpt } from '../../core/html.ts';
import { plainText } from '../pages/content.ts';
import { normalizeLabel } from '../pages/labels.ts';
import { pageUrl } from '../pages/service.ts';

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  excluded: string[];
  space: string[];
  labels: string[];
  authors: string[];
  types: string[];
  props: { name: string; op: string; value: string | null }[];
  inTitle: boolean;
}

export interface SearchHit {
  id: number;
  title: string;
  icon: string | null;
  spaceKey: string;
  spaceName: string;
  url: string;
  snippet: string;
  contentType: string;
  updatedAt: string;
  updatedBy: UserRef | null;
  labels: string[];
  path: string[];
}

export interface SearchOptions {
  q: string;
  space?: string;
  label?: string;
  type?: string;
  author?: string;
  updatedAfter?: string;
  sort?: 'relevance' | 'updated' | 'title';
  limit?: number;
  offset?: number;
}

/** Spalten für Rechteprüfung, Sortierung und Facetten (ohne Inhalt). */
type CandidateRow = Pick<PageRow, 'id' | 'space_id' | 'parent_id' | 'status' | 'created_by' | 'deleted_at' | 'content_type' | 'updated_at' | 'title'>;
const CANDIDATE_COLUMNS = 'p.id, p.space_id, p.parent_id, p.status, p.created_by, p.deleted_at, p.content_type, p.updated_at, p.title';
/** Obergrenze der Volltexttreffer vor der Rechteprüfung */
const MAX_CANDIDATES = 1000;

const START = '\u0001';
const END = '\u0002';

/**
 * Textauszug um den ersten Treffer mit Markierungen (START/END). Günstiger als eine zweite
 * Volltextabfrage mit snippet() – besonders bei Präfixsuchen über viele Dokumente.
 */
export function makeSnippet(text: string, words: string[], radius = 90): string | undefined {
  if (!text || !words.length) return undefined;
  const fold = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const escaped = words.map((w) => fold(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean);
  if (!escaped.length) return undefined;
  // Wörter am Wortanfang (Präfixsuche wie im Index), Vergleich ohne Akzente und Groß-/Kleinschreibung
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join('|')})[\\p{L}\\p{N}]*`, 'giu');
  const folded = fold(text);
  if (folded.length !== text.length) return undefined;
  const first = pattern.exec(folded);
  if (!first) return undefined;
  let start = Math.max(0, first.index - radius);
  let end = Math.min(text.length, first.index + first[0].length + radius * 2);
  if (start > 0) start = text.indexOf(' ', start) + 1 || start;
  if (end < text.length) end = text.lastIndexOf(' ', end) > first.index ? text.lastIndexOf(' ', end) : end;
  let out = '';
  let last = start;
  pattern.lastIndex = start;
  for (let m = pattern.exec(folded); m && m.index < end; m = pattern.exec(folded)) {
    const matchEnd = Math.min(end, m.index + m[0].length);
    out += text.slice(last, m.index) + START + text.slice(m.index, matchEnd) + END;
    last = matchEnd;
  }
  out += text.slice(last, end);
  return `${start > 0 ? '… ' : ''}${out.trim()}${end < text.length ? ' …' : ''}`;
}

/**
 * Auszug aus einem kurzen Text (Chat-Nachricht) um den ersten Treffer – fertig für die Anzeige: Der Text ist
 * maskiert, Treffer stehen in <mark>. Gesucht wird wie in der Abfrage: Teilwort, ohne Groß-/Kleinschreibung.
 */
export function highlightSnippet(text: string, words: string[], radius = 70): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = fold(flat);
  const needles = words.map((w) => fold(w)).filter(Boolean);
  const head = () => `${escapeHtml(flat.slice(0, radius * 2))}${flat.length > radius * 2 ? ' …' : ''}`;
  // Ändert die Kleinschreibung die Länge (seltene Zeichen), passen die Fundstellen nicht mehr zum Original
  if (lower.length !== flat.length || !needles.length) return head();
  const first = needles.map((n) => lower.indexOf(n)).filter((at) => at >= 0).sort((a, b) => a - b)[0];
  if (first === undefined) return head();
  let start = Math.max(0, first - radius);
  const end = Math.min(flat.length, first + radius * 2);
  if (start > 0) start = flat.indexOf(' ', start) + 1 || start;
  if (start > first) start = first;
  const ranges: [number, number][] = [];
  for (const needle of needles) {
    for (let at = lower.indexOf(needle, start); at >= 0 && at < end; at = lower.indexOf(needle, at + needle.length)) ranges.push([at, Math.min(end, at + needle.length)]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let out = '';
  let position = start;
  for (const [from, to] of ranges) {
    if (from < position) continue;
    out += `${escapeHtml(flat.slice(position, from))}<mark>${escapeHtml(flat.slice(from, to))}</mark>`;
    position = to;
  }
  out += escapeHtml(flat.slice(position, end));
  return `${start > 0 ? '… ' : ''}${out}${end < flat.length ? ' …' : ''}`;
}

/** Zerlegt eine Suchanfrage in Freitext und Filter (`space:`, `label:`, `#prop=wert` …). */
export function parseQuery(input: string): ParsedQuery {
  const result: ParsedQuery = { terms: [], phrases: [], excluded: [], space: [], labels: [], authors: [], types: [], props: [], inTitle: false };
  const tokens = input.match(/-?"[^"]*"|\S+/g) ?? [];
  for (const raw of tokens) {
    const negated = raw.startsWith('-') && raw.length > 1;
    const token = negated ? raw.slice(1) : raw;
    const m = token.match(/^(space|bereich|label|stichwort|author|autor|type|typ|in):(.+)$/i);
    if (m) {
      const key = m[1].toLowerCase();
      const value = m[2].replace(/^"|"$/g, '');
      if (key === 'space' || key === 'bereich') result.space.push(value.toUpperCase());
      else if (key === 'label' || key === 'stichwort') result.labels.push(normalizeLabel(value));
      else if (key === 'author' || key === 'autor') result.authors.push(value.replace(/^@/, ''));
      else if (key === 'type' || key === 'typ') result.types.push(value.toLowerCase());
      else if (key === 'in' && value.toLowerCase() === 'title') result.inTitle = true;
      continue;
    }
    const prop = token.match(/^#([\p{L}\p{N}_\-.]+)(?:(!=|>=|<=|=|>|<|~)(.+))?$/u);
    if (prop) {
      result.props.push({ name: prop[1], op: prop[2] ?? 'exists', value: prop[3]?.replace(/^"|"$/g, '') ?? null });
      continue;
    }
    if (token.startsWith('"') && token.endsWith('"') && token.length > 2) {
      (negated ? result.excluded : result.phrases).push(token.slice(1, -1));
      continue;
    }
    const clean = token.replace(/["*^():{}[\]]/g, '').trim();
    if (!clean) continue;
    if (negated) result.excluded.push(clean);
    else result.terms.push(clean);
  }
  return result;
}

function ftsQuote(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

export function buildFtsQuery(parsed: ParsedQuery): string | null {
  const positive: string[] = [];
  const column = parsed.inTitle ? 'title : ' : '';
  for (const phrase of parsed.phrases) positive.push(`${column}${ftsQuote(phrase)}`);
  for (const term of parsed.terms) {
    if (term.toUpperCase() === 'OR' || term.toUpperCase() === 'ODER') {
      positive.push('OR');
      continue;
    }
    positive.push(`${column}${ftsQuote(term)}*`);
  }
  while (positive[0] === 'OR') positive.shift();
  while (positive[positive.length - 1] === 'OR') positive.pop();
  if (!positive.length) return null;
  let query = positive.join(' ');
  for (const ex of parsed.excluded) query = `(${query}) NOT ${ftsQuote(ex)}`;
  return query;
}

/**
 * Version der Klartext-Ableitung (Suche, Kurzfassungen). Ändert sich die Ableitung, wird der Wert erhöht –
 * bestehende Seiten werden dann beim nächsten Start einmalig neu berechnet.
 * 2: Codeblöcke ohne HTML-Markup
 */
const TEXT_VERSION = 2;

export class SearchService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /* ------------------------------ Index ------------------------------ */

  index(pageId: number): void {
    const page = this.s.db.get<PageRow>('SELECT id, title, content_text, status, deleted_at FROM pages WHERE id = ?', pageId);
    this.s.db.run('DELETE FROM pages_fts WHERE rowid = ?', pageId);
    if (!page || page.status !== 'current' || page.deleted_at) return;
    const labels = this.s.labels.labelsOf(pageId).join(' ');
    this.s.db.run('INSERT INTO pages_fts (rowid, title, body, labels) VALUES (?, ?, ?, ?)', pageId, page.title, page.content_text, labels);
  }

  remove(pageId: number): void {
    this.s.db.run('DELETE FROM pages_fts WHERE rowid = ?', pageId);
  }

  /** Klartext und Kurzfassung aller Seiten aus dem gespeicherten Inhalt neu berechnen, danach den Index neu aufbauen. */
  rebuildTexts(): number {
    let lastId = 0;
    let count = 0;
    for (;;) {
      const rows = this.s.db.all<{ id: number; content_type: ContentType; content: string }>(
        'SELECT id, content_type, content FROM pages WHERE id > ? ORDER BY id LIMIT 500',
        lastId,
      );
      if (!rows.length) break;
      this.s.db.transaction(() => {
        for (const row of rows) {
          const text = plainText(row.content_type, row.content);
          this.s.db.run('UPDATE pages SET content_text = ?, excerpt = ? WHERE id = ?', text, makeExcerpt(text, row.content_type === 'code' ? 200 : 240), row.id);
        }
      });
      lastId = rows[rows.length - 1].id;
      count += rows.length;
    }
    this.reindexAll();
    return count;
  }

  /** Nach einem Update mit geänderter Klartext-Ableitung einmalig alle Seiten neu berechnen. */
  refreshDerivedText(): number {
    if (this.s.settings.getInternal<number>('search:textVersion', 0) >= TEXT_VERSION) return 0;
    const count = this.rebuildTexts();
    this.s.settings.setInternal('search:textVersion', TEXT_VERSION);
    return count;
  }

  reindexAll(): number {
    const ids = this.s.db.all<{ id: number }>("SELECT id FROM pages WHERE status = 'current' AND deleted_at IS NULL").map((r) => r.id);
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM pages_fts');
      for (const id of ids) this.index(id);
    });
    this.s.db.exec("INSERT INTO pages_fts(pages_fts) VALUES('optimize')");
    return ids.length;
  }

  /* ------------------------------ Suche ------------------------------ */

  async search(auth: AuthContext, options: SearchOptions) {
    const parsed = parseQuery(options.q ?? '');
    if (options.space) parsed.space.push(options.space.toUpperCase());
    if (options.label) parsed.labels.push(normalizeLabel(options.label));
    if (options.type) parsed.types.push(options.type);
    if (options.author) parsed.authors.push(options.author);

    let spaceIds = this.s.perms.viewableSpaceIds(auth);
    if (parsed.space.length) {
      const wanted = new Set(parsed.space);
      spaceIds = spaceIds.filter((id) => wanted.has(this.s.spaces.require(id).key.toUpperCase()));
    }
    const empty = { items: [] as SearchHit[], total: 0, facets: { spaces: [], labels: [], types: [] }, attachments: [], tasks: [], parsed };
    if (!spaceIds.length) return empty;

    const fts = buildFtsQuery(parsed);
    const hasFilters = parsed.labels.length || parsed.authors.length || parsed.types.length || parsed.props.length || parsed.space.length;
    if (!fts && !hasFilters && !options.updatedAfter) return empty;

    const where: string[] = [
      `p.space_id IN ${Db.placeholders(spaceIds.length)}`,
      'p.deleted_at IS NULL',
      "p.status = 'current'",
    ];
    const params: (string | number)[] = [...spaceIds];
    for (const label of parsed.labels) {
      where.push('EXISTS (SELECT 1 FROM page_labels pl JOIN labels l ON l.id = pl.label_id WHERE pl.page_id = p.id AND l.name = ?)');
      params.push(label);
    }
    if (parsed.authors.length) {
      where.push(
        `(p.created_by IN (SELECT id FROM users WHERE username IN ${Db.placeholders(parsed.authors.length)}) OR p.updated_by IN (SELECT id FROM users WHERE username IN ${Db.placeholders(parsed.authors.length)}))`,
      );
      params.push(...parsed.authors, ...parsed.authors);
    }
    if (parsed.types.length) {
      const map: Record<string, string> = { text: 'richtext', richtext: 'richtext', markdown: 'markdown', md: 'markdown', code: 'code' };
      const types = parsed.types.map((t) => map[t] ?? t);
      where.push(`p.content_type IN ${Db.placeholders(types.length)}`);
      params.push(...types);
    }
    for (const prop of parsed.props) {
      if (prop.op === 'exists' || prop.value === null) {
        where.push('EXISTS (SELECT 1 FROM page_properties pp WHERE pp.page_id = p.id AND pp.name = ? COLLATE NOCASE)');
        params.push(prop.name);
        continue;
      }
      const numeric = /^-?\d+(\.\d+)?$/.test(prop.value);
      const valueExpr = numeric && ['>', '<', '>=', '<='].includes(prop.op) ? 'CAST(pp.value AS REAL)' : 'pp.value';
      const opSql = prop.op === '~' ? 'LIKE' : prop.op;
      where.push(
        `EXISTS (SELECT 1 FROM page_properties pp WHERE pp.page_id = p.id AND pp.name = ? COLLATE NOCASE AND ${valueExpr} ${opSql} ? ${prop.op === '=' || prop.op === '!=' ? 'COLLATE NOCASE' : ''})`,
      );
      params.push(prop.name, prop.op === '~' ? `%${prop.value}%` : numeric && valueExpr !== 'pp.value' ? Number(prop.value) : prop.value);
    }
    if (options.updatedAfter) {
      where.push('p.updated_at >= ?');
      params.push(options.updatedAfter);
    }

    // Stufe 1: nur die Spalten für Rechte, Sortierung und Facetten – ohne Inhalte und Textauszüge.
    // Die Volltextsuche läuft zuerst (Unterabfrage), damit SQLite nicht alle Seiten der Bereiche durchgeht.
    let rows: CandidateRow[];
    try {
      if (fts) {
        rows = this.s.db.all<CandidateRow>(
          `SELECT ${CANDIDATE_COLUMNS}
             FROM (SELECT rowid AS hit_id, bm25(pages_fts, 10.0, 1.0, 4.0) AS rank FROM pages_fts WHERE pages_fts MATCH ? ORDER BY rank LIMIT ${MAX_CANDIDATES}) h
             JOIN pages p ON p.id = h.hit_id
            WHERE ${where.join(' AND ')}
            ORDER BY h.rank`,
          fts,
          ...params,
        );
      } else {
        rows = this.s.db.all<CandidateRow>(`SELECT ${CANDIDATE_COLUMNS} FROM pages p WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 1000`, ...params);
      }
    } catch {
      // Ungültige FTS-Syntax: auf einfache Titelsuche zurückfallen
      const like = `%${(options.q ?? '').replace(/[%_]/g, '')}%`;
      rows = this.s.db.all<CandidateRow>(
        `SELECT ${CANDIDATE_COLUMNS} FROM pages p WHERE p.title LIKE ? AND ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 200`,
        like,
        ...params,
      );
    }

    const visible = this.s.pages.filterVisible(auth, rows);
    if (options.sort === 'updated') visible.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    else if (options.sort === 'title') visible.sort((a, b) => a.title.localeCompare(b.title, 'de'));

    const limit = options.limit ?? 20;
    const offset = options.offset ?? 0;
    const items = this.toHits(auth, this.hydrate(visible.slice(offset, offset + limit), parsed));

    // Facetten über alle sichtbaren Treffer
    const spaceCounts = new Map<number, number>();
    const typeCounts = new Map<string, number>();
    for (const r of visible) {
      spaceCounts.set(r.space_id, (spaceCounts.get(r.space_id) ?? 0) + 1);
      typeCounts.set(r.content_type, (typeCounts.get(r.content_type) ?? 0) + 1);
    }
    const labelCounts = visible.length
      ? this.labelCounts(visible.slice(0, 1000).map((r) => r.id))
      : [];

    const attachments = fts ? this.searchAttachments(auth, parsed, spaceIds) : [];
    const tasks = this.searchTasks(parsed, spaceIds);

    const result = {
      items,
      total: visible.length,
      limit,
      offset,
      facets: {
        spaces: [...spaceCounts.entries()]
          .map(([id, count]) => {
            const sp = this.s.spaces.require(id);
            return { key: sp.key, name: sp.name, icon: sp.icon, count };
          })
          .sort((a, b) => b.count - a.count),
        labels: labelCounts,
        types: [...typeCounts.entries()].map(([type, count]) => ({ type, count })),
      },
      attachments,
      tasks,
      parsed,
    };
    return this.s.hooks.apply('search.results', result, { query: options.q, auth });
  }

  /** Stufe 2: vollständige Zeilen und Textauszüge nur für die angezeigte Trefferseite. */
  private hydrate(candidates: CandidateRow[], parsed: ParsedQuery): (PageRow & { snippet?: string })[] {
    if (!candidates.length) return [];
    const ids = candidates.map((c) => c.id);
    const full = new Map(this.s.db.all<PageRow>(`SELECT * FROM pages WHERE id IN ${Db.placeholders(ids.length)}`, ...ids).map((r) => [r.id, r]));
    const words = [...parsed.phrases, ...parsed.terms].filter((w) => !/^(or|oder)$/i.test(w));
    return ids.flatMap((id) => {
      const row = full.get(id);
      return row ? [{ ...row, snippet: makeSnippet(row.content_text ?? '', words) }] : [];
    });
  }

  private toHits(auth: AuthContext, rows: (PageRow & { snippet?: string })[]): SearchHit[] {
    const users = this.s.users.refs(rows.map((r) => r.updated_by));
    return rows.map((r) => {
      const space = this.s.spaces.require(r.space_id);
      const snippetRaw = r.snippet && r.snippet.includes(START) ? r.snippet : r.excerpt;
      const snippet = escapeHtml(snippetRaw ?? '')
        .replaceAll(START, '<mark>')
        .replaceAll(END, '</mark>');
      return {
        id: r.id,
        title: r.title,
        icon: r.icon,
        spaceKey: space.key,
        spaceName: space.name,
        url: pageUrl(space.key, r.id, r.title),
        snippet,
        contentType: r.content_type,
        updatedAt: r.updated_at,
        updatedBy: users.get(r.updated_by ?? 0) ?? null,
        labels: this.s.labels.labelsOf(r.id),
        path: this.s.pages.ancestors(r).map((a) => a.title),
      };
    });
  }

  private labelCounts(pageIds: number[]): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (let i = 0; i < pageIds.length; i += 500) {
      const chunk = pageIds.slice(i, i + 500);
      const rows = this.s.db.all<{ name: string; c: number }>(
        `SELECT l.name, COUNT(*) AS c FROM page_labels pl JOIN labels l ON l.id = pl.label_id
         WHERE pl.page_id IN ${Db.placeholders(chunk.length)} GROUP BY l.name`,
        ...chunk,
      );
      for (const r of rows) counts.set(r.name, (counts.get(r.name) ?? 0) + r.c);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }

  /**
   * Treffer in Anhängen: Inhalt (Volltextindex) und Dateiname. Noch nicht indexierte
   * Dateien werden über den Namen gefunden. Nur die jeweils neueste Version zählt.
   */
  private searchAttachments(auth: AuthContext, parsed: ParsedQuery, spaceIds: number[]) {
    if (!spaceIds.length || parsed.inTitle) return [];
    type Row = PageRow & { att_id: number; filename: string; mime_type: string; size: number; att_created: string; snippet: string | null };
    const latest = 'a.version = (SELECT MAX(version) FROM attachments a2 WHERE a2.page_id = a.page_id AND a2.filename = a.filename)';
    const fts = buildFtsQuery({ ...parsed, inTitle: false });
    let rows: Row[] = [];
    if (fts) {
      try {
        rows = this.s.db.all<Row>(
          `SELECT p.id, p.space_id, p.parent_id, p.title, p.status, p.deleted_at, p.created_by,
                  a.id AS att_id, a.filename, a.mime_type, a.size, a.created_at AS att_created, h.snippet
             FROM (SELECT rowid AS hit_id, bm25(attachments_fts, 4.0, 1.0) AS rank,
                          snippet(attachments_fts, 1, '${START}', '${END}', ' … ', 24) AS snippet
                     FROM attachments_fts WHERE attachments_fts MATCH ? ORDER BY rank LIMIT 300) h
             JOIN attachments a ON a.id = h.hit_id JOIN pages p ON p.id = a.page_id
            WHERE a.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'current'
              AND p.space_id IN ${Db.placeholders(spaceIds.length)} AND ${latest}
            ORDER BY h.rank LIMIT 100`,
          fts,
          ...spaceIds,
        );
      } catch {
        rows = [];
      }
    }
    const words = [...parsed.terms, ...parsed.phrases].filter((w) => w.toUpperCase() !== 'OR').slice(0, 5);
    if (rows.length < 20 && words.length) {
      const seen = new Set(rows.map((r) => r.att_id));
      const byName = this.s.db.all<Row>(
        `SELECT p.id, p.space_id, p.parent_id, p.title, p.status, p.deleted_at, p.created_by,
                a.id AS att_id, a.filename, a.mime_type, a.size, a.created_at AS att_created, NULL AS snippet
           FROM attachments a JOIN pages p ON p.id = a.page_id
          WHERE a.deleted_at IS NULL AND p.deleted_at IS NULL AND p.status = 'current'
            AND p.space_id IN ${Db.placeholders(spaceIds.length)}
            AND ${words.map(() => 'a.filename LIKE ?').join(' AND ')} AND ${latest}
          ORDER BY a.created_at DESC LIMIT 50`,
        ...spaceIds,
        ...words.map((w) => `%${w.replace(/[%_]/g, '')}%`),
      );
      for (const r of byName) if (!seen.has(r.att_id)) rows.push(r);
    }
    const visible = new Set(this.s.pages.filterVisible(auth, rows).map((r) => r.id));
    return rows
      .filter((r) => visible.has(r.id))
      .slice(0, 20)
      .map((r) => ({
        id: r.att_id,
        filename: r.filename,
        mimeType: r.mime_type,
        size: r.size,
        createdAt: r.att_created,
        page: { id: r.id, title: r.title, url: this.s.pages.url(r) },
        /** Textauszug mit <mark>, wenn der Inhalt passt */
        snippet:
          r.snippet && r.snippet.includes(START)
            ? escapeHtml(r.snippet).replaceAll(START, '<mark>').replaceAll(END, '</mark>')
            : null,
      }));
  }

  /**
   * Treffer im Aufgabenplaner. Aufgaben stehen nicht im Volltextindex – sie sind kurz, ändern sich oft
   * und wären als eigener Index teurer als die direkte Suche über Titel, Beschreibung, Stichwörter und die
   * Nachrichten im Chat der Aufgabe. Rechte kommen vom Bereich: Wer ihn sehen darf, sieht seine Pläne.
   * Verglichen wird ohne Rücksicht auf Groß- und Kleinschreibung – auch bei Umlauten (`fold`).
   */
  private searchTasks(parsed: ParsedQuery, spaceIds: number[]) {
    const words = [...parsed.terms, ...parsed.phrases]
      .filter((w) => w.toUpperCase() !== 'OR')
      .map((w) => w.replace(/[%_]/g, '').trim())
      .filter(Boolean)
      .slice(0, 5);
    if (!spaceIds.length || !words.length) return [];
    type Row = {
      id: number;
      title: string;
      notes: string;
      status: string;
      due_date: string | null;
      assignee_id: number | null;
      labels: string;
      updated_at: string;
      board_id: number;
      board_name: string;
      space_id: number;
    };
    const columns = parsed.inTitle ? ['t.title'] : ['t.title', 't.notes', 't.labels'];
    // Jedes Wort muss irgendwo vorkommen – in einem Feld der Aufgabe oder in einer Nachricht ihres Chats
    const inChat = parsed.inTitle ? '' : ' OR EXISTS (SELECT 1 FROM task_comments c WHERE c.task_id = t.id AND c.deleted_at IS NULL AND fold(c.body_text) LIKE ?)';
    const perWord = columns.length + (inChat ? 1 : 0);
    const match = words.map(() => `(${columns.map((c) => `fold(${c}) LIKE ?`).join(' OR ')}${inChat})`).join(' AND ');
    const likes = words.map((w) => `%${fold(w)}%`);
    const rows = this.s.db.all<Row>(
      `SELECT t.id, t.title, t.notes, t.status, t.due_date, t.assignee_id, t.labels, t.updated_at,
              b.id AS board_id, b.name AS board_name, b.space_id
         FROM tasks t JOIN task_boards b ON b.id = t.board_id
        WHERE t.deleted_at IS NULL AND b.space_id IN ${Db.placeholders(spaceIds.length)} AND ${match}
        ORDER BY CASE WHEN t.status = 'done' THEN 1 ELSE 0 END, t.updated_at DESC
        LIMIT 20`,
      ...spaceIds,
      ...likes.flatMap((like) => Array.from({ length: perWord }, () => like)),
    );
    // Treffer im Chat: die neueste passende Nachricht je Aufgabe, als Auszug mit Hervorhebung
    type ChatRow = { id: number; body_text: string; author_id: number | null; created_at: string };
    const chats = new Map<number, ChatRow>();
    if (inChat) {
      for (const r of rows) {
        const hit = this.s.db.get<ChatRow>(
          `SELECT id, body_text, author_id, created_at FROM task_comments
            WHERE task_id = ? AND deleted_at IS NULL AND (${likes.map(() => 'fold(body_text) LIKE ?').join(' OR ')})
            ORDER BY id DESC LIMIT 1`,
          r.id,
          ...likes,
        );
        if (hit) chats.set(r.id, hit);
      }
    }
    const users = this.s.users.refs([...rows.map((r) => r.assignee_id), ...[...chats.values()].map((c) => c.author_id)]);
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((r) => {
      const space = this.s.spaces.require(r.space_id);
      const chat = chats.get(r.id);
      return {
        id: r.id,
        title: r.title,
        boardId: r.board_id,
        boardName: r.board_name,
        spaceKey: space.key,
        spaceName: space.name,
        status: r.status,
        dueDate: r.due_date,
        overdue: r.status !== 'done' && !!r.due_date && r.due_date < today,
        assignee: users.get(r.assignee_id ?? 0) ?? null,
        labels: parseJson<string[]>(r.labels, []),
        /** passende Nachricht im Chat der Aufgabe (Auszug mit <mark>) – der Link springt zu ihr */
        chat: chat ? { id: chat.id, author: users.get(chat.author_id ?? 0) ?? null, createdAt: chat.created_at, snippet: highlightSnippet(chat.body_text, words) } : null,
        url: `/s/${encodeURIComponent(space.key)}/tasks?board=${r.board_id}&task=${r.id}${chat ? `&comment=${chat.id}` : ''}`,
      };
    });
  }

  /** Schnellsuche für die Befehlspalette (Titel + Bereiche). */
  quick(auth: AuthContext, q: string, limit = 8) {
    const term = q.trim();
    if (!term) return { pages: [], spaces: [] };
    const spaceIds = this.s.perms.viewableSpaceIds(auth);
    if (!spaceIds.length) return { pages: [], spaces: [] };
    const like = `%${term.replace(/[%_]/g, '')}%`;
    const rows = this.s.db.all<PageRow>(
      `SELECT p.* FROM pages p WHERE p.space_id IN ${Db.placeholders(spaceIds.length)} AND p.deleted_at IS NULL AND p.status = 'current'
       AND p.title LIKE ?
       ORDER BY CASE WHEN p.title LIKE ? THEN 0 ELSE 1 END, p.updated_at DESC LIMIT 60`,
      ...spaceIds,
      like,
      `${term.replace(/[%_]/g, '')}%`,
    );
    let visible = this.s.pages.filterVisible(auth, rows).slice(0, limit);
    if (visible.length < limit) {
      const parsed = parseQuery(term);
      const fts = buildFtsQuery(parsed);
      if (fts) {
        try {
          const more = this.s.db.all<PageRow>(
            `SELECT p.* FROM pages_fts JOIN pages p ON p.id = pages_fts.rowid WHERE pages_fts MATCH ?
             AND p.space_id IN ${Db.placeholders(spaceIds.length)} AND p.deleted_at IS NULL AND p.status = 'current'
             ORDER BY bm25(pages_fts, 10.0, 1.0, 4.0) LIMIT 40`,
            fts,
            ...spaceIds,
          );
          const seen = new Set(visible.map((v) => v.id));
          visible = [...visible, ...this.s.pages.filterVisible(auth, more).filter((m) => !seen.has(m.id))].slice(0, limit);
        } catch {
          /* ignorieren */
        }
      }
    }
    const lower = term.toLowerCase();
    const spaces = this.s.spaces
      .list(auth, {})
      .filter((sp) => sp.name.toLowerCase().includes(lower) || sp.key.toLowerCase().includes(lower))
      .slice(0, 5);
    return {
      pages: this.s.pages.summaries(auth, visible).map((sm) => ({
        ...sm,
        path: this.s.pages.ancestors(visible.find((v) => v.id === sm.id)!).map((a) => a.title),
      })),
      spaces,
    };
  }
}

import type { Services } from '../../services.ts';
import type { ContentType, SpaceRow, TemplateRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso, parseJson } from '../../db/database.ts';
import { badRequest, forbidden, notFound } from '../../core/errors.ts';
import { escapeHtml } from '../../core/html.ts';
import type { PropertyInput } from '../pages/labels.ts';
import { CONTENT_TYPES, prepareContent } from '../pages/content.ts';

/** Interner Schlüssel: gelöschte Standardvorlagen (werden beim Start nicht neu angelegt). */
export const REMOVED_BUILTINS_KEY = 'templates:removedBuiltins';

export interface TemplateDto {
  id: number;
  spaceId: number | null;
  spaceKey: string | null;
  name: string;
  description: string;
  icon: string | null;
  category: string;
  titlePattern: string;
  contentType: ContentType;
  content?: string;
  labels: string[];
  properties: PropertyInput[];
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
}

export interface TemplateInput {
  name: string;
  description?: string;
  icon?: string | null;
  category?: string;
  titlePattern?: string;
  contentType?: ContentType;
  content: string;
  labels?: string[];
  properties?: PropertyInput[];
  spaceId?: number | null;
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Ersetzt Platzhalter wie {{datum}}, {{benutzer}}, {{bereich}}, {{kw}}. */
export function fillPlaceholders(
  text: string,
  ctx: { user?: { id: number; displayName: string; username: string } | null; space?: { name: string; key: string } | null; date?: Date; html?: boolean },
): string {
  const d = ctx.date ?? new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const esc = (v: string) => (ctx.html ? escapeHtml(v) : v);
  const values: Record<string, string> = {
    datum: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    isodatum: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    uhrzeit: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    jahr: String(d.getFullYear()),
    monat: MONTHS[d.getMonth()],
    monatszahl: pad(d.getMonth() + 1),
    tag: pad(d.getDate()),
    wochentag: WEEKDAYS[d.getDay()],
    kw: String(isoWeek(d)),
    benutzer: esc(ctx.user?.displayName ?? ''),
    user: esc(ctx.user?.displayName ?? ''),
    bereich: esc(ctx.space?.name ?? ''),
    space: esc(ctx.space?.name ?? ''),
    bereichsschluessel: esc(ctx.space?.key ?? ''),
    // Englische Namen für englischsprachige Vorlagen
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    year: String(d.getFullYear()),
    month: MONTHS_EN[d.getMonth()],
    monthnumber: pad(d.getMonth() + 1),
    day: pad(d.getDate()),
    weekday: WEEKDAYS_EN[d.getDay()],
    week: String(isoWeek(d)),
    spacekey: esc(ctx.space?.key ?? ''),
  };
  if (ctx.html && ctx.user) {
    values.ich = `<span data-type="mention" data-id="${ctx.user.id}" data-label="${escapeHtml(ctx.user.displayName)}">@${escapeHtml(ctx.user.displayName)}</span>`;
  } else {
    values.ich = ctx.user?.displayName ?? '';
  }
  values.me = values.ich;
  return text.replace(/\{\{\s*([a-zäöüß]+)\s*\}\}/gi, (m, key: string) => values[key.toLowerCase()] ?? m);
}

export class TemplateService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  private require(id: number): TemplateRow {
    const row = this.s.db.get<TemplateRow>('SELECT * FROM templates WHERE id = ?', id);
    if (!row) throw notFound('Vorlage nicht gefunden');
    return row;
  }

  private canEdit(auth: AuthContext, row: Pick<TemplateRow, 'space_id'>): boolean {
    if (row.space_id === null) return this.s.perms.hasGlobal(auth, 'templates.manage');
    const space = this.s.spaces.get(row.space_id);
    return !!space && this.s.perms.canSpace(auth, space, 'admin');
  }

  private toDto(auth: AuthContext, row: TemplateRow, withContent = false): TemplateDto {
    const space = row.space_id ? this.s.spaces.get(row.space_id) : null;
    return {
      id: row.id,
      spaceId: row.space_id,
      spaceKey: space?.key ?? null,
      name: row.name,
      description: row.description,
      icon: row.icon,
      category: row.category,
      titlePattern: row.title_pattern,
      contentType: row.content_type,
      content: withContent ? row.content : undefined,
      labels: parseJson<string[]>(row.labels, []),
      properties: parseJson<PropertyInput[]>(row.properties, []),
      builtin: !!row.builtin_key,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      canEdit: this.canEdit(auth, row),
    };
  }

  /** Globale Vorlagen und – falls angegeben – die des Bereichs. */
  list(auth: AuthContext, options: { spaceId?: number; scope?: 'all' | 'global' | 'space' } = {}): TemplateDto[] {
    // Vorlagen dienen zum Anlegen von Seiten und enthalten oft interne Gliederungen – nicht für Gäste
    if (!auth.user && auth.via !== 'system') return [];
    const rows = this.s.db.all<TemplateRow>('SELECT * FROM templates ORDER BY category, name COLLATE NOCASE');
    return rows
      .filter((r) => {
        if (options.scope === 'global') return r.space_id === null;
        if (options.scope === 'space') return r.space_id === options.spaceId;
        if (r.space_id === null) return true;
        if (options.spaceId !== undefined && r.space_id !== options.spaceId) return false;
        const space = this.s.spaces.get(r.space_id);
        return !!space && this.s.perms.canSpace(auth, space, 'view');
      })
      .map((r) => this.toDto(auth, r));
  }

  get(auth: AuthContext, id: number): TemplateDto {
    if (auth.via !== 'system') this.s.perms.requireUser(auth);
    const row = this.require(id);
    if (row.space_id) this.s.perms.requireSpace(auth, this.s.spaces.require(row.space_id), 'view');
    return this.toDto(auth, row, true);
  }

  private validate(input: TemplateInput): { content: string; contentType: ContentType } {
    const name = input.name?.trim();
    if (!name) throw badRequest('Bitte einen Namen angeben');
    const contentType = input.contentType ?? 'richtext';
    if (!CONTENT_TYPES.includes(contentType)) throw badRequest('Unbekannter Inhaltstyp');
    const prepared = prepareContent(contentType, input.content ?? '', this.s.settings.get('allowedEmbedHosts'));
    return { content: prepared.content, contentType };
  }

  create(auth: AuthContext, input: TemplateInput): TemplateDto {
    this.s.perms.requireUser(auth);
    const spaceId = input.spaceId ?? null;
    if (!this.canEdit(auth, { space_id: spaceId })) throw forbidden('Du darfst hier keine Vorlagen anlegen');
    const { content, contentType } = this.validate(input);
    const now = nowIso();
    const id = this.s.db.run(
      `INSERT INTO templates (space_id, name, description, icon, category, title_pattern, content_type, content, labels, properties, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      spaceId,
      input.name.trim(),
      input.description ?? '',
      input.icon ?? '📄',
      input.category ?? '',
      input.titlePattern ?? '',
      contentType,
      content,
      JSON.stringify(input.labels ?? []),
      JSON.stringify(input.properties ?? []),
      auth.user?.id ?? null,
      now,
      now,
    ).lastInsertRowid;
    this.s.emit(auth, { type: 'template.created', spaceId, target: { type: 'template', id, label: input.name } });
    return this.get(auth, id);
  }

  update(auth: AuthContext, id: number, input: Partial<TemplateInput>): TemplateDto {
    const row = this.require(id);
    if (!this.canEdit(auth, row)) throw forbidden('Du darfst diese Vorlage nicht ändern');
    const merged: TemplateInput = {
      name: input.name ?? row.name,
      description: input.description ?? row.description,
      icon: input.icon === undefined ? row.icon : input.icon,
      category: input.category ?? row.category,
      titlePattern: input.titlePattern ?? row.title_pattern,
      contentType: input.contentType ?? row.content_type,
      content: input.content ?? row.content,
      labels: input.labels ?? parseJson<string[]>(row.labels, []),
      properties: input.properties ?? parseJson<PropertyInput[]>(row.properties, []),
    };
    const { content, contentType } = this.validate(merged);
    this.s.db.run(
      `UPDATE templates SET name = ?, description = ?, icon = ?, category = ?, title_pattern = ?, content_type = ?, content = ?,
              labels = ?, properties = ?, updated_at = ? WHERE id = ?`,
      merged.name.trim(),
      merged.description ?? '',
      merged.icon ?? null,
      merged.category ?? '',
      merged.titlePattern ?? '',
      contentType,
      content,
      JSON.stringify(merged.labels ?? []),
      JSON.stringify(merged.properties ?? []),
      nowIso(),
      id,
    );
    this.s.emit(auth, { type: 'template.updated', spaceId: row.space_id, target: { type: 'template', id, label: merged.name } });
    return this.get(auth, id);
  }

  delete(auth: AuthContext, id: number): void {
    const row = this.require(id);
    if (!this.canEdit(auth, row)) throw forbidden('Du darfst diese Vorlage nicht löschen');
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM templates WHERE id = ?', id);
      // Gelöschte Standardvorlagen merken – sonst legt der nächste Start sie wieder an
      if (row.builtin_key) {
        const removed = new Set(this.s.settings.getInternal<string[]>(REMOVED_BUILTINS_KEY, []));
        removed.add(row.builtin_key);
        this.s.settings.setInternal(REMOVED_BUILTINS_KEY, [...removed]);
      }
    });
    this.s.emit(auth, { type: 'template.deleted', spaceId: row.space_id, target: { type: 'template', id, label: row.name } });
  }

  fromPage(auth: AuthContext, pageId: number, input: { name: string; description?: string; scope: 'global' | 'space' }): TemplateDto {
    const { page, space } = this.s.pages.requireViewable(auth, pageId);
    return this.create(auth, {
      name: input.name,
      description: input.description ?? `Erstellt aus der Seite „${page.title}“`,
      icon: page.icon,
      contentType: page.content_type,
      content: page.content,
      labels: this.s.labels.labelsOf(page.id),
      properties: this.s.labels.propertiesOf(page.id),
      spaceId: input.scope === 'space' ? space.id : null,
    });
  }

  /** Vorlage auf eine neue Seite anwenden (inkl. Platzhalter). */
  apply(auth: AuthContext, id: number, space: SpaceRow) {
    const row = this.require(id);
    if (row.space_id && row.space_id !== space.id) {
      this.s.perms.requireSpace(auth, this.s.spaces.require(row.space_id), 'view');
    }
    const ctx = { user: auth.user, space: { name: space.name, key: space.key } };
    return {
      title: fillPlaceholders(row.title_pattern, ctx).trim(),
      content: fillPlaceholders(row.content, { ...ctx, html: row.content_type === 'richtext' }),
      contentType: row.content_type,
      labels: parseJson<string[]>(row.labels, []),
      properties: parseJson<PropertyInput[]>(row.properties, []).map((p) => ({ ...p, value: fillPlaceholders(p.value, ctx) })),
    };
  }
}

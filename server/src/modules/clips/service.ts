/**
 * Persönliche Zwischenablage.
 *
 * Gedacht für das Sammeln von Textbausteinen beim Schreiben: markierten
 * Abschnitt ablegen, auf einer anderen Seite wieder einfügen. Die Einträge
 * gehören immer genau einer Person und sind für niemanden sonst sichtbar.
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso } from '../../db/database.ts';
import { badRequest, notFound } from '../../core/errors.ts';
import { sanitizeRichText } from '../../core/html.ts';
import { truncate } from '../../core/util.ts';

export type ClipKind = 'html' | 'text' | 'link';

export interface ClipRow {
  id: number;
  user_id: number;
  title: string;
  kind: ClipKind;
  content: string;
  source_page_id: number | null;
  pinned: number;
  created_at: string;
}

export interface ClipDto {
  id: number;
  title: string;
  kind: ClipKind;
  content: string;
  preview: string;
  pinned: boolean;
  source: { id: number; title: string; url: string } | null;
  createdAt: string;
}

const MAX_CLIPS = 50;
const MAX_LENGTH = 100_000;

export class ClipService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  private toDto(row: ClipRow): ClipDto {
    const page = row.source_page_id ? this.s.pages.get(row.source_page_id) : undefined;
    const space = page ? this.s.spaces.get(page.space_id) : undefined;
    return {
      id: row.id,
      title: row.title,
      kind: row.kind,
      content: row.content,
      preview: truncate(row.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 160),
      pinned: !!row.pinned,
      source: page && space ? { id: page.id, title: page.title, url: this.s.pages.url(page, space.key) } : null,
      createdAt: row.created_at,
    };
  }

  list(auth: AuthContext): ClipDto[] {
    const user = this.s.perms.requireUser(auth);
    return this.s.db
      .all<ClipRow>('SELECT * FROM clips WHERE user_id = ? ORDER BY pinned DESC, id DESC LIMIT ?', user.id, MAX_CLIPS)
      .map((r) => this.toDto(r));
  }

  create(auth: AuthContext, input: { title?: string; kind?: ClipKind; content: string; sourcePageId?: number | null }): ClipDto {
    const user = this.s.perms.requireUser(auth);
    const kind: ClipKind = input.kind === 'text' || input.kind === 'link' ? input.kind : 'html';
    let content = (input.content ?? '').trim();
    if (!content) throw badRequest('Es gibt nichts zum Ablegen');
    if (content.length > MAX_LENGTH) throw badRequest('Der Ausschnitt ist zu groß (max. 100.000 Zeichen)');
    // HTML aus dem Editor wird wie Seiteninhalt bereinigt.
    if (kind === 'html') content = sanitizeRichText(content, this.s.settings.get('allowedEmbedHosts'));
    // Links nur mit harmlosen Schemata – kein javascript:, data: o. Ä.
    if (kind === 'link' && !/^(https?:\/\/|mailto:|\/(?!\/))/i.test(content)) throw badRequest('Nur http(s)-, mailto- oder interne Links können abgelegt werden');
    const sourceId = input.sourcePageId ? this.s.pages.requireViewable(auth, input.sourcePageId).page.id : null;
    const title = (input.title ?? '').trim() || truncate(content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), 60) || 'Ausschnitt';
    const res = this.s.db.run(
      'INSERT INTO clips (user_id, title, kind, content, source_page_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      user.id,
      title,
      kind,
      content,
      sourceId,
      nowIso(),
    );
    // Ältere, nicht angeheftete Einträge über der Grenze entfernen.
    this.s.db.run(
      `DELETE FROM clips WHERE user_id = ? AND pinned = 0 AND id NOT IN (
         SELECT id FROM clips WHERE user_id = ? AND pinned = 0 ORDER BY id DESC LIMIT ?
       )`,
      user.id,
      user.id,
      MAX_CLIPS,
    );
    return this.toDto(this.require(user.id, res.lastInsertRowid));
  }

  setPinned(auth: AuthContext, id: number, pinned: boolean): ClipDto {
    const user = this.s.perms.requireUser(auth);
    const row = this.require(user.id, id);
    this.s.db.run('UPDATE clips SET pinned = ? WHERE id = ?', pinned ? 1 : 0, row.id);
    return this.toDto(this.require(user.id, id));
  }

  rename(auth: AuthContext, id: number, title: string): ClipDto {
    const user = this.s.perms.requireUser(auth);
    this.require(user.id, id);
    this.s.db.run('UPDATE clips SET title = ? WHERE id = ?', title.trim().slice(0, 120) || 'Ausschnitt', id);
    return this.toDto(this.require(user.id, id));
  }

  delete(auth: AuthContext, id: number): void {
    const user = this.s.perms.requireUser(auth);
    this.require(user.id, id);
    this.s.db.run('DELETE FROM clips WHERE id = ?', id);
  }

  clear(auth: AuthContext): number {
    const user = this.s.perms.requireUser(auth);
    return this.s.db.run('DELETE FROM clips WHERE user_id = ? AND pinned = 0', user.id).changes;
  }

  private require(userId: number, id: number): ClipRow {
    const row = this.s.db.get<ClipRow>('SELECT * FROM clips WHERE id = ? AND user_id = ?', id, userId);
    if (!row) throw notFound('Eintrag der Zwischenablage nicht gefunden');
    return row;
  }
}

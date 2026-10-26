import type { Services } from '../../services.ts';
import type { ContentType, PageRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso } from '../../db/database.ts';
import { badRequest } from '../../core/errors.ts';
import { CONTENT_TYPES, prepareContent } from './content.ts';
import type { PageSummary } from './service.ts';

export interface DraftInput {
  title: string;
  content: string;
  contentType?: ContentType;
  language?: string | null;
  baseVersion?: number;
}

/** Persönliche Entwürfe: automatisch gespeicherte Bearbeitungsstände und noch nicht veröffentlichte Seiten. */
export class DraftService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /** Zwischenstand speichern – bei neuen Seiten direkt in der Seite, sonst als persönlicher Entwurf. */
  save(auth: AuthContext, id: number, input: DraftInput) {
    const user = this.s.perms.requireUser(auth);
    const { page } = this.s.pages.requireAccess(auth, id, 'edit');
    const contentType = input.contentType ?? page.content_type;
    if (!CONTENT_TYPES.includes(contentType)) throw badRequest('Unbekannter Inhaltstyp');
    const hosts = this.s.settings.get('allowedEmbedHosts');
    const prepared = prepareContent(contentType, input.content, hosts);
    const now = nowIso();
    if (page.status === 'draft') {
      this.s.db.run(
        `UPDATE pages SET title = ?, content = ?, content_text = ?, excerpt = ?, content_type = ?, language = ?, updated_at = ? WHERE id = ?`,
        input.title.trim().slice(0, 255),
        prepared.content,
        prepared.text,
        prepared.excerpt,
        contentType,
        input.language === undefined ? page.language : input.language,
        now,
        id,
      );
    } else {
      this.s.db.run(
        `INSERT INTO page_drafts (page_id, user_id, title, content, content_type, language, base_version, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(page_id, user_id) DO UPDATE SET title = excluded.title, content = excluded.content,
           content_type = excluded.content_type, language = excluded.language, updated_at = excluded.updated_at`,
        id,
        user.id,
        input.title.trim().slice(0, 255),
        prepared.content,
        contentType,
        input.language === undefined ? page.language : input.language,
        input.baseVersion ?? page.version,
        now,
      );
    }
    return { savedAt: now };
  }

  get(auth: AuthContext, id: number) {
    const user = this.s.perms.requireUser(auth);
    this.s.pages.requireViewable(auth, id);
    const row = this.s.db.get<{ title: string; content: string; content_type: ContentType; language: string | null; base_version: number; updated_at: string }>(
      'SELECT title, content, content_type, language, base_version, updated_at FROM page_drafts WHERE page_id = ? AND user_id = ?',
      id,
      user.id,
    );
    if (!row) return null;
    return { title: row.title, content: row.content, contentType: row.content_type, language: row.language, baseVersion: row.base_version, updatedAt: row.updated_at };
  }

  /** Entwurf verwerfen; eine nie veröffentlichte neue Seite wird dabei gelöscht. */
  discard(auth: AuthContext, id: number): void {
    const user = this.s.perms.requireUser(auth);
    // Ohne Fehlermeldung, wenn es nichts zu verwerfen gibt: Ein Unterschied zwischen „gibt es nicht“ und „gehört jemand anderem“
    // verriete fremde Entwürfe und eingeschränkte Seiten
    const page = this.s.pages.get(id);
    if (!page) return;
    if (page.status === 'draft') {
      if (page.created_by === user.id) this.s.trash.hardDelete([page.id]);
      return;
    }
    this.s.db.run('DELETE FROM page_drafts WHERE page_id = ? AND user_id = ?', id, user.id);
  }

  /** Eigene Entwürfe: neue Seiten und Bearbeitungsstände. */
  mine(auth: AuthContext): (PageSummary & { kind: 'new' | 'edit'; draftUpdatedAt: string })[] {
    const user = this.s.perms.requireUser(auth);
    const newPages = this.s.db.all<PageRow>(
      "SELECT * FROM pages WHERE status = 'draft' AND created_by = ? AND deleted_at IS NULL ORDER BY updated_at DESC",
      user.id,
    );
    const edits = this.s.db.all<PageRow & { draft_updated_at: string; draft_title: string }>(
      `SELECT p.*, d.updated_at AS draft_updated_at, d.title AS draft_title FROM page_drafts d JOIN pages p ON p.id = d.page_id
       WHERE d.user_id = ? AND p.deleted_at IS NULL ORDER BY d.updated_at DESC`,
      user.id,
    );
    return [
      ...this.s.pages.summaries(auth, newPages).map((s) => ({ ...s, kind: 'new' as const, draftUpdatedAt: s.updatedAt })),
      ...this.s.pages.summaries(auth, this.s.pages.filterVisible(auth, edits)).map((s) => {
        const e = edits.find((x) => x.id === s.id)!;
        return { ...s, title: e.draft_title || s.title, kind: 'edit' as const, draftUpdatedAt: e.draft_updated_at };
      }),
    ].sort((a, b) => b.draftUpdatedAt.localeCompare(a.draftUpdatedAt));
  }
}

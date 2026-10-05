import type { Services } from '../../services.ts';
import type { PageRow, SpaceRow } from '../../core/types.ts';
import type { AuthContext, Subject } from '../../core/permissions.ts';
import { badRequest } from '../../core/errors.ts';
import { pageUrl } from './service.ts';

export interface SubjectDto extends Subject {
  label: string;
  detail: string;
}

/**
 * Seiteneinschränkungen (wie in Confluence):
 *  - Lese-Einschränkungen gelten für die Seite und alle Unterseiten.
 *  - Bearbeitungs-Einschränkungen gelten nur für die Seite selbst.
 */
export class RestrictionService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  private describe(subjects: Subject[]): SubjectDto[] {
    const users = this.s.users.refs(subjects.filter((x) => x.type === 'user').map((x) => x.id));
    return subjects.map((sub) => {
      if (sub.type === 'user') {
        const u = users.get(sub.id);
        return { ...sub, label: u?.displayName ?? `Benutzer #${sub.id}`, detail: u ? `@${u.username}` : '' };
      }
      const g = this.s.groups.get(sub.id);
      return { ...sub, label: g?.name ?? `Gruppe #${sub.id}`, detail: 'Gruppe' };
    });
  }

  get(auth: AuthContext, pageId: number) {
    const { page, space } = this.s.pages.requireViewable(auth, pageId);
    const chain = this.s.perms.ancestorChain(page.id);
    const all = this.s.perms.restrictionsFor(chain);
    const own = all.get(page.id) ?? { view: [], edit: [] };
    const inherited = chain
      .slice(1)
      .filter((id) => all.get(id)?.view.length)
      .map((id) => {
        const p = this.s.pages.get(id)!;
        return { pageId: id, title: p.title, url: pageUrl(space.key, id, p.title), subjects: this.describe(all.get(id)!.view) };
      });
    return {
      view: this.describe(own.view),
      edit: this.describe(own.edit),
      inherited,
      canEdit: this.s.pages.access(auth, page, space).restrict,
    };
  }

  set(auth: AuthContext, pageId: number, input: { view: Subject[]; edit: Subject[] }) {
    const user = this.s.perms.requireUser(auth);
    const { page, space } = this.s.pages.requireAccess(auth, pageId, 'restrict');
    const clean = (list: Subject[]) => {
      const seen = new Set<string>();
      return list.filter((sub) => {
        if (sub.type !== 'user' && sub.type !== 'group') throw badRequest('Ungültiger Eintrag');
        if (sub.type === 'user' && !this.s.users.get(sub.id)) throw badRequest(`Benutzer #${sub.id} existiert nicht`);
        if (sub.type === 'group' && !this.s.groups.get(sub.id)) throw badRequest(`Gruppe #${sub.id} existiert nicht`);
        const key = `${sub.type}:${sub.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    };
    const view = clean(input.view ?? []);
    const edit = clean(input.edit ?? []);
    // Selbst-Aussperren verhindern: Der ausführende Nutzer bleibt immer berechtigt.
    const includesSelf = (list: Subject[]) => this.s.perms.matchesSubjects(auth, list);
    if (!auth.isAdmin) {
      if (view.length && !includesSelf(view)) view.push({ type: 'user', id: user.id });
      if (edit.length && !includesSelf(edit)) edit.push({ type: 'user', id: user.id });
    }
    const before = this.get(auth, pageId);
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM page_restrictions WHERE page_id = ?', pageId);
      for (const [kind, list] of [
        ['view', view],
        ['edit', edit],
      ] as const) {
        for (const sub of list) {
          this.s.db.run(
            'INSERT INTO page_restrictions (page_id, kind, subject_type, subject_id) VALUES (?, ?, ?, ?)',
            pageId,
            kind,
            sub.type,
            sub.id,
          );
        }
      }
    });
    auth.cache.clear();
    this.s.perms.invalidateRestrictions();
    const after = this.get(auth, pageId);
    this.s.emit(auth, {
      type: 'page.restrictions_changed',
      spaceId: space.id,
      pageId,
      target: { type: 'page', id: pageId, label: page.title },
      data: {
        viewBefore: before.view.map((x) => x.label),
        viewAfter: after.view.map((x) => x.label),
        editBefore: before.edit.map((x) => x.label),
        editAfter: after.edit.map((x) => x.label),
      },
    });
    return after;
  }

  /** Alle eingeschränkten Seiten eines Bereichs (für Bereichsadministratoren). */
  restrictedPages(auth: AuthContext, space: SpaceRow) {
    this.s.perms.requireSpace(auth, space, 'admin');
    const rows = this.s.db.all<PageRow & { kinds: string }>(
      `SELECT p.*, GROUP_CONCAT(DISTINCT r.kind) AS kinds FROM page_restrictions r JOIN pages p ON p.id = r.page_id
       WHERE p.space_id = ? AND p.deleted_at IS NULL GROUP BY p.id ORDER BY p.title COLLATE NOCASE`,
      space.id,
    );
    return rows.map((r) => {
      const res = this.s.perms.restrictionsFor([r.id]).get(r.id) ?? { view: [], edit: [] };
      return {
        id: r.id,
        title: r.title,
        url: pageUrl(space.key, r.id, r.title),
        view: this.describe(res.view),
        edit: this.describe(res.edit),
        // Der Titel bleibt sichtbar, der Inhalt nur für Berechtigte.
        canView: this.s.perms.canViewPage(auth, r, space),
      };
    });
  }
}

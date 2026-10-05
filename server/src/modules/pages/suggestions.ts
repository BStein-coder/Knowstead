/**
 * Vorschlagsmodus auf dem Server.
 *
 * Seiten haben einen Bearbeitungsmodus: „direkt“ oder „nur Vorschläge“. Im Vorschlagsmodus dürfen
 * Bearbeitende den Text nur über Vorschläge ändern (`<ins data-suggestion>` / `<del data-suggestion>`);
 * Autorin bzw. Autor, verantwortliche Person und Bereichsverwaltung nehmen sie an oder lehnen sie ab.
 * Den Modus stellen Autorin/Autor und verantwortliche Person ein; die Bereichsverwaltung kann ihn
 * ebenfalls ändern und festschreiben.
 *
 * Der Editor setzt das um; beim Veröffentlichen prüft der Server trotzdem, dass sich der Text – ohne
 * Vorschläge betrachtet – nicht verändert hat und fremde Vorschläge unangetastet bleiben.
 */
import { parse, type HTMLElement } from 'node-html-parser';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { PageRow, SpaceRow } from '../../core/types.ts';
import { htmlToText } from '../../core/html.ts';
import { badRequest, forbidden } from '../../core/errors.ts';
import { nowIso } from '../../db/database.ts';

export type EditMode = 'direct' | 'suggest';

export interface SuggestionSummary {
  sid: string;
  author: number;
  authorName: string;
  at: string;
  inserted: string;
  deleted: string;
}

const SELECTOR = 'ins[data-suggestion], del[data-suggestion]';

/** Inhalt ohne Vorschläge: Einfügungen entfernen, Löschungen behalten (so sehen Lesende die Seite). */
export function rejectAllSuggestions(html: string): string {
  if (!html.includes('data-suggestion')) return html;
  const root = parse(html);
  for (const el of root.querySelectorAll('ins[data-suggestion]')) el.remove();
  for (const el of root.querySelectorAll('del[data-suggestion]')) el.replaceWith(el.innerHTML);
  return root.toString();
}

/** Inhalt mit allen Vorschlägen angenommen. */
export function acceptAllSuggestions(html: string): string {
  if (!html.includes('data-suggestion')) return html;
  const root = parse(html);
  for (const el of root.querySelectorAll('del[data-suggestion]')) el.remove();
  for (const el of root.querySelectorAll('ins[data-suggestion]')) el.replaceWith(el.innerHTML);
  return root.toString();
}

export function collectSuggestions(html: string): SuggestionSummary[] {
  if (!html.includes('data-suggestion')) return [];
  const byId = new Map<string, SuggestionSummary>();
  for (const el of parse(html).querySelectorAll(SELECTOR) as HTMLElement[]) {
    const sid = el.getAttribute('data-sid') || 'ohne-id';
    const entry = byId.get(sid) ?? { sid, author: Number(el.getAttribute('data-author')) || 0, authorName: el.getAttribute('data-author-name') ?? '', at: el.getAttribute('data-at') ?? '', inserted: '', deleted: '' };
    if (el.rawTagName.toLowerCase() === 'ins') entry.inserted += el.text;
    else entry.deleted += el.text;
    byId.set(sid, entry);
  }
  return [...byId.values()];
}

const compact = (html: string) => htmlToText(rejectAllSuggestions(html)).replace(/\s+/g, '');

export class SuggestionService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /** Vorschläge annehmen oder ablehnen und den Modus ändern: Autorin/Autor, Verantwortliche, Bereichsverwaltung. */
  canResolve(auth: AuthContext, page: PageRow, space: SpaceRow): boolean {
    const userId = auth.user?.id;
    if (!userId) return false;
    return page.created_by === userId || page.owner_id === userId || this.s.perms.canSpace(auth, space, 'moderate');
  }

  info(auth: AuthContext, page: PageRow, space: SpaceRow) {
    const mode = (page.edit_mode ?? 'direct') as EditMode;
    const canResolve = this.canResolve(auth, page, space);
    const moderator = this.s.perms.canSpace(auth, space, 'moderate');
    const suggestions = page.content_type === 'richtext' ? collectSuggestions(page.content) : [];
    return {
      mode,
      locked: !!page.edit_mode_locked,
      /** Modus ändern: Autorin/Autor (sofern nicht festgeschrieben) oder Bereichsverwaltung */
      canChange: moderator || (canResolve && !page.edit_mode_locked),
      canResolve,
      /** Diese Person kann nur Vorschläge machen */
      forced: mode === 'suggest' && !canResolve,
      pending: suggestions.length,
    };
  }

  list(auth: AuthContext, pageId: number): SuggestionSummary[] {
    const { page } = this.s.pages.requireAccess(auth, pageId, 'edit');
    return page.content_type === 'richtext' ? collectSuggestions(page.content) : [];
  }

  setMode(auth: AuthContext, pageId: number, mode: EditMode, locked?: boolean) {
    const { page, space } = this.s.pages.requireAccess(auth, pageId, 'edit');
    const moderator = this.s.perms.canSpace(auth, space, 'moderate');
    const canResolve = this.canResolve(auth, page, space);
    if (!moderator && !(canResolve && !page.edit_mode_locked)) {
      throw forbidden(page.edit_mode_locked ? 'Der Bearbeitungsmodus wurde von der Bereichsverwaltung festgelegt' : 'Den Bearbeitungsmodus legen Autorin bzw. Autor oder die Bereichsverwaltung fest');
    }
    if (mode === 'suggest' && page.content_type !== 'richtext') throw badRequest('Vorschläge gibt es nur für Rich-Text-Seiten');
    const lock = moderator ? !!locked : !!page.edit_mode_locked;
    this.s.db.run('UPDATE pages SET edit_mode = ?, edit_mode_locked = ? WHERE id = ?', mode, lock ? 1 : 0, pageId);
    this.s.emit(auth, {
      type: 'page.edit_mode_changed',
      spaceId: space.id,
      pageId,
      target: { type: 'page', id: pageId, label: page.title },
      data: { mode, locked: lock },
    });
    return this.info(auth, this.s.pages.require(pageId), space);
  }

  /**
   * Vor dem Veröffentlichen: neue Vorschläge der speichernden Person zuordnen und im Vorschlagsmodus
   * direkte Textänderungen sowie Eingriffe in fremde Vorschläge ablehnen. Liefert den (ggf. ergänzten) Inhalt.
   */
  review(auth: AuthContext, page: PageRow, space: SpaceRow, next: { title: string; content: string; contentType: string }): string {
    const user = this.s.perms.requireUser(auth);
    const info = this.info(auth, page, space);
    if (info.forced) {
      if (next.contentType !== 'richtext') throw forbidden('Im Vorschlagsmodus kann nur Rich-Text vorgeschlagen werden');
      if (next.title.trim() !== page.title) throw forbidden('Im Vorschlagsmodus lässt sich der Titel nicht ändern – bitte als Vorschlag im Text oder als Kommentar vermerken');
    }
    if (next.contentType !== 'richtext' || (!next.content.includes('data-suggestion') && !page.content.includes('data-suggestion') && !info.forced)) return next.content;

    const before = new Map(collectSuggestions(page.content).map((sg) => [sg.sid, sg]));
    const root = parse(next.content);
    const now = nowIso();
    for (const el of root.querySelectorAll(SELECTOR) as HTMLElement[]) {
      const sid = el.getAttribute('data-sid') ?? '';
      const known = before.get(sid);
      if (known) {
        // Bestehende Vorschläge behalten ihre Person
        el.setAttribute('data-author', String(known.author));
        el.setAttribute('data-author-name', known.authorName);
      } else {
        el.setAttribute('data-sid', sid || `s${Date.now().toString(36)}`);
        el.setAttribute('data-author', String(user.id));
        el.setAttribute('data-author-name', user.displayName);
        if (!el.getAttribute('data-at')) el.setAttribute('data-at', now);
      }
    }
    const content = root.toString();

    if (info.forced) {
      if (compact(content) !== compact(page.content)) {
        throw forbidden('Im Vorschlagsmodus sind nur Vorschläge möglich – der Text wurde direkt geändert. Bitte die Seite neu laden und Änderungen als Vorschlag eintragen.');
      }
      const after = new Map(collectSuggestions(content).map((sg) => [sg.sid, sg]));
      for (const [sid, sg] of before) {
        if (sg.author === user.id) continue;
        const now2 = after.get(sid);
        if (!now2 || now2.inserted !== sg.inserted || now2.deleted !== sg.deleted) {
          throw forbidden(`Vorschläge von ${sg.authorName || 'anderen Personen'} nimmt nur die Autorin, der Autor oder die Bereichsverwaltung an oder lehnt sie ab`);
        }
      }
    }
    return content;
  }

  /** Nach dem Veröffentlichen: Autorin/Autor und Verantwortliche über neue Vorschläge informieren. */
  notifyNew(auth: AuthContext, before: string, page: PageRow, space: SpaceRow): void {
    const known = new Set(collectSuggestions(before).map((sg) => sg.sid));
    const fresh = collectSuggestions(page.content).filter((sg) => !known.has(sg.sid) && sg.author === auth.user?.id);
    if (!fresh.length) return;
    const recipients = new Set([page.created_by, page.owner_id].filter((id): id is number => !!id && id !== auth.user?.id));
    for (const userId of recipients) {
      this.s.notifications.push({
        userId,
        type: 'page.suggestions',
        actorId: auth.user?.id ?? null,
        spaceId: space.id,
        pageId: page.id,
        title: `${fresh.length === 1 ? 'Neuer Änderungsvorschlag' : `${fresh.length} neue Änderungsvorschläge`} von ${auth.user?.displayName ?? 'jemandem'}: ${page.title}`,
        body: fresh
          .map((sg) => [sg.deleted && `– ${sg.deleted}`, sg.inserted && `+ ${sg.inserted}`].filter(Boolean).join(' '))
          .join(' · ')
          .slice(0, 400),
        link: `/s/${encodeURIComponent(space.key)}/edit/${page.id}`,
      });
    }
  }
}

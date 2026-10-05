import type { Services } from '../../services.ts';
import type { PageRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';

const NAMES = {
  de: {
    months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    weekdays: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
    intro: 'Tagesnotizen, nach Jahr und Monat geordnet.',
    fallback: '<h2>Notizen</h2><p></p><h2>Aufgaben</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>',
    note: 'Tagesnotiz angelegt',
  },
  en: {
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    intro: 'Daily notes, organised by year and month.',
    fallback: '<h2>Notes</h2><p></p><h2>Tasks</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p></p></li></ul>',
    note: 'Daily note created',
  },
};

/**
 * Journal (Tagesnotizen, wie in Trilium): Legt im persönlichen Bereich die
 * Struktur Journal → Jahr → Monat → Tag an und liefert die Tagesseite.
 */
export class JournalService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  private async findOrCreate(auth: AuthContext, spaceId: number, parentId: number | null, title: string, icon: string, content: string): Promise<PageRow> {
    const existing = this.s.db.get<PageRow>(
      `SELECT * FROM pages WHERE space_id = ? AND ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'} AND title = ? AND deleted_at IS NULL AND status = 'current'`,
      ...(parentId === null ? [spaceId, title] : [spaceId, parentId, title]),
    );
    if (existing) return existing;
    return this.s.pages.create(auth, { spaceId, parentId, title, icon, content, changeNote: 'Journal', silent: true });
  }

  async day(auth: AuthContext, date = new Date()): Promise<PageRow> {
    const space = await this.s.spaces.personalSpace(auth, true);
    if (!space) throw new Error('Kein persönlicher Bereich');
    const pad = (n: number) => String(n).padStart(2, '0');
    const names = NAMES[auth.locale ?? this.s.settings.get('defaultLocale')] ?? NAMES.de;
    const year = String(date.getFullYear());
    const month = `${pad(date.getMonth() + 1)} ${names.months[date.getMonth()]}`;
    const dayTitle = `${year}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${names.weekdays[date.getDay()]}`;

    const journal = await this.findOrCreate(auth, space.id, null, 'Journal', '📓', `<p>${names.intro}</p><div data-type="children" data-depth="2" data-sort="title"></div>`);
    const yearPage = await this.findOrCreate(auth, space.id, journal.id, year, '📅', '<div data-type="children" data-depth="2" data-sort="title"></div>');
    const monthPage = await this.findOrCreate(auth, space.id, yearPage.id, month, '🗓️', '<div data-type="children" data-depth="1" data-sort="title"></div>');
    const existing = this.s.db.get<PageRow>(
      "SELECT * FROM pages WHERE space_id = ? AND parent_id = ? AND title = ? AND deleted_at IS NULL AND status = 'current'",
      space.id,
      monthPage.id,
      dayTitle,
    );
    if (existing) return existing;
    const template = this.s.db.get<{ id: number }>("SELECT id FROM templates WHERE builtin_key = 'journal' LIMIT 1");
    return this.s.pages.create(auth, {
      spaceId: space.id,
      parentId: monthPage.id,
      title: dayTitle,
      icon: '📝',
      templateId: template?.id ?? null,
      content: template ? undefined : names.fallback,
      changeNote: names.note,
      silent: true,
    });
  }
}

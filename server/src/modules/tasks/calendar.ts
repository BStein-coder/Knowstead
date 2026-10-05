/**
 * Kalender-Abo (ICS) für Aufgaben und Wiedervorlagen.
 *
 * Kalenderprogramme (Outlook, Apple, Google, Thunderbird) können keine Cookies
 * senden. Jede Person bekommt deshalb einen geheimen, widerrufbaren Link; in der
 * Datenbank liegt nur der Hash. Der Feed zeigt ausschließlich, was die Person
 * selbst sehen darf.
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { randomToken, sha256 } from '../../core/crypto.ts';
import { nowIso } from '../../db/database.ts';
import { notFound } from '../../core/errors.ts';

/** Text für ICS maskieren (RFC 5545, 3.3.11). */
export function icsText(value: string): string {
  // Auch einzelne CR umwandeln – sonst ließen sich über Aufgabentitel eigene Kalenderzeilen einschleusen
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');
}

/** Zeilen nach 75 Oktetten falten, ohne UTF-8-Zeichen zu zerteilen. */
export function icsFold(line: string): string {
  if (Buffer.byteLength(line, 'utf8') <= 75) return line;
  const parts: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch, 'utf8');
    const limit = parts.length ? 74 : 75;
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function icsDate(isoDay: string): string {
  return isoDay.slice(0, 10).replace(/-/g, '');
}

function nextDay(isoDay: string): string {
  const d = new Date(`${isoDay.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const PRIORITY: Record<string, number> = { urgent: 1, high: 3, normal: 5, low: 9 };
const PRIORITY_LABEL: Record<string, string> = { urgent: 'Dringend', high: 'Hoch', normal: 'Normal', low: 'Niedrig' };

export class CalendarService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  status(auth: AuthContext): { active: boolean; createdAt: string | null; lastUsedAt: string | null } {
    const user = this.s.perms.requireUser(auth);
    const row = this.s.db.get<{ created_at: string; last_used_at: string | null }>('SELECT created_at, last_used_at FROM calendar_feeds WHERE user_id = ?', user.id);
    return { active: !!row, createdAt: row?.created_at ?? null, lastUsedAt: row?.last_used_at ?? null };
  }

  /** Neuen Link erzeugen – ein vorhandener wird damit ungültig. */
  rotate(auth: AuthContext): { url: string; webcal: string } {
    const user = this.s.perms.requireUser(auth);
    const token = randomToken(32);
    this.s.db.run(
      `INSERT INTO calendar_feeds (user_id, token_hash, created_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, last_used_at = NULL`,
      user.id,
      sha256(token),
      nowIso(),
    );
    this.s.emit(auth, { type: 'token.created', target: { type: 'calendar', id: user.id, label: 'Kalender-Abo' } });
    const url = `${this.s.config.baseUrl}/api/v1/calendar/${token}.ics`;
    return { url, webcal: url.replace(/^https?:/, 'webcal:') };
  }

  revoke(auth: AuthContext): void {
    const user = this.s.perms.requireUser(auth);
    if (this.s.db.run('DELETE FROM calendar_feeds WHERE user_id = ?', user.id).changes) {
      this.s.emit(auth, { type: 'token.revoked', target: { type: 'calendar', id: user.id, label: 'Kalender-Abo' } });
    }
  }

  /** ICS-Inhalt für einen Link: eigene offene Aufgaben (oder ein Plan) und eigene Wiedervorlagen. */
  feed(token: string, options: { board?: number } = {}): { body: string; name: string } {
    const row = /^[A-Za-z0-9_-]{20,100}$/.test(token)
      ? this.s.db.get<{ user_id: number; last_used_at: string | null }>('SELECT user_id, last_used_at FROM calendar_feeds WHERE token_hash = ?', sha256(token))
      : undefined;
    const user = row ? this.s.users.get(row.user_id) : undefined;
    if (!row || !user || user.status !== 'active') throw notFound('Kalender nicht gefunden');
    if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > 10 * 60_000) {
      this.s.db.run('UPDATE calendar_feeds SET last_used_at = ? WHERE user_id = ?', nowIso(), user.id);
    }
    const auth = this.s.perms.forUser(user, { via: 'token' });
    const site = this.s.settings.get('siteName');
    const host = new URL(this.s.config.baseUrl).host;
    const now = stamp(nowIso());
    const events: string[][] = [];

    const tasks = options.board
      ? this.s.tasks.list(auth, options.board).filter((t) => t.dueDate && t.status !== 'done')
      : this.s.tasks.query(auth, { assignee: 'me', status: 'open-all', limit: 500 }).filter((t) => t.dueDate);
    let name = `${site} – Meine Aufgaben`;
    if (options.board && tasks[0]) name = `${site} – ${tasks[0].boardName}`;
    else if (options.board) name = `${site} – Plan`;

    for (const task of tasks) {
      const link = `${this.s.config.baseUrl}/s/${encodeURIComponent(task.spaceKey)}/tasks?board=${task.boardId}&task=${task.id}`;
      const description = [
        `Plan: ${task.boardName} (${task.spaceName})`,
        `Priorität: ${PRIORITY_LABEL[task.priority] ?? task.priority}`,
        task.assignee ? `Verantwortlich: ${task.assignee.displayName}` : '',
        task.progress ? `Fortschritt: ${task.progress} %` : '',
        task.notes ? `\n${task.notes}` : '',
        `\n${link}`,
      ]
        .filter(Boolean)
        .join('\n');
      events.push([
        'BEGIN:VEVENT',
        `UID:task-${task.id}@${host}`,
        `DTSTAMP:${now}`,
        `DTSTART;VALUE=DATE:${icsDate(task.startDate && task.startDate <= task.dueDate! ? task.startDate : task.dueDate!)}`,
        `DTEND;VALUE=DATE:${icsDate(nextDay(task.dueDate!))}`,
        `SUMMARY:${icsText(`${task.overdue ? '⚠ ' : ''}${task.title}`)}`,
        `DESCRIPTION:${icsText(description)}`,
        `URL:${link}`,
        `PRIORITY:${PRIORITY[task.priority] ?? 5}`,
        `CATEGORIES:${icsText(site)},Aufgabe`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
      ]);
    }

    if (!options.board) {
      const reviews = this.s.reviewCycle.overview(auth, { scope: 'mine', state: 'all', limit: 500 }).items;
      for (const item of reviews) {
        const day = item.dueAt.slice(0, 10);
        events.push([
          'BEGIN:VEVENT',
          `UID:review-${item.id}-${icsDate(day)}@${host}`,
          `DTSTAMP:${now}`,
          `DTSTART;VALUE=DATE:${icsDate(day)}`,
          `DTEND;VALUE=DATE:${icsDate(nextDay(day))}`,
          `SUMMARY:${icsText(`Wiedervorlage: ${item.title}`)}`,
          `DESCRIPTION:${icsText(`Seite prüfen und als aktuell bestätigen.\nBereich: ${item.space.name}\n${this.s.config.baseUrl}${item.url}`)}`,
          `URL:${this.s.config.baseUrl}${item.url}`,
          `CATEGORIES:${icsText(site)},Wiedervorlage`,
          'TRANSP:TRANSPARENT',
          'END:VEVENT',
        ]);
      }
    }

    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      `PRODID:-//${icsText(site)}//Knowstead//DE`,
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsText(name)}`,
      'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
      'X-PUBLISHED-TTL:PT1H',
      ...events.flat(),
      'END:VCALENDAR',
    ];
    return { body: `${lines.map(icsFold).join('\r\n')}\r\n`, name };
  }
}

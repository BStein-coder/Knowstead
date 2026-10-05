import fs from 'node:fs';
import path from 'node:path';
import type { Services } from '../services.ts';
import type { AuthContext } from '../core/permissions.ts';
import { nowIso } from '../db/database.ts';
import { markdownToHtml } from '../core/markdown.ts';
import { parseFrontMatter } from '../modules/transfer/frontmatter.ts';
import { BUILTIN_TEMPLATES } from './templates.ts';
import { BUILTIN_TEMPLATES_EN } from './templates.en.ts';
import type { Locale } from '../core/i18n.ts';
import { REMOVED_BUILTINS_KEY } from '../modules/templates/service.ts';
import { SYSTEM_GROUP_KEYS } from '../modules/groups/service.ts';

export const ADMIN_GROUP = 'Administratoren';
export const USERS_GROUP = 'Benutzer';

/** Namen und Beschreibungen der Systemgruppen je Sprache der Einrichtung */
const SYSTEM_GROUPS = {
  admin: {
    de: { name: ADMIN_GROUP, description: 'Systemadministratoren mit Vollzugriff.' },
    en: { name: 'Administrators', description: 'System administrators with full access.' },
  },
  users: {
    de: { name: USERS_GROUP, description: 'Alle Benutzer. Neue Konten werden automatisch hinzugefügt.' },
    en: { name: 'Users', description: 'All users. New accounts are added automatically.' },
  },
} as const;

/** Englische Einrichtung: unveränderte Systemgruppen englisch benennen (nur Name und Beschreibung). */
function localizeSystemGroups(s: Services): void {
  for (const kind of ['admin', 'users'] as const) {
    const group = s.groups.systemGroup(kind);
    const { de, en } = SYSTEM_GROUPS[kind];
    if (!group || group.name !== de.name || s.groups.byName(en.name)) continue;
    s.db.run(
      'UPDATE groups SET name = ?, description = CASE WHEN description = ? THEN ? ELSE description END, updated_at = ? WHERE id = ?',
      en.name,
      de.description,
      en.description,
      nowIso(),
      group.id,
    );
  }
}

/** Idempotente Grunddaten: Systemgruppen und eingebaute Vorlagen. */
export function ensureBaseData(s: Services): void {
  const now = nowIso();
  s.db.transaction(() => {
    // Systemgruppen werden über ihre gemerkte ID gefunden (ältere Installationen: über den deutschen Namen),
    // damit englische Einrichtungen sie umbenennen können, ohne dass sie beim nächsten Start neu entstehen.
    const ensureSystemGroup = (kind: 'admin' | 'users', insert: () => number) => {
      const existing = s.groups.systemGroup(kind) ?? s.groups.byName(SYSTEM_GROUPS[kind].de.name);
      s.settings.setInternal(SYSTEM_GROUP_KEYS[kind], existing?.id ?? insert());
    };
    ensureSystemGroup('admin', () =>
      Number(
        s.db.run(
          'INSERT INTO groups (name, description, permissions, is_system, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?)',
          ADMIN_GROUP,
          SYSTEM_GROUPS.admin.de.description,
          JSON.stringify(['admin']),
          now,
          now,
        ).lastInsertRowid,
      ),
    );
    ensureSystemGroup('users', () =>
      Number(
        s.db.run(
          'INSERT INTO groups (name, description, permissions, is_system, is_default, created_at, updated_at) VALUES (?, ?, ?, 1, 1, ?, ?)',
          USERS_GROUP,
          SYSTEM_GROUPS.users.de.description,
          // KI ist standardmäßig aus; das Recht greift erst, wenn ein Administrator sie einrichtet.
          JSON.stringify(['spaces.create', 'api.tokens', 'ai.use']),
          now,
          now,
        ).lastInsertRowid,
      ),
    );
    const removed = new Set(s.settings.getInternal<string[]>(REMOVED_BUILTINS_KEY, []));
    for (const t of BUILTIN_TEMPLATES) {
      if (removed.has(t.key) || s.db.get('SELECT 1 FROM templates WHERE builtin_key = ?', t.key)) continue;
      s.db.run(
        `INSERT INTO templates (space_id, name, description, icon, category, title_pattern, content_type, content, labels, properties, builtin_key, created_at, updated_at)
         VALUES (NULL, ?, ?, ?, ?, ?, 'richtext', ?, ?, ?, ?, ?, ?)`,
        t.name,
        t.description,
        t.icon,
        t.category,
        t.titlePattern,
        t.content.replace(/\n/g, ''),
        JSON.stringify(t.labels),
        JSON.stringify(t.properties),
        t.key,
        now,
        now,
      );
    }
  });
}

interface HandbookChapter {
  file: string;
  title: string;
  icon: string | null;
  labels: string[];
  html: string;
}

/** Sprache des Handbuchs: bei der Einrichtung festgelegt, danach unverändert (Aktualisierungen bleiben in derselben Sprache). */
function handbookLocale(s: Services): Locale {
  return s.settings.getInternal<Locale | null>('handbookLocale', null) ?? (s.spaces.byKey('HANDBUCH') ? 'de' : s.settings.get('defaultLocale'));
}

const HANDBOOK_TEXT = {
  de: { dir: 'handbuch', name: 'Handbuch', description: 'Benutzer- und Administrationshandbuch für Knowstead.', label: 'handbuch', created: 'Handbuch angelegt', updated: 'Handbuch aktualisiert' },
  en: { dir: 'handbook', name: 'Handbook', description: 'User and administration handbook for Knowstead.', label: 'handbook', created: 'Handbook created', updated: 'Handbook updated' },
};

/** Kapitel des Handbuchs aus docs/handbuch bzw. docs/handbook (sortiert nach Dateiname). */
function readHandbook(s: Services): HandbookChapter[] {
  const dir = path.join(s.config.rootDir, 'docs', HANDBOOK_TEXT[handbookLocale(s)].dir);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { data, body } = parseFrontMatter(fs.readFileSync(path.join(dir, f), 'utf8'));
      const h1 = body.match(/^\s*#\s+(.+)\s*\n/);
      const title = (typeof data.title === 'string' && data.title) || h1?.[1].trim() || f.replace(/\.md$/, '');
      const md = h1 ? body.replace(h1[0], '') : body;
      const labels = Array.isArray(data.labels) ? data.labels.map(String) : [];
      return { file: f, title, icon: typeof data.icon === 'string' ? data.icon : null, labels, html: markdownToHtml(md) };
    });
}

/** Änderungsnotizen, die nur vom Handbuch selbst stammen – alles andere gilt als Bearbeitung durch Menschen. */
const HANDBOOK_NOTES = ['Handbuch angelegt', 'Handbuch aktualisiert', 'Bereich angelegt', 'Handbook created', 'Handbook updated', 'Space created'];

/**
 * Handbuch nach einem Update auf den Stand von docs/handbuch bringen: fehlende Kapitel anlegen und
 * Kapitel aktualisieren, die niemand von Hand geändert hat. Bearbeitete Kapitel bleiben unangetastet.
 */
export async function syncHandbook(s: Services, auth: AuthContext): Promise<{ created: number; updated: number; skipped: number }> {
  s.perms.requireGlobal(auth, 'admin');
  const result = { created: 0, updated: 0, skipped: 0 };
  const space = s.spaces.byKey('HANDBUCH');
  const text = HANDBOOK_TEXT[handbookLocale(s)];
  if (!space) {
    await seedAfterSetup(s, auth, { sampleContent: false });
    result.created = readHandbook(s).length;
    return result;
  }
  for (const chapter of readHandbook(s)) {
    const isHome = chapter.file.startsWith('00');
    const page = isHome
      ? s.db.get<{ id: number; version: number }>('SELECT id, version FROM pages WHERE id = ? AND deleted_at IS NULL', space.home_page_id ?? 0)
      : s.db.get<{ id: number; version: number }>(
          'SELECT id, version FROM pages WHERE space_id = ? AND parent_id IS NULL AND title = ? AND deleted_at IS NULL',
          space.id,
          chapter.title,
        );
    if (!page) {
      if (isHome) continue;
      await s.pages.create(auth, {
        spaceId: space.id,
        parentId: null,
        title: chapter.title,
        icon: chapter.icon,
        content: chapter.html,
        labels: [text.label, ...chapter.labels],
        changeNote: text.created,
        silent: true,
      });
      result.created++;
      continue;
    }
    const manual =
      s.db.value<number>(
        `SELECT COUNT(*) FROM page_revisions WHERE page_id = ? AND change_note NOT IN (${HANDBOOK_NOTES.map(() => '?').join(',')})`,
        page.id,
        ...HANDBOOK_NOTES,
      ) ?? 0;
    if (manual > 0) {
      result.skipped++;
      continue;
    }
    const saved = await s.pages.save(auth, page.id, { content: chapter.html, changeNote: text.updated, minor: true });
    if (saved.version !== page.version) result.updated++;
  }
  // Kapitelreihenfolge wie im Handbuch, eigene Seiten des Bereichs folgen dahinter.
  if (result.created) {
    const order = readHandbook(s).map((c) => c.title);
    const roots = s.db.all<{ id: number; title: string }>(
      'SELECT id, title FROM pages WHERE space_id = ? AND parent_id IS NULL AND deleted_at IS NULL ORDER BY position, id',
      space.id,
    );
    const rank = (title: string) => (order.includes(title) ? order.indexOf(title) : order.length);
    const sorted = [...roots].sort((a, b) => rank(a.title) - rank(b.title));
    s.db.transaction(() => sorted.forEach((p, i) => s.db.run('UPDATE pages SET position = ? WHERE id = ?', i, p.id)));
  }
  return result;
}

/** Inhalte nach der Ersteinrichtung: Handbuch-Bereich (aus docs/handbuch) und optional Beispiele. */
export async function seedAfterSetup(s: Services, auth: AuthContext, options: { sampleContent: boolean }): Promise<void> {
  const locale = s.settings.get('defaultLocale');
  if (!s.spaces.byKey('HANDBUCH')) s.settings.setInternal('handbookLocale', locale);
  if (locale === 'en') {
    localizeBuiltinTemplates(s);
    localizeSystemGroups(s);
  }
  const text = HANDBOOK_TEXT[handbookLocale(s)];
  const docs = readHandbook(s);
  if (docs.length && !s.spaces.byKey('HANDBUCH')) {
    const home = docs.find((d) => d.file.startsWith('00'));
    const space = await s.spaces.create(auth, {
      key: 'HANDBUCH',
      name: text.name,
      description: text.description,
      icon: '📖',
      color: '#2563eb',
      preset: 'readonly',
      homeContent: home?.html,
    });
    for (const d of docs) {
      if (d === home) continue;
      await s.pages.create(auth, {
        spaceId: space.id,
        parentId: null,
        title: d.title,
        icon: d.icon,
        content: d.html,
        labels: [text.label, ...d.labels],
        changeNote: text.created,
        silent: true,
      });
    }
  }
  if (options.sampleContent && !s.spaces.byKey('TEAM')) await seedSampleContent(s, auth, locale);
}

/**
 * Eingebaute Vorlagen auf Englisch umstellen – nur solange niemand sie geändert hat. Wird bei der Einrichtung
 * einer englischsprachigen Installation aufgerufen (die Vorlagen entstehen schon beim ersten Start).
 */
function localizeBuiltinTemplates(s: Services): void {
  const now = nowIso();
  s.db.transaction(() => {
    for (const t of BUILTIN_TEMPLATES_EN) {
      s.db.run(
        `UPDATE templates SET name = ?, description = ?, category = ?, title_pattern = ?, content = ?, labels = ?, properties = ?, updated_at = ?
         WHERE builtin_key = ? AND space_id IS NULL AND updated_at = created_at`,
        t.name,
        t.description,
        t.category,
        t.titlePattern,
        t.content.replace(/\n/g, ''),
        JSON.stringify(t.labels),
        JSON.stringify(t.properties),
        now,
        t.key,
      );
      // updated_at wieder angleichen, damit spätere Aufrufe die Vorlage weiterhin als unverändert erkennen
      s.db.run('UPDATE templates SET created_at = updated_at WHERE builtin_key = ? AND space_id IS NULL AND updated_at = ?', t.key, now);
    }
  });
}

const SAMPLE = {
  de: {
    space: { name: 'Team-Bereich', description: 'Beispielbereich mit typischen Inhalten – gerne anpassen oder löschen.' },
    projects: 'Projekte',
    projectsContent:
      '<p>Übersicht aller Projekte. Die Tabelle wird automatisch aus den Eigenschaften der Unterseiten erzeugt:</p><div data-type="properties-report" data-scope="children" data-columns="Status,Verantwortlich,Start,Ende"></div>',
    projectPages: [
      ['Projekt: Neues Intranet', 'in Arbeit'],
      ['Projekt: Kundenportal 2.0', 'geplant'],
    ],
    meetings: 'Besprechungen',
    meetingsContent: '<p>Alle Besprechungsprotokolle des Teams.</p><div data-type="children" data-depth="1" data-sort="updated"></div>',
    kickoff: 'Besprechung Kick-off',
    decision: 'Entscheidung: Knowstead als zentrale Wissensbasis',
    releaseNotes: 'Versionshinweise',
    note: 'Beispielinhalt',
  },
  en: {
    space: { name: 'Team space', description: 'Example space with typical content – feel free to adapt or delete it.' },
    projects: 'Projects',
    projectsContent:
      '<p>Overview of all projects. The table is generated automatically from the properties of the child pages:</p><div data-type="properties-report" data-scope="children" data-columns="Status,Owner,Start,End"></div>',
    projectPages: [
      ['Project: New intranet', 'in progress'],
      ['Project: Customer portal 2.0', 'planned'],
    ],
    meetings: 'Meetings',
    meetingsContent: '<p>All meeting minutes of the team.</p><div data-type="children" data-depth="1" data-sort="updated"></div>',
    kickoff: 'Meeting kick-off',
    decision: 'Decision: Knowstead as central knowledge base',
    releaseNotes: 'Release notes',
    note: 'Sample content',
  },
};

async function seedSampleContent(s: Services, auth: AuthContext, locale: Locale): Promise<void> {
  const x = SAMPLE[locale] ?? SAMPLE.de;
  const space = await s.spaces.create(auth, {
    key: 'TEAM',
    name: x.space.name,
    description: x.space.description,
    icon: '🚀',
    color: '#7c3aed',
    preset: 'open',
  });
  const templates = new Map(
    s.db.all<{ id: number; builtin_key: string }>('SELECT id, builtin_key FROM templates WHERE builtin_key IS NOT NULL').map((t) => [t.builtin_key, t.id]),
  );
  const projects = await s.pages.create(auth, {
    spaceId: space.id,
    title: x.projects,
    icon: '📁',
    content: x.projectsContent,
    changeNote: x.note,
    silent: true,
  });
  for (const [title, status] of x.projectPages) {
    const p = await s.pages.create(auth, {
      spaceId: space.id,
      parentId: projects.id,
      title,
      templateId: templates.get('project') ?? null,
      changeNote: x.note,
      silent: true,
    });
    const props = s.labels.propertiesOf(p.id).map((x) => (x.name === 'Status' ? { ...x, value: status } : x));
    s.labels.writeProperties(p.id, props);
  }
  const meetings = await s.pages.create(auth, {
    spaceId: space.id,
    title: x.meetings,
    icon: '🗓️',
    content: x.meetingsContent,
    changeNote: x.note,
    silent: true,
  });
  await s.pages.create(auth, {
    spaceId: space.id,
    parentId: meetings.id,
    title: x.kickoff,
    templateId: templates.get('meeting') ?? null,
    changeNote: x.note,
    silent: true,
  });
  await s.pages.create(auth, {
    spaceId: space.id,
    title: x.decision,
    templateId: templates.get('decision') ?? null,
    changeNote: x.note,
    silent: true,
  });
  await s.pages.create(auth, {
    spaceId: space.id,
    title: x.releaseNotes,
    icon: '🚀',
    templateId: templates.get('releasenotes') ?? null,
    changeNote: x.note,
    silent: true,
  });
}

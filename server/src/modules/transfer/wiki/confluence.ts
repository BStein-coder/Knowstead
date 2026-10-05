/**
 * Confluence-Import (Server, Data Center und Cloud).
 *
 * 1. **XML-Export** (Bereich → Einstellungen → Export → XML, als ZIP): `entities.xml` enthält Seiten,
 *    Blogbeiträge, Inhalte im Speicherformat, ältere Versionen, Stichwörter, Personen und Anhänge;
 *    die Dateien liegen unter `attachments/<Seite>/<Anhang>/<Version>`. Beste Wahl – mit Hierarchie,
 *    Reihenfolge, Versionsgeschichte und Stichwörtern.
 * 2. **HTML-Export** (als ZIP): gerenderte Seiten mit Brotkrumen-Navigation und Anhängen. Ohne
 *    Versionsgeschichte und Stichwörter; die Hierarchie ergibt sich aus den Brotkrumen.
 *
 * `entities.xml` wird ohne XML-Bibliothek gelesen: Die Objekte sind flach aneinandergereiht; CDATA-
 * Abschnitte werden beim Suchen übersprungen, damit Seiteninhalte die Struktur nicht stören.
 */
import path from 'node:path';
import { parse } from 'node-html-parser';
import type { ArchiveEntries } from '../../../core/archive-entries.ts';
import { decodeXml, emptyResult, isoDate, lazyMedia, type WikiDocument, type WikiParseResult } from './common.ts';
import { renderedToHtml, storageToHtml } from './confluence-storage.ts';

const TEXT = new TextDecoder('utf-8');

export interface ConfluenceOptions {
  history: boolean;
  maxRevisions: number;
  /** Sprache für Datumsangaben im Text (Makro „Datum“) */
  locale?: 'de' | 'en';
}

export function isConfluenceArchive(entries: ArchiveEntries): boolean {
  const names = entries.names();
  if (names.some((n) => /(^|\/)entities\.xml$/i.test(n))) return true;
  if (names.some((n) => /(^|\/)exportDescriptor\.properties$/i.test(n))) return true;
  // HTML-Export: Seiten mit Confluence-typischer Struktur
  return names.some((n) => {
    if (!/\.html?$/i.test(n)) return false;
    const start = TEXT.decode(entries.head(n, 20000));
    return /id="main-content"|class="wiki-content/.test(start) && /confluence/i.test(start);
  });
}

/* ------------------------------------------------------------------ */
/* entities.xml lesen                                                   */
/* ------------------------------------------------------------------ */

interface EntityObject {
  cls: string;
  id: string | null;
  props: Map<string, string>;
  refs: Map<string, string>;
  collections: Map<string, string[]>;
}

/** Objekte nacheinander liefern, CDATA-sicher. */
export function* entityObjects(xml: string): Generator<EntityObject> {
  let pos = 0;
  for (;;) {
    const start = xml.indexOf('<object ', pos);
    if (start < 0) return;
    const headEnd = xml.indexOf('>', start);
    if (headEnd < 0) return;
    const head = xml.slice(start, headEnd + 1);
    let i = headEnd + 1;
    let end = -1;
    while (i < xml.length) {
      const close = xml.indexOf('</object>', i);
      if (close < 0) return;
      const cdata = xml.indexOf('<![CDATA[', i);
      if (cdata >= 0 && cdata < close) {
        const cdataEnd = xml.indexOf(']]>', cdata + 9);
        i = cdataEnd < 0 ? xml.length : cdataEnd + 3;
        continue;
      }
      end = close;
      break;
    }
    if (end < 0) return;
    yield parseObject(head.match(/class="([^"]+)"/)?.[1] ?? '', xml.slice(headEnd + 1, end));
    pos = end + '</object>'.length;
  }
}

function parseObject(cls: string, body: string): EntityObject {
  const cdata: string[] = [];
  const safe = body.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text: string) => `\u0001${cdata.push(text) - 1}\u0002`);
  const value = (raw: string) => {
    const trimmed = raw.trim();
    // Reiner CDATA-Inhalt bleibt unverändert, übriger Text wird dekodiert
    if (/^(\u0001\d+\u0002\s*)+$/.test(trimmed)) return trimmed.replace(/\u0001(\d+)\u0002\s*/g, (_, n: string) => cdata[Number(n)]);
    return decodeXml(trimmed).replace(/\u0001(\d+)\u0002/g, (_, n: string) => cdata[Number(n)]);
  };
  const obj: EntityObject = { cls, id: null, props: new Map(), refs: new Map(), collections: new Map() };
  const withoutNested = safe.replace(/<collection\b[\s\S]*?<\/collection>/g, (m) => {
    const name = m.match(/name="([^"]+)"/)?.[1];
    if (name) obj.collections.set(name, [...m.matchAll(/<id name="[^"]+">([^<]*)<\/id>/g)].map((x) => x[1].trim()));
    return '';
  });
  const props = withoutNested.replace(/<property name="([^"]+)"[^>]*?(?:\/>|>([\s\S]*?)<\/property>)/g, (_m, name: string, inner: string | undefined) => {
    const ref = inner?.match(/^\s*<id name="[^"]+">([^<]*)<\/id>\s*$/);
    if (ref) obj.refs.set(name, ref[1].trim());
    else obj.props.set(name, value(inner ?? ''));
    return '';
  });
  obj.id = props.match(/<id name="(?:id|key)">([^<]*)<\/id>/)?.[1]?.trim() ?? null;
  return obj;
}

/* ------------------------------------------------------------------ */
/* XML-Export                                                           */
/* ------------------------------------------------------------------ */

interface ContentEntity {
  id: string;
  kind: 'page' | 'blog';
  title: string;
  version: number;
  status: string;
  spaceId: string | null;
  parentId: string | null;
  originalId: string | null;
  creator: string | null;
  lastModifier: string | null;
  created: string | null;
  modified: string | null;
  position: number | null;
  comment: string;
}

export function parseConfluenceXml(entries: ArchiveEntries, options: ConfluenceOptions): WikiParseResult {
  const result = emptyResult('confluence');
  const names = entries.names();
  const entitiesName = names.find((n) => /(^|\/)entities\.xml$/i.test(n));
  if (!entitiesName) throw new Error('entities.xml fehlt – bitte den XML-Export von Confluence als ZIP hochladen');
  const base = entitiesName.slice(0, entitiesName.length - 'entities.xml'.length);
  const xml = TEXT.decode(entries.read(entitiesName));

  const spaces = new Map<string, { key: string; name: string; home: string | null }>();
  const contents = new Map<string, ContentEntity>();
  const bodies = new Map<string, string>(); // Inhalt-ID → Speicherformat
  const attachments: { id: string; title: string; version: number; status: string; owner: string | null; original: string | null }[] = [];
  const labels = new Map<string, { name: string; namespace: string }>();
  const labellings: { label: string; content: string }[] = [];
  const users = new Map<string, string>();
  let comments = 0;

  for (const obj of entityObjects(xml)) {
    const id = obj.id;
    if (!id) continue;
    switch (obj.cls) {
      case 'Space':
        spaces.set(id, { key: obj.props.get('key') ?? id, name: obj.props.get('name') ?? obj.props.get('key') ?? id, home: obj.refs.get('homePage') ?? null });
        break;
      case 'Page':
      case 'BlogPost':
        contents.set(id, {
          id,
          kind: obj.cls === 'Page' ? 'page' : 'blog',
          title: obj.props.get('title') ?? 'Ohne Titel',
          version: Number(obj.props.get('version')) || 1,
          status: obj.props.get('contentStatus') ?? 'current',
          spaceId: obj.refs.get('space') ?? null,
          parentId: obj.refs.get('parent') ?? null,
          originalId: obj.refs.get('originalVersion') ?? null,
          creator: obj.refs.get('creator') ?? obj.props.get('creatorName') ?? null,
          lastModifier: obj.refs.get('lastModifier') ?? obj.props.get('lastModifierName') ?? null,
          created: isoDate((obj.props.get('creationDate') ?? '').replace(' ', 'T')),
          modified: isoDate((obj.props.get('lastModificationDate') ?? '').replace(' ', 'T')),
          position: obj.props.has('position') && obj.props.get('position') !== '' ? Number(obj.props.get('position')) : null,
          comment: obj.props.get('versionComment') ?? '',
        });
        break;
      case 'BodyContent': {
        const owner = obj.refs.get('content');
        const body = obj.props.get('body');
        if (owner && body !== undefined) bodies.set(owner, body);
        break;
      }
      case 'Attachment':
        attachments.push({
          id,
          title: obj.props.get('title') ?? obj.props.get('fileName') ?? id,
          version: Number(obj.props.get('version') ?? obj.props.get('attachmentVersion')) || 1,
          status: obj.props.get('contentStatus') ?? 'current',
          owner: obj.refs.get('containerContent') ?? obj.refs.get('content') ?? null,
          original: obj.refs.get('originalVersion') ?? null,
        });
        break;
      case 'Label':
        labels.set(id, { name: obj.props.get('name') ?? '', namespace: obj.props.get('namespace') ?? 'global' });
        break;
      case 'Labelling': {
        const label = obj.refs.get('label');
        const content = obj.refs.get('content') ?? obj.refs.get('labelable');
        if (label && content) labellings.push({ label, content });
        break;
      }
      case 'ConfluenceUserImpl':
      case 'User':
        users.set(id, obj.props.get('name') ?? obj.props.get('lowerName') ?? id);
        break;
      case 'Comment':
        comments++;
        break;
    }
  }

  const current = [...contents.values()].filter((c) => !c.originalId && c.status === 'current');
  const skippedDrafts = [...contents.values()].filter((c) => !c.originalId && c.status !== 'current').length;
  if (!current.length) throw new Error('Der Export enthält keine veröffentlichten Seiten');

  const spaceKeyOf = (c: ContentEntity) => (c.spaceId && spaces.get(c.spaceId)?.key) || [...spaces.values()][0]?.key || 'SPACE';
  const titleIndex = new Map<string, string>();
  for (const c of current) titleIndex.set(`${spaceKeyOf(c).toLowerCase()}:${c.title.toLowerCase()}`, c.id);
  const unsupported = new Set<string>();
  const multipleSpaces = spaces.size > 1;
  const userName = (key: string | null) => (key ? (users.get(key) ?? null) : null);

  const convert = (storage: string, pageKey: string, spaceKey: string) =>
    storageToHtml(storage, {
      pageKey,
      spaceKey,
      resolvePage: (title, space) => titleIndex.get(`${space.toLowerCase()}:${title.toLowerCase()}`) ?? null,
      userName: (key) => userName(key),
      unsupported,
      locale: options.locale,
    });

  // Ältere Versionen je Seite
  const history = new Map<string, ContentEntity[]>();
  for (const c of contents.values()) {
    if (!c.originalId) continue;
    history.set(c.originalId, [...(history.get(c.originalId) ?? []), c]);
  }

  // Ordner je Bereich (bei mehreren Bereichen) und für Blogbeiträge
  if (multipleSpaces) for (const space of spaces.values()) result.folders.set(`space:${space.key}`, { title: space.name, parentKey: null });
  const blogFolder = (spaceKey: string) => {
    const key = `blog:${spaceKey}`;
    if (!result.folders.has(key)) result.folders.set(key, { title: 'Blog', parentKey: multipleSpaces ? `space:${spaceKey}` : null });
    return key;
  };

  for (const c of current) {
    const spaceKey = spaceKeyOf(c);
    const parentKey = c.kind === 'blog' ? blogFolder(spaceKey) : c.parentId && contents.has(c.parentId) ? c.parentId : multipleSpaces ? `space:${spaceKey}` : null;
    const doc: WikiDocument = {
      key: c.id,
      title: c.title,
      parentKey,
      html: convert(bodies.get(c.id) ?? '', c.id, spaceKey),
      labels: labellings
        .filter((l) => l.content === c.id)
        .map((l) => labels.get(l.label))
        .filter((l): l is { name: string; namespace: string } => !!l && l.namespace !== 'my' && !!l.name)
        .map((l) => l.name.slice(0, 40)),
      revisions: [],
      author: userName(c.creator),
      createdAt: c.created,
      updatedAt: c.modified,
      position: c.position ?? undefined,
    };
    if (options.history) {
      const older = (history.get(c.id) ?? []).sort((a, b) => a.version - b.version).slice(-options.maxRevisions);
      doc.revisions = older.map((v) => ({ title: v.title, html: convert(bodies.get(v.id) ?? '', c.id, spaceKey), author: userName(v.lastModifier ?? v.creator), comment: v.comment, timestamp: v.modified }));
    }
    result.documents.push(doc);
  }

  // Startseite eines Bereichs als Alias, damit Links auf den Bereich dort landen
  for (const space of spaces.values()) if (space.home && contents.has(space.home)) result.aliases.set(`space-home:${space.key}`, space.home);

  // Anhänge (nur aktuelle Fassung)
  let missingFiles = 0;
  for (const att of attachments) {
    if (att.original || att.status !== 'current' || !att.owner || !contents.has(att.owner)) continue;
    const owner = contents.get(att.owner)!;
    const ownerKey = owner.originalId ?? owner.id;
    const folder = `${base}attachments/${att.owner}/${att.id}/`;
    const file = entries.has(`${folder}${att.version}`) ? `${folder}${att.version}` : names.find((name) => name.startsWith(folder));
    if (!file) {
      missingFiles++;
      continue;
    }
    result.media.set(`${ownerKey}@${att.title}`, lazyMedia(att.title, () => entries.read(file), ownerKey));
  }

  if (skippedDrafts) result.warnings.push(`${skippedDrafts} Entwürfe oder gelöschte Seiten wurden nicht übernommen`);
  if (comments) result.warnings.push(`${comments} Kommentare aus Confluence wurden nicht übernommen`);
  if (missingFiles) result.warnings.push(`${missingFiles} Anhänge fehlen im Archiv (Export ohne Anhänge?)`);
  if (unsupported.size) result.warnings.push(`Nicht übernommene Makros: ${[...unsupported].sort().join(', ')}`);
  return result;
}

/* ------------------------------------------------------------------ */
/* HTML-Export                                                          */
/* ------------------------------------------------------------------ */

export function parseConfluenceHtml(entries: ArchiveEntries): WikiParseResult {
  const result = emptyResult('confluence');
  const names = entries.names();
  const htmlFiles = names.filter((n) => /\.html?$/i.test(n) && !/(^|\/)index\.html?$/i.test(n) && !/(^|\/)(styles|images)\//i.test(n));
  const pageKeys = new Map<string, string>(); // Dateiname (klein) → Schlüssel
  for (const name of htmlFiles) pageKeys.set(path.posix.basename(name).toLowerCase(), path.posix.basename(name));

  const mediaKeys = new Map<string, string>(); // Pfad im Export → Medienschlüssel
  for (const name of names) {
    const m = name.match(/(?:^|\/)(attachments\/(\d+)\/[^/]+)$/);
    if (!m) continue;
    const owner = htmlFiles.find((f) => new RegExp(`_${m[2]}\\.html?$|(^|/)${m[2]}\\.html?$`, 'i').test(f));
    if (!owner) continue;
    const ownerKey = path.posix.basename(owner);
    mediaKeys.set(m[1], `${ownerKey}@${path.posix.basename(name)}`);
  }

  for (const name of htmlFiles) {
    const key = path.posix.basename(name);
    const root = parse(TEXT.decode(entries.read(name)), { comment: false });
    const main = root.querySelector('#main-content') ?? root.querySelector('.wiki-content');
    if (!main) {
      result.skipped.push({ title: key, reason: 'keine Confluence-Seite' });
      continue;
    }
    const heading = root.querySelector('#title-text')?.text.trim() ?? root.querySelector('title')?.text.trim() ?? key;
    // „Bereich : Seitentitel“ → Seitentitel
    const title = heading.includes(' : ') ? heading.slice(heading.indexOf(' : ') + 3).trim() : heading;
    const crumbs = root.querySelectorAll('#breadcrumbs a').map((a) => path.posix.basename((a.getAttribute('href') ?? '').split('#')[0]));
    const parentFile = [...crumbs].reverse().find((file) => file && !/^index\.html?$/i.test(file) && pageKeys.has(file.toLowerCase()) && file !== key);
    const html = renderedToHtml(main.innerHTML, {
      pageForFile: (file) => pageKeys.get(path.posix.basename(file).toLowerCase()) ?? null,
      mediaForPath: (file) => mediaKeys.get(file.replace(/^\.\//, '').replace(/^.*?(attachments\/)/, '$1')) ?? null,
    });
    const labels = root.querySelectorAll('.labels-content a, a.aui-label-split-main').map((a) => a.text.trim()).filter(Boolean);
    const meta = root.querySelector('.page-metadata')?.text ?? '';
    result.documents.push({
      key,
      title,
      parentKey: parentFile ? pageKeys.get(parentFile.toLowerCase())! : null,
      html,
      labels: labels.slice(0, 20),
      revisions: [],
      author: meta.match(/(?:Created by|Angelegt von|Erstellt von)\s+([^,\n]+)/i)?.[1]?.trim() ?? null,
      createdAt: null,
      updatedAt: null,
    });
  }
  for (const [file, mediaKey] of mediaKeys) {
    const ownerKey = mediaKey.slice(0, mediaKey.indexOf('@'));
    const entry = names.find((n) => n.endsWith(file));
    if (entry) result.media.set(mediaKey, lazyMedia(path.posix.basename(file), () => entries.read(entry), ownerKey));
  }
  if (!result.documents.length) throw new Error('Keine Confluence-Seiten im HTML-Export gefunden');
  result.warnings.push('HTML-Export: ohne Versionsgeschichte; für eine vollständige Übernahme den XML-Export verwenden');
  return result;
}

export function parseConfluence(entries: ArchiveEntries, options: ConfluenceOptions): WikiParseResult {
  return entries.names().some((n) => /(^|\/)entities\.xml$/i.test(n)) ? parseConfluenceXml(entries, options) : parseConfluenceHtml(entries);
}

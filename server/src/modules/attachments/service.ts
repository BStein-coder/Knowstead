import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import type { FastifyReply } from 'fastify';
import type { Services } from '../../services.ts';
import type { AttachmentRow, UserRef } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { Db, nowIso } from '../../db/database.ts';
import { badRequest, notFound, tooLarge } from '../../core/errors.ts';

export interface AttachmentDto {
  id: number;
  pageId: number;
  filename: string;
  version: number;
  mimeType: string;
  size: number;
  comment: string;
  uploadedBy: UserRef | null;
  createdAt: string;
  deletedAt: string | null;
  url: string;
  downloadUrl: string;
  isImage: boolean;
  /** Im Browser als PDF darstellbar (direkt oder über die Office-Vorschau) */
  preview: 'pdf' | 'office' | null;
  previewUrl: string | null;
  versions?: Omit<AttachmentDto, 'versions'>[];
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon', pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown',
  csv: 'text/csv', json: 'application/json', xml: 'application/xml', zip: 'application/zip', mp4: 'video/mp4', webm: 'video/webm',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  drawio: 'application/vnd.jgraph.mxfile', html: 'text/html', htm: 'text/html',
  ppt: 'application/vnd.ms-powerpoint', doc: 'application/msword', xls: 'application/vnd.ms-excel',
  vsdx: 'application/vnd.ms-visio.drawing.main+xml', vsd: 'application/vnd.visio', odt: 'application/vnd.oasis.opendocument.text',
  odp: 'application/vnd.oasis.opendocument.presentation', ods: 'application/vnd.oasis.opendocument.spreadsheet',
};

/** Karenzzeit, bevor Dateien endgültig gelöschter Anhänge vom Datenträger verschwinden */
export const FILE_GRACE_DAYS = 30;

/** Typen, die aus Sicherheitsgründen nie inline ausgeliefert werden. */
const UNSAFE_INLINE = /^(text\/html|image\/svg\+xml|application\/xhtml\+xml|text\/xml|application\/xml|application\/javascript|text\/javascript)/i;
const INLINE_OK = /^(image\/|video\/|audio\/|application\/pdf|text\/plain|text\/markdown|text\/csv|application\/json)/i;

/**
 * `Range`-Kopfzeile auswerten (nur ein einzelner Bereich, mehr verlangt kein Browser für Medien).
 * Rückgabe: `null` = ganze Datei, `'invalid'` = Bereich liegt außerhalb (416).
 */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | 'invalid' | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    // „bytes=-500“: die letzten 500 Bytes
    const last = Number(match[2]);
    if (last <= 0) return 'invalid';
    start = Math.max(0, size - last);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'invalid';
  return { start, end };
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name.replace(/\\/g, '/')).normalize('NFC');
  // Punkte und Leerzeichen am Ende entfernt Windows beim Speichern – „x.exe.“ wäre sonst ein Umweg um gesperrte Endungen
  const clean = base.replace(/[\x00-\x1f<>:"/\\|?*]+/g, '_').trim().replace(/^\.+/, '').replace(/[. ]+$/, '');
  return (clean || 'datei').slice(0, 200);
}

export class AttachmentService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  private toDto(row: AttachmentRow, users: Map<number, UserRef>): AttachmentDto {
    return {
      id: row.id,
      pageId: row.page_id,
      filename: row.filename,
      version: row.version,
      mimeType: row.mime_type,
      size: row.size,
      comment: row.comment,
      uploadedBy: users.get(row.uploaded_by ?? 0) ?? null,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      url: `/api/v1/attachments/${row.id}/raw`,
      downloadUrl: `/api/v1/attachments/${row.id}/raw?download=1`,
      isImage: /^image\//.test(row.mime_type),
      preview: this.s.previews.kindOf(row.filename, row.mime_type),
      previewUrl: this.s.previews.kindOf(row.filename, row.mime_type) ? `/api/v1/attachments/${row.id}/preview` : null,
    };
  }

  require(id: number): AttachmentRow {
    const row = this.s.db.get<AttachmentRow>('SELECT * FROM attachments WHERE id = ?', id);
    if (!row) throw notFound('Anhang nicht gefunden');
    return row;
  }

  list(auth: AuthContext, pageId: number, options: { includeDeleted?: boolean } = {}): AttachmentDto[] {
    this.s.pages.requireViewable(auth, pageId);
    // Gelöschte Dateien (Papierkorb der Anhänge) nur für Personen, die Anhänge verwalten dürfen
    if (options.includeDeleted) this.s.pages.requireAccess(auth, pageId, 'attach');
    const rows = this.s.db.all<AttachmentRow>(
      'SELECT * FROM attachments WHERE page_id = ? ORDER BY filename COLLATE NOCASE, version DESC',
      pageId,
    );
    const users = this.s.users.refs(rows.map((r) => r.uploaded_by));
    const grouped = new Map<string, AttachmentRow[]>();
    for (const r of rows) {
      const list = grouped.get(r.filename.toLowerCase()) ?? [];
      list.push(r);
      grouped.set(r.filename.toLowerCase(), list);
    }
    const result: AttachmentDto[] = [];
    for (const versions of grouped.values()) {
      const latest = versions[0];
      const deleted = !!latest.deleted_at;
      if (deleted && !options.includeDeleted) continue;
      result.push({ ...this.toDto(latest, users), versions: versions.slice(1).map((v) => this.toDto(v, users)) });
    }
    return result;
  }

  async upload(
    auth: AuthContext,
    pageId: number,
    file: { filename: string; mimetype: string; stream: Readable },
    comment = '',
  ): Promise<AttachmentDto> {
    const user = this.s.perms.requireUser(auth);
    const { page, space } = this.s.pages.requireAccess(auth, pageId, 'attach');
    const filename = sanitizeFilename(file.filename);
    const ext = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : '';
    const settings = this.s.settings.all();
    if (ext && settings.blockedExtensions.map((e) => e.toLowerCase().replace(/^\./, '')).includes(ext)) {
      file.stream.resume();
      throw badRequest(`Dateien vom Typ .${ext} sind nicht erlaubt`);
    }
    const maxBytes = settings.maxUploadMb * 1024 * 1024;
    const now = new Date();
    const storageKey = path.posix.join(
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
      crypto.randomUUID(),
    );
    const target = path.join(this.s.config.uploadsDir, storageKey);
    fs.mkdirSync(path.dirname(target), { recursive: true });

    const hash = crypto.createHash('sha256');
    let size = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        size += chunk.length;
        if (size > maxBytes) {
          cb(tooLarge(`Die Datei überschreitet die maximale Größe von ${settings.maxUploadMb} MB`));
          return;
        }
        hash.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(file.stream, meter, fs.createWriteStream(target));
      if ((file.stream as Readable & { truncated?: boolean }).truncated) {
        throw tooLarge(`Die Datei überschreitet die maximale Größe von ${settings.maxUploadMb} MB`);
      }
    } catch (err) {
      fs.rmSync(target, { force: true });
      throw err;
    }

    let mime = (file.mimetype || '').toLowerCase();
    if (!mime || mime === 'application/octet-stream') mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';

    const id = this.s.db.transaction(() => {
      const version =
        (this.s.db.value<number>('SELECT MAX(version) FROM attachments WHERE page_id = ? AND filename = ? COLLATE NOCASE', pageId, filename) ?? 0) + 1;
      // Frühere, gelöschte Versionen wieder sichtbar machen, wenn neu hochgeladen wird.
      this.s.db.run('UPDATE attachments SET deleted_at = NULL WHERE page_id = ? AND filename = ? COLLATE NOCASE', pageId, filename);
      return this.s.db.run(
        `INSERT INTO attachments (page_id, filename, version, mime_type, size, storage_key, sha256, comment, uploaded_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        pageId,
        filename,
        version,
        mime,
        size,
        storageKey,
        hash.digest('hex'),
        comment.slice(0, 500),
        user.id,
        nowIso(),
      ).lastInsertRowid;
    });
    const row = this.require(id);
    this.s.emit(auth, {
      type: 'attachment.uploaded',
      spaceId: space.id,
      pageId,
      target: { type: 'attachment', id, label: filename },
      data: { filename, version: row.version, size, mimeType: mime, pageTitle: page.title },
    });
    return this.toDto(row, this.s.users.refs([user.id]));
  }

  /** Anhang ausliefern (mit Rechteprüfung über die Seite). */
  async serve(auth: AuthContext, id: number, reply: FastifyReply, download: boolean): Promise<FastifyReply> {
    const row = this.require(id);
    const { page } = this.s.pages.requireViewable(auth, row.page_id, { includeDeleted: true });
    if (page.deleted_at) {
      const space = this.s.spaces.require(page.space_id);
      this.s.perms.requireSpace(auth, space, 'delete');
    }
    if (row.deleted_at && !page.deleted_at) this.s.pages.requireAccess(auth, row.page_id, 'attach');
    const file = path.join(this.s.config.uploadsDir, row.storage_key);
    if (!fs.existsSync(file)) throw notFound('Die Datei ist nicht mehr vorhanden');
    const size = fs.statSync(file).size;
    const inline = !download && INLINE_OK.test(row.mime_type) && !UNSAFE_INLINE.test(row.mime_type);
    const encoded = encodeURIComponent(row.filename);
    reply
      .header('Content-Type', row.mime_type)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, max-age=86400')
      // Ohne Bereichsauslieferung lässt sich in Video und Ton nicht springen; Safari spielt sie gar nicht ab.
      .header('Accept-Ranges', 'bytes')
      .header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox")
      .header('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${row.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encoded}`);

    const range = parseRange(reply.request.headers.range, size);
    if (range === 'invalid') {
      return reply.code(416).header('Content-Range', `bytes */${size}`).header('Content-Length', 0).send();
    }
    if (range) {
      return reply
        .code(206)
        .header('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
        .header('Content-Length', range.end - range.start + 1)
        .send(fs.createReadStream(file, { start: range.start, end: range.end }));
    }
    return reply.header('Content-Length', size).send(fs.createReadStream(file));
  }

  delete(auth: AuthContext, id: number): void {
    const row = this.require(id);
    const { page, space } = this.s.pages.requireAccess(auth, row.page_id, 'attach');
    const now = nowIso();
    this.s.db.run('UPDATE attachments SET deleted_at = ? WHERE page_id = ? AND filename = ? COLLATE NOCASE AND deleted_at IS NULL', now, row.page_id, row.filename);
    this.s.emit(auth, {
      type: 'attachment.deleted',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'attachment', id, label: row.filename },
      data: { filename: row.filename, pageTitle: page.title },
    });
  }

  restore(auth: AuthContext, id: number): void {
    const row = this.require(id);
    const { page, space } = this.s.pages.requireAccess(auth, row.page_id, 'attach');
    this.s.db.run('UPDATE attachments SET deleted_at = NULL WHERE page_id = ? AND filename = ? COLLATE NOCASE', row.page_id, row.filename);
    this.s.emit(auth, {
      type: 'attachment.restored',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'attachment', id, label: row.filename },
    });
  }

  /** Kopiert die aktuellen Versionen aller Anhänge (für „Seite kopieren“). */
  copyAll(sourcePageId: number, targetPageId: number, userId: number): void {
    const rows = this.s.db.all<AttachmentRow>(
      `SELECT a.* FROM attachments a WHERE a.page_id = ? AND a.deleted_at IS NULL
       AND a.version = (SELECT MAX(version) FROM attachments b WHERE b.page_id = a.page_id AND b.filename = a.filename)`,
      sourcePageId,
    );
    for (const r of rows) {
      const now = new Date();
      const key = path.posix.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), crypto.randomUUID());
      const src = path.join(this.s.config.uploadsDir, r.storage_key);
      const dst = path.join(this.s.config.uploadsDir, key);
      if (!fs.existsSync(src)) continue;
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      this.s.db.run(
        `INSERT INTO attachments (page_id, filename, version, mime_type, size, storage_key, sha256, comment, uploaded_by, created_at)
         VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        targetPageId,
        r.filename,
        r.mime_type,
        r.size,
        key,
        r.sha256,
        r.comment,
        userId,
        nowIso(),
      );
    }
  }

  /** Datei direkt aus einem Buffer anlegen (Import). */
  storeBuffer(pageId: number, filename: string, data: Uint8Array, userId: number | null): AttachmentRow {
    const clean = sanitizeFilename(filename);
    const ext = clean.includes('.') ? clean.split('.').pop()!.toLowerCase() : '';
    const now = new Date();
    const key = path.posix.join(String(now.getUTCFullYear()), String(now.getUTCMonth() + 1).padStart(2, '0'), crypto.randomUUID());
    const target = path.join(this.s.config.uploadsDir, key);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
    const version = (this.s.db.value<number>('SELECT MAX(version) FROM attachments WHERE page_id = ? AND filename = ? COLLATE NOCASE', pageId, clean) ?? 0) + 1;
    const id = this.s.db.run(
      `INSERT INTO attachments (page_id, filename, version, mime_type, size, storage_key, sha256, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      pageId,
      clean,
      version,
      MIME_BY_EXT[ext] ?? 'application/octet-stream',
      data.byteLength,
      key,
      crypto.createHash('sha256').update(data).digest('hex'),
      userId,
      nowIso(),
    ).lastInsertRowid;
    return this.require(id);
  }

  readFile(row: AttachmentRow): Buffer | null {
    const file = path.join(this.s.config.uploadsDir, row.storage_key);
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }

  /**
   * Dateien zum Entfernen vormerken statt sie sofort zu löschen. Wird eine Sicherung zurückgespielt,
   * die noch auf die Dateien verweist, bleiben sie so innerhalb der Karenzzeit erhalten.
   */
  scheduleFileRemoval(keys: string[]): void {
    if (!keys.length) return;
    const now = nowIso();
    this.s.db.transaction(() => {
      for (const key of new Set(keys)) {
        this.s.db.run('INSERT INTO file_deletions (storage_key, deleted_at) VALUES (?, ?) ON CONFLICT(storage_key) DO UPDATE SET deleted_at = excluded.deleted_at', key, now);
      }
    });
  }

  /**
   * Gelöschte Anhänge (alle Versionen einer Datei) nach Ablauf der Papierkorb-Frist endgültig entfernen –
   * bisher blieben sie unbegrenzt erhalten. Anhänge von Seiten im Papierkorb räumt dessen Bereinigung mit auf.
   */
  purgeExpiredDeleted(): number {
    const days = this.s.settings.get('trashRetentionDays');
    if (days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    const rows = this.s.db.all<{ id: number; storage_key: string }>(
      `SELECT a.id, a.storage_key FROM attachments a JOIN pages p ON p.id = a.page_id
        WHERE a.deleted_at IS NOT NULL AND a.deleted_at < ? AND p.deleted_at IS NULL`,
      cutoff,
    );
    if (!rows.length) return 0;
    this.s.db.transaction(() => {
      for (let i = 0; i < rows.length; i += 500) {
        const ids = rows.slice(i, i + 500).map((r) => r.id);
        const ph = Db.placeholders(ids.length);
        this.s.db.run(`DELETE FROM attachments_fts WHERE rowid IN ${ph}`, ...ids);
        this.s.db.run(`DELETE FROM attachments WHERE id IN ${ph}`, ...ids);
      }
    });
    this.scheduleFileRemoval(rows.map((r) => r.storage_key));
    return rows.length;
  }

  /** Vorgemerkte Dateien nach der Karenzzeit löschen – nur wenn kein Anhang mehr auf sie verweist. */
  purgeRemovedFiles(graceDays = FILE_GRACE_DAYS): { removed: number; kept: number } {
    const cutoff = new Date(Date.now() - graceDays * 86400_000).toISOString();
    const due = this.s.db.all<{ storage_key: string }>('SELECT storage_key FROM file_deletions WHERE deleted_at < ?', cutoff);
    let removed = 0;
    let kept = 0;
    for (const { storage_key: key } of due) {
      if (this.s.db.value('SELECT 1 FROM attachments WHERE storage_key = ?', key)) {
        kept++; // wieder in Gebrauch (z. B. nach dem Zurückspielen einer Sicherung)
      } else {
        const file = path.resolve(this.s.config.uploadsDir, key);
        if (file.startsWith(path.resolve(this.s.config.uploadsDir) + path.sep)) fs.rmSync(file, { force: true });
        removed++;
      }
      this.s.db.run('DELETE FROM file_deletions WHERE storage_key = ?', key);
    }
    return { removed, kept };
  }

  totalSize(): number {
    return this.s.db.value<number>('SELECT COALESCE(SUM(size), 0) FROM attachments') ?? 0;
  }
}

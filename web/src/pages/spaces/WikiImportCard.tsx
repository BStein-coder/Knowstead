import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { BookDown, CheckCircle2, Upload } from 'lucide-react';
import { api, uploadWithProgress } from '../../api/client';
import type { Space } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Alert, Button, Card, Checkbox, Field, Select } from '../../components/ui';
import { PagePicker } from '../../components/Pickers';

type Format = 'auto' | 'mediawiki' | 'dokuwiki' | 'xwiki' | 'confluence';

interface ImportReport {
  format: 'mediawiki' | 'dokuwiki' | 'xwiki' | 'confluence';
  pages: number;
  folders: number;
  attachments: number;
  revisions: number;
  unresolvedLinks: number;
  missingMedia: string[];
  unusedMedia: number;
  skipped: { title: string; reason: string }[];
  warnings: string[];
  root: { id: number; title: string; url: string }[];
}

interface ImportJob {
  id: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  phase: 'analyse' | 'pages' | 'media' | 'links' | 'done';
  done: number;
  total: number;
  report: ImportReport | null;
  error: string | null;
}

const ACCEPT: Record<Format, string> = {
  auto: '.xml,.zip,.xar',
  mediawiki: '.xml,.zip',
  dokuwiki: '.zip',
  xwiki: '.xar,.zip',
  confluence: '.zip',
};

/** Bereichseinstellungen → Daten: Seiten aus MediaWiki, DokuWiki oder XWiki übernehmen. */
export function WikiImportCard({ space }: { space: Space }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<Format>('auto');
  const [history, setHistory] = useState(false);
  const [parent, setParent] = useState<{ id: number; title: string } | null>(null);
  const [upload, setUpload] = useState<number | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const running = upload !== null || job?.state === 'queued' || job?.state === 'running';

  // Fortschritt abfragen, solange der Auftrag läuft
  useEffect(() => {
    if (!job || job.state === 'done' || job.state === 'failed') return;
    const timer = setTimeout(async () => {
      try {
        const next = await api.get<ImportJob>(`/api/v1/imports/${job.id}`);
        setJob(next);
        if (next.state === 'done') {
          void qc.invalidateQueries({ queryKey: ['tree', space.key] });
          toast.success(t('wikiImport.done', { n: next.report?.pages ?? 0 }));
        }
      } catch (err) {
        toast.error(err);
        setJob(null);
      }
    }, 900);
    return () => clearTimeout(timer);
  }, [job, qc, space.key, t, toast]);

  const start = async (file: File) => {
    const form = new FormData();
    form.append('format', format);
    form.append('history', String(history));
    if (parent) form.append('parentId', String(parent.id));
    form.append('file', file, file.name);
    setJob(null);
    setUpload(0);
    try {
      const created = await uploadWithProgress<ImportJob>(`/api/v1/spaces/${encodeURIComponent(space.key)}/import/wiki`, form, setUpload);
      setJob(created);
    } catch (err) {
      toast.error(err);
    } finally {
      setUpload(null);
    }
  };

  const percent = upload !== null ? upload : job && job.total ? Math.round((job.done / job.total) * 100) : 0;
  const report = job?.state === 'done' ? job.report : null;

  return (
    <Card title={t('wikiImport.title')}>
      <p className="muted mb-2">{t('wikiImport.help')}</p>
      <div className="form-grid">
        <Field label={t('wikiImport.format')} help={t(`wikiImport.hints.${format}`)}>
          <Select value={format} onChange={(e) => setFormat(e.target.value as Format)} disabled={running}>
            <option value="auto">{t('wikiImport.formats.auto')}</option>
            <option value="mediawiki">MediaWiki</option>
            <option value="dokuwiki">DokuWiki</option>
            <option value="xwiki">XWiki</option>
            <option value="confluence">Confluence</option>
          </Select>
        </Field>
        <Field label={t('spaceSettings.importTarget')} help={!parent ? t('newPage.topLevel') : undefined}>
          <PagePicker value={parent} spaceKey={space.key} onChange={(p) => setParent(p ? { id: p.id, title: p.title } : null)} />
        </Field>
      </div>
      <div className="mt-2">
        <Checkbox checked={history} onChange={setHistory} disabled={running || format === 'xwiki'} label={t('wikiImport.history')} />
      </div>
      <div className="row gap-sm mt-3" style={{ flexWrap: 'wrap' }}>
        <Button icon={Upload} variant="primary" loading={running} onClick={() => input.current?.click()}>
          {t('wikiImport.start')}
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          accept={ACCEPT[format]}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void start(file);
          }}
        />
      </div>

      {running && (
        <div className="wiki-import-progress mt-3" aria-live="polite">
          <div className="row gap-sm small muted">
            <BookDown size={14} />
            <span>{upload !== null ? t('wikiImport.uploading', { n: upload }) : t(`wikiImport.phases.${job?.phase ?? 'analyse'}`)}</span>
            {upload === null && job && job.total > 0 && job.phase !== 'analyse' && (
              <span className="spacer small">
                {job.done} / {job.total}
              </span>
            )}
          </div>
          <div className="progress mt-1">
            <div style={{ width: `${Math.max(3, percent)}%` }} />
          </div>
        </div>
      )}

      {job?.state === 'failed' && (
        <div className="mt-3">
          <Alert variant="error" title={t('wikiImport.failed')}>
            {job.error}
          </Alert>
        </div>
      )}

      {report && (
        <div className="mt-3 col gap-sm">
          <Alert variant="success" title={t('wikiImport.summary', { pages: report.pages, folders: report.folders })}>
            {t('wikiImport.details', { attachments: report.attachments, revisions: report.revisions })}
            {report.root.length > 0 && (
              <div className="wiki-import-roots">
                {report.root.slice(0, 8).map((r) => (
                  <Link key={r.id} to={r.url} className="chip">
                    <CheckCircle2 size={12} /> {r.title}
                  </Link>
                ))}
              </div>
            )}
          </Alert>
          {(report.unresolvedLinks > 0 || report.missingMedia.length > 0 || report.skipped.length > 0 || report.warnings.length > 0 || report.unusedMedia > 0) && (
            <details className="wiki-import-notes">
              <summary>{t('wikiImport.notes')}</summary>
              <ul>
                {report.unresolvedLinks > 0 && <li>{t('wikiImport.unresolved', { n: report.unresolvedLinks })}</li>}
                {report.unusedMedia > 0 && <li>{t('wikiImport.unused', { n: report.unusedMedia })}</li>}
                {report.missingMedia.length > 0 && <li>{t('wikiImport.missing', { list: report.missingMedia.slice(0, 20).join(', ') })}</li>}
                {report.skipped.slice(0, 30).map((s) => (
                  <li key={`s-${s.title}`}>
                    {s.title}: {s.reason}
                  </li>
                ))}
                {report.warnings.slice(0, 30).map((w) => (
                  <li key={`w-${w}`}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

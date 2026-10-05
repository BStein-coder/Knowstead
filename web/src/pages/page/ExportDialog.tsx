import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Code2, Download, FileText, FileType, Globe, type LucideIcon } from 'lucide-react';
import { api, saveFile } from '../../api/client';
import type { Page } from '../../api/types';
import { useI18n } from '../../i18n';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { Button, Checkbox, Modal, Switch, cx } from '../../components/ui';

type Format = 'pdf' | 'docx' | 'md' | 'html';

interface TemplateDefaults {
  company: string;
  coverPage: boolean;
  toc: boolean;
  hasLogo: boolean;
}

const FORMATS: { id: Format; icon: LucideIcon }[] = [
  { id: 'pdf', icon: FileText },
  { id: 'docx', icon: FileType },
  { id: 'md', icon: Code2 },
  { id: 'html', icon: Globe },
];

/** Seite exportieren: PDF/Word mit Firmenvorlage oder Markdown/HTML – optional mit Unterseiten. */
export function ExportDialog({ page, open, onClose }: { page: Page; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const defaults = useQuery({ queryKey: ['export-template-defaults'], queryFn: () => api.get<TemplateDefaults>('/api/v1/export/template'), staleTime: 60_000 });
  const [format, setFormat] = useState<Format>('pdf');
  const [children, setChildren] = useState(false);
  const [cover, setCover] = useState(true);
  const [toc, setToc] = useState(true);
  const [busy, setBusy] = useState(false);
  const hasChildren = page.childCount > 0 || page.isHome;
  const isDocument = format === 'pdf' || format === 'docx';

  useEffect(() => {
    if (!defaults.data) return;
    setCover(defaults.data.coverPage);
    setToc(defaults.data.toc);
  }, [defaults.data]);

  const run = async () => {
    setBusy(true);
    try {
      if (isDocument) {
        await saveFile('GET', `/api/v1/pages/${page.id}/export/document`, { query: { format, children: hasChildren && children, cover, toc } });
      } else if (hasChildren && children) {
        // Seitenbaum als ZIP; die Startseite steht für den ganzen Bereich
        await saveFile('GET', `/api/v1/spaces/${encodeURIComponent(page.space.key)}/export`, {
          query: { format: format === 'md' ? 'markdown' : 'html', root: page.isHome ? undefined : page.id },
        });
      } else {
        await saveFile('GET', `/api/v1/pages/${page.id}/export`, { query: { format } });
      }
      toast.success(t('exportDialog.done'));
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={t('exportDialog.title')}
      icon={Download}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon={Download} loading={busy} onClick={() => void run()}>
            {busy && isDocument ? t('exportDialog.working') : t('exportDialog.start')}
          </Button>
        </>
      }
    >
      <div className="export-formats" role="radiogroup" aria-label={t('exportDialog.format')}>
        {FORMATS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={format === f.id}
            className={cx('export-format', format === f.id && 'active')}
            onClick={() => setFormat(f.id)}
          >
            <f.icon size={20} />
            <span className="export-format-title">{t(`exportDialog.formats.${f.id}`)}</span>
            <span className="export-format-text">{t(`exportDialog.formatHints.${f.id}`)}</span>
          </button>
        ))}
      </div>

      <div className="col gap-sm mt-3">
        {hasChildren && (
          <Checkbox
            checked={children}
            onChange={setChildren}
            label={page.isHome ? t('exportDialog.wholeSpace', { space: page.space.name }) : t('exportDialog.children', { n: page.childCount })}
          />
        )}
        {isDocument && (
          <>
            <Switch checked={cover} onChange={setCover} label={t('exportDialog.cover')} description={t('exportDialog.coverHelp')} />
            <Switch checked={toc} onChange={setToc} label={t('exportDialog.toc')} description={t('exportDialog.tocHelp')} />
          </>
        )}
      </div>

      {isDocument && (
        <p className="small muted mt-3">
          {defaults.data?.company ? t('exportDialog.templateOf', { company: defaults.data.company }) : t('exportDialog.templateDefault')}{' '}
          {isAdmin && (
            <Link to="/admin/export" onClick={onClose}>
              {t('exportDialog.editTemplate')}
            </Link>
          )}
        </p>
      )}
    </Modal>
  );
}

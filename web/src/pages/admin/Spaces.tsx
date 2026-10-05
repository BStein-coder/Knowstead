import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, FolderOpen, FolderTree, Plus, Settings, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { api } from '../../api/client';
import type { Space, SpaceCategory } from '../../api/types';
import { useSpaceCategories } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Badge, Button, Card, EmptyState, Field, IconButton, Input, Loading, Modal, PageHeader, Time } from '../../components/ui';
import { EmojiPicker } from '../../components/Pickers';
import { CategorySelect } from '../../components/CategorySelect';

export function AdminSpaces() {
  const { t } = useI18n();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['admin-spaces'], queryFn: () => api.get<Space[]>('/api/v1/admin/spaces') });
  const [importing, setImporting] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const setCategory = async (space: Space, category: string) => {
    try {
      await api.patch(`/api/v1/spaces/${encodeURIComponent(space.key)}`, { category });
      toast.success(t('common.changesSaved'));
      void refetch();
      void qc.invalidateQueries({ queryKey: ['spaces'] });
      void qc.invalidateQueries({ queryKey: ['space-categories'] });
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <>
      <PageHeader
        icon={FolderOpen}
        title={t('admin.nav.spaces')}
        subtitle={t('adminSpaces.subtitle')}
        actions={
          <Button icon={Upload} onClick={() => setImporting(true)}>
            {t('adminSpaces.importArchive')}
          </Button>
        }
      />
      <CategoryManager />
      {isLoading ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.space')}</th>
                <th>{t('adminSpaces.type')}</th>
                <th>{t('spaces.category')}</th>
                <th>{t('common.pages')}</th>
                <th>{t('adminSpaces.lastActive')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((s) => (
                <tr key={s.key}>
                  <td>
                    <Link to={`/s/${encodeURIComponent(s.key)}`} className="strong">
                      {s.icon} {s.name}
                    </Link>
                    <div className="small muted mono">{s.key}</div>
                  </td>
                  <td>
                    {s.kind === 'personal' ? <Badge>{t('spaces.personal')}</Badge> : <Badge color="blue">{t('adminSpaces.team')}</Badge>} {s.archivedAt && <Badge color="yellow">{t('spaces.archived')}</Badge>}
                  </td>
                  <td style={{ minWidth: 180 }}>{s.kind === 'team' ? <CategorySelect value={s.category ?? ''} aria-label={t('adminSpaces.categoryOf', { name: s.name })} onChange={(c) => void setCategory(s, c)} /> : <span className="muted">–</span>}</td>
                  <td>{s.pageCount}</td>
                  <td className="small muted">
                    <Time value={s.lastActivityAt} />
                  </td>
                  <td className="actions-cell">
                    <Link className="btn btn-sm btn-ghost" to={`/s/${encodeURIComponent(s.key)}/settings`}>
                      <Settings size={14} /> {t('common.settings')}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {importing && <ImportArchiveDialog onClose={() => setImporting(false)} onDone={() => void refetch()} />}
    </>
  );
}

/** Kategorien der Bereiche: anlegen, umbenennen, sortieren, entfernen. */
function CategoryManager() {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const { data: categories = [], isLoading } = useSpaceCategories();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['space-categories'] });
    void qc.invalidateQueries({ queryKey: ['spaces'] });
    void qc.invalidateQueries({ queryKey: ['admin-spaces'] });
  };
  const run = async (fn: () => Promise<unknown>, success?: string) => {
    try {
      await fn();
      if (success) toast.success(success);
      refresh();
    } catch (err) {
      toast.error(err);
    }
  };
  const move = (index: number, delta: number) => {
    const ids = categories.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id);
    void run(() => api.put('/api/v1/admin/space-categories/order', { ids }));
  };
  const rename = async (c: SpaceCategory) => {
    const next = await dialogs.prompt({ title: t('adminSpaces.renameCategory'), label: t('common.name'), defaultValue: c.name });
    if (next && next.trim() && next.trim() !== c.name) {
      await run(() => api.patch(`/api/v1/admin/space-categories/${c.id}`, { name: next.trim() }), t('common.changesSaved'));
    }
  };
  const remove = async (c: SpaceCategory) => {
    const ok = await dialogs.confirm({
      title: t('adminSpaces.removeTitle', { name: c.name }),
      message: c.spaceCount
        ? t(c.spaceCount === 1 ? 'adminSpaces.removeOne' : 'adminSpaces.removeMany', { n: c.spaceCount, other: t('spaces.otherCategory') })
        : t('adminSpaces.removeEmpty'),
      danger: true,
      confirmLabel: t('adminSpaces.remove'),
    });
    if (ok) await run(() => api.del(`/api/v1/admin/space-categories/${c.id}`), t('adminSpaces.removed'));
  };

  return (
    <Card
      className="mb-2"
      title={
        <>
          <FolderTree size={15} /> {t('adminSpaces.categories')}
        </>
      }
    >
      <p className="small muted mb-2">{t('adminSpaces.categoriesIntro', { other: t('spaces.otherCategory') })}</p>
      {isLoading ? (
        <Loading inline />
      ) : categories.length === 0 ? (
        <EmptyState compact icon={FolderTree} title={t('adminSpaces.noCategories')} text={t('adminSpaces.noCategoriesText')} />
      ) : (
        <ul className="category-list">
          {categories.map((c, i) => (
            <li key={c.id} className="category-row">
              <EmojiPicker
                value={c.icon}
                onChange={(icon) => void run(() => api.patch(`/api/v1/admin/space-categories/${c.id}`, { icon }))}
                trigger={(open, ref) => (
                  <button ref={ref} type="button" className="category-icon" onClick={open} title={t('adminSpaces.changeIcon')}>
                    {c.icon ?? '📁'}
                  </button>
                )}
              />
              <button type="button" className="category-name" onClick={() => void rename(c)} title={t('adminSpaces.rename')}>
                {c.name}
              </button>
              <Badge color={c.spaceCount ? 'blue' : 'gray'}>{t(c.spaceCount === 1 ? 'adminSpaces.oneSpace' : 'adminSpaces.spaces', { n: c.spaceCount })}</Badge>
              <span className="spacer" />
              <IconButton icon={ArrowUp} label={t('adminSpaces.up')} disabled={i === 0} onClick={() => move(i, -1)} />
              <IconButton icon={ArrowDown} label={t('adminSpaces.down')} disabled={i === categories.length - 1} onClick={() => move(i, 1)} />
              <IconButton icon={Trash2} label={t('adminSpaces.remove')} onClick={() => void remove(c)} />
            </li>
          ))}
        </ul>
      )}
      <form
        className="row gap-sm mt-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          setBusy(true);
          await run(() => api.post('/api/v1/admin/space-categories', { name: name.trim() }), t('adminSpaces.created'));
          setName('');
          setBusy(false);
        }}
      >
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('spaces.categoryPlaceholder')} style={{ maxWidth: 280 }} maxLength={60} />
        <Button type="submit" icon={Plus} loading={busy} disabled={!name.trim()}>
          {t('spaces.newCategory')}
        </Button>
      </form>
    </Card>
  );
}

function ImportArchiveDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={t('adminSpaces.importTitle')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!file || key.length < 2}
            onClick={async () => {
              if (!file) return;
              const form = new FormData();
              form.append('key', key);
              form.append('name', name);
              form.append('file', file, file.name);
              setBusy(true);
              try {
                const res = await api.upload<{ pages: number }>('/api/v1/spaces/import-archive', form);
                toast.success(t('spaceSettings.importDone', { n: res.pages }));
                onDone();
                onClose();
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('adminSpaces.import')}
          </Button>
        </>
      }
    >
      <p className="muted mb-2">{t('adminSpaces.importText')}</p>
      <Field label={t('spaces.key')} required>
        <Input className="mono" value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))} />
      </Field>
      <Field label={`${t('common.name')} (${t('common.optional')})`}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('adminSpaces.archive')}>
        <div className="row">
          <Button icon={Upload} onClick={() => input.current?.click()}>
            {t('adminSpaces.chooseFile')}
          </Button>
          <span className="small muted">{file?.name}</span>
        </div>
        <input ref={input} type="file" accept=".zip" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
    </Modal>
  );
}

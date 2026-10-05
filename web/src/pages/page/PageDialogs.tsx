import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, FolderInput, Info, Lock, Network, Save, Users, X } from 'lucide-react';
import { api } from '../../api/client';
import type { Page, PageSummary, Subject } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Alert, Avatar, Button, Checkbox, Field, Input, Loading, Modal, Select, Tabs, Textarea, Time } from '../../components/ui';
import { PagePicker, SpaceSelect, SubjectPicker } from '../../components/Pickers';
import { LinkMap } from './LinkMap';

/* ------------------------------ Einschränkungen ------------------------------ */

interface RestrictionData {
  view: (Subject & { label: string; detail: string })[];
  edit: (Subject & { label: string; detail: string })[];
  inherited: { pageId: number; title: string; url: string; subjects: (Subject & { label: string })[] }[];
  canEdit: boolean;
}

function SubjectList({ items, onRemove, disabled }: { items: (Subject & { label?: string; detail?: string })[]; onRemove: (s: Subject) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="subject-list">
      {items.map((s) => (
        <div key={`${s.type}:${s.id}`} className="subject-row">
          {s.type === 'group' ? (
            <span className="group-icon">
              <Users size={14} />
            </span>
          ) : (
            <Avatar user={{ displayName: s.label ?? '?' }} size={28} />
          )}
          <span className="grow">
            <div>{s.label}</div>
            <div className="tiny muted">{s.type === 'group' ? t('common.group') : s.detail}</div>
          </span>
          {!disabled && (
            <button type="button" className="icon-btn" onClick={() => onRemove(s)} aria-label={t('common.remove')}>
              <X size={14} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function RestrictionsDialog({ page, open, onClose }: { page: Page; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['restrictions', page.id],
    queryFn: () => api.get<RestrictionData>(`/api/v1/pages/${page.id}/restrictions`),
    enabled: open,
  });
  const [view, setView] = useState<RestrictionData['view']>([]);
  const [edit, setEdit] = useState<RestrictionData['edit']>([]);
  const [viewMode, setViewMode] = useState<'all' | 'some'>('all');
  const [editMode, setEditMode] = useState<'all' | 'some'>('all');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!data) return;
    setView(data.view);
    setEdit(data.edit);
    setViewMode(data.view.length ? 'some' : 'all');
    setEditMode(data.edit.length ? 'some' : 'all');
  }, [data]);

  const save = async () => {
    setBusy(true);
    try {
      await api.put(`/api/v1/pages/${page.id}/restrictions`, {
        view: viewMode === 'some' ? view.map(({ type, id }) => ({ type, id })) : [],
        edit: editMode === 'some' ? edit.map(({ type, id }) => ({ type, id })) : [],
      });
      toast.success(t('restrictions.saved'));
      await qc.invalidateQueries({ queryKey: ['page', page.id] });
      await qc.invalidateQueries({ queryKey: ['restrictions', page.id] });
      void qc.invalidateQueries({ queryKey: ['tree', page.space.key] });
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const disabled = !data?.canEdit;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('restrictions.title')}
      icon={Lock}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          {!disabled && (
            <Button variant="primary" loading={busy} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          )}
        </>
      }
    >
      {isLoading || !data ? (
        <Loading />
      ) : (
        <div className="col gap-lg">
          <p className="muted">{t('restrictions.intro')}</p>
          {data.inherited.length > 0 && (
            <Alert variant="warning" title={t('restrictions.inheritedInfo')}>
              {data.inherited.map((i) => (
                <div key={i.pageId}>
                  {t('restrictions.inherited', { title: i.title })}: {i.subjects.map((s) => s.label).join(', ')}
                </div>
              ))}
            </Alert>
          )}
          <div>
            <h4 className="mb-1">{t('restrictions.view')}</h4>
            <div className="col gap-sm">
              <label className="checkbox-row">
                <input type="radio" disabled={disabled} checked={viewMode === 'all'} onChange={() => setViewMode('all')} />
                <span>{t('restrictions.everyoneView')}</span>
              </label>
              <label className="checkbox-row">
                <input type="radio" disabled={disabled} checked={viewMode === 'some'} onChange={() => setViewMode('some')} />
                <span>{t('restrictions.onlyThese')}</span>
              </label>
              {viewMode === 'some' && (
                <div className="col" style={{ marginLeft: '1.6rem' }}>
                  <SubjectList items={view} disabled={disabled} onRemove={(s) => setView(view.filter((x) => !(x.type === s.type && x.id === s.id)))} />
                  {!disabled && <SubjectPicker exclude={view} onPick={(s) => setView([...view, { type: s.type, id: s.id, label: s.label, detail: s.detail ?? '' }])} />}
                </div>
              )}
            </div>
          </div>
          <div>
            <h4 className="mb-1">{t('restrictions.edit')}</h4>
            <div className="col gap-sm">
              <label className="checkbox-row">
                <input type="radio" disabled={disabled} checked={editMode === 'all'} onChange={() => setEditMode('all')} />
                <span>{t('restrictions.everyoneEdit')}</span>
              </label>
              <label className="checkbox-row">
                <input type="radio" disabled={disabled} checked={editMode === 'some'} onChange={() => setEditMode('some')} />
                <span>{t('restrictions.onlyThese')}</span>
              </label>
              {editMode === 'some' && (
                <div className="col" style={{ marginLeft: '1.6rem' }}>
                  <SubjectList items={edit} disabled={disabled} onRemove={(s) => setEdit(edit.filter((x) => !(x.type === s.type && x.id === s.id)))} />
                  {!disabled && <SubjectPicker exclude={edit} onPick={(s) => setEdit([...edit, { type: s.type, id: s.id, label: s.label, detail: s.detail ?? '' }])} />}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ Verschieben / Kopieren ------------------------------ */

export function MoveCopyDialog({ page, mode, open, onClose }: { page: Page; mode: 'move' | 'copy'; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [spaceKey, setSpaceKey] = useState(page.space.key);
  const [parent, setParent] = useState<{ id: number; title: string } | null>(page.ancestors.length ? page.ancestors[page.ancestors.length - 1] : null);
  const [title, setTitle] = useState(`Kopie von ${page.title}`);
  const [includeChildren, setIncludeChildren] = useState(false);
  const [includeAttachments, setIncludeAttachments] = useState(true);
  const [includeLabels, setIncludeLabels] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setSpaceKey(page.space.key);
      setParent(page.ancestors.length ? page.ancestors[page.ancestors.length - 1] : null);
      setTitle(`Kopie von ${page.title}`);
    }
  }, [open, page]);

  const submit = async () => {
    setBusy(true);
    try {
      if (mode === 'move') {
        const res = await api.post<{ url: string }>(`/api/v1/pages/${page.id}/move`, { parentId: parent?.id ?? null, spaceKey });
        toast.success(t('move.moved'));
        await qc.invalidateQueries({ queryKey: ['tree'] });
        void qc.invalidateQueries({ queryKey: ['page', page.id] });
        onClose();
        navigate(res.url);
      } else {
        const res = await api.post<{ url: string }>(`/api/v1/pages/${page.id}/copy`, {
          parentId: parent?.id ?? null,
          spaceKey,
          title,
          includeChildren,
          includeAttachments,
          includeLabels,
        });
        toast.success(t('move.copied'));
        await qc.invalidateQueries({ queryKey: ['tree'] });
        onClose();
        navigate(res.url);
      }
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'move' ? t('move.title') : t('move.copyTitle')}
      icon={mode === 'move' ? FolderInput : Copy}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {mode === 'move' ? t('page.move') : t('page.copy')}
          </Button>
        </>
      }
    >
      {mode === 'copy' && (
        <Field label={t('move.newTitle')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
      )}
      <Field label={t('move.targetSpace')}>
        <SpaceSelect
          value={spaceKey}
          onlyCreatable
          onChange={(k) => {
            setSpaceKey(k);
            setParent(null);
          }}
        />
      </Field>
      <Field label={t('move.targetParent')} help={parent ? undefined : t('newPage.topLevel')}>
        <PagePicker value={parent} spaceKey={spaceKey} excludeId={page.id} onChange={(p: PageSummary | null) => setParent(p ? { id: p.id, title: p.title } : null)} />
      </Field>
      {mode === 'copy' && (
        <div className="col gap-sm">
          <Checkbox checked={includeChildren} onChange={setIncludeChildren} label={t('move.includeChildren')} />
          <Checkbox checked={includeAttachments} onChange={setIncludeAttachments} label={t('move.includeAttachments')} />
          <Checkbox checked={includeLabels} onChange={setIncludeLabels} label={t('move.includeLabels')} />
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------ Als Vorlage speichern ------------------------------ */

export function SaveTemplateDialog({ page, open, onClose }: { page: Page; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(page.title);
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<'space' | 'global'>('space');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('templates.saveTitle')}
      icon={Save}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post(`/api/v1/pages/${page.id}/save-as-template`, { name, description, scope });
                toast.success(t('templates.savedAsTemplate'));
                void qc.invalidateQueries({ queryKey: ['templates'] });
                onClose();
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('common.name')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={t('common.description')}>
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={t('templates.scope')}>
        <Select value={scope} onChange={(e) => setScope(e.target.value as 'space' | 'global')}>
          <option value="space">{t('templates.scopeSpace')}</option>
          <option value="global">{t('templates.scopeGlobal')}</option>
        </Select>
      </Field>
    </Modal>
  );
}

/* ------------------------------ Seiteninformationen ------------------------------ */

export function PageInfoDialog({ page, open, onClose }: { page: Page; open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'info' | 'map'>('info');
  const outgoing = useQuery({ queryKey: ['links', page.id], queryFn: () => api.get<PageSummary[]>(`/api/v1/pages/${page.id}/links`), enabled: open });
  const backlinks = useQuery({ queryKey: ['backlinks', page.id], queryFn: () => api.get<PageSummary[]>(`/api/v1/pages/${page.id}/backlinks`), enabled: open });
  return (
    <Modal open={open} onClose={onClose} title={page.title} icon={Info} size="lg">
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'info', label: t('page.info'), icon: Info },
          { value: 'map', label: t('page.linkMap'), icon: Network },
        ]}
      />
      {tab === 'info' ? (
        <div className="col gap-lg">
          <dl className="kv">
            <dt>ID</dt>
            <dd className="mono">{page.id}</dd>
            <dt>{t('common.space')}</dt>
            <dd>
              {page.space.name} ({page.space.key})
            </dd>
            <dt>{t('common.type')}</dt>
            <dd>{t(`page.pageTypes.${page.contentType}`)}</dd>
            <dt>{t('common.version')}</dt>
            <dd>{page.version}</dd>
            <dt>{t('page.createdBy', { user: '' }).replace(/\s+$/, '')}</dt>
            <dd>
              {page.createdBy?.displayName} · <Time value={page.createdAt} mode="datetime" />
            </dd>
            <dt>{t('history.changeTypes.edit')}</dt>
            <dd>
              {page.updatedBy?.displayName} · <Time value={page.updatedAt} mode="datetime" />
            </dd>
            <dt>{t('page.views', { n: '' }).trim()}</dt>
            <dd>{page.viewCount}</dd>
            <dt>{t('page.comments')}</dt>
            <dd>{page.commentCount}</dd>
            <dt>{t('page.attachments')}</dt>
            <dd>{page.attachmentCount}</dd>
            <dt>API</dt>
            <dd className="mono small">GET /api/v1/pages/{page.id}</dd>
          </dl>
          <div className="form-grid">
            <div>
              <h4 className="mb-1">{t('page.outgoing')}</h4>
              {(outgoing.data ?? []).map((p) => (
                <div key={p.id} className="small">
                  <a href={p.url}>{p.title}</a>
                </div>
              ))}
              {outgoing.data?.length === 0 && <div className="small muted">{t('common.none')}</div>}
            </div>
            <div>
              <h4 className="mb-1">{t('page.backlinks')}</h4>
              {(backlinks.data ?? []).map((p) => (
                <div key={p.id} className="small">
                  <a href={p.url}>{p.title}</a>
                </div>
              ))}
              {backlinks.data?.length === 0 && <div className="small muted">{t('common.none')}</div>}
            </div>
          </div>
        </div>
      ) : (
        <LinkMap pageId={page.id} />
      )}
    </Modal>
  );
}

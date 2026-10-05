import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeftRight,
  Download,
  FileIcon,
  FileText,
  Link2,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Sliders,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api, uploadWithProgress } from '../../api/client';
import type { Attachment, Page, PageSummary, Property } from '../../api/types';
import { useAttachments } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Button, Checkbox, EmptyState, IconButton, Input, Loading, Select, Time, cx } from '../../components/ui';
import { TagInput } from '../../components/Pickers';
import { PropertyValue } from '../../editor/views/MacroViews';

/* ------------------------------ Stichwörter ------------------------------ */

export function LabelsBar({ page }: { page: Page }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>(page.labels);
  const suggestions = useQuery({
    queryKey: ['labels', page.space.key],
    queryFn: () => api.get<{ name: string; count: number }[]>('/api/v1/labels', { space: page.space.key }),
    enabled: editing,
  });

  const save = async () => {
    try {
      await api.put(`/api/v1/pages/${page.id}/labels`, { labels: draft });
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ['page', page.id] });
    } catch (err) {
      toast.error(err);
    }
  };

  if (editing) {
    return (
      <div className="page-labels" style={{ alignItems: 'stretch' }}>
        <div className="grow">
          <TagInput value={draft} onChange={setDraft} placeholder={t('page.addLabel')} suggestions={(suggestions.data ?? []).map((l) => l.name)} />
        </div>
        <Button size="sm" variant="primary" onClick={() => void save()}>
          {t('common.save')}
        </Button>
        <Button size="sm" onClick={() => setEditing(false)}>
          {t('common.cancel')}
        </Button>
      </div>
    );
  }
  if (!page.labels.length && !page.access.edit) return null;
  return (
    <div className="page-labels">
      <Tag size={14} className="faint" />
      {page.labels.map((l) => (
        <Link key={l} to={`/search?q=${encodeURIComponent(`label:${l}`)}`} className="chip">
          {l}
        </Link>
      ))}
      {page.access.edit && (
        <button
          type="button"
          className="chip"
          style={{ cursor: 'pointer', border: 'none' }}
          aria-label={page.labels.length ? t('page.editLabels') : undefined}
          title={page.labels.length ? t('page.editLabels') : undefined}
          onClick={() => {
            setDraft(page.labels);
            setEditing(true);
          }}
        >
          {page.labels.length ? <Pencil size={11} /> : <Plus size={12} />}
          {page.labels.length ? '' : t('page.addLabel')}
        </button>
      )}
    </div>
  );
}

/* ------------------------------ Eigenschaften ------------------------------ */

const PROPERTY_TYPES = ['text', 'number', 'date', 'url', 'status', 'boolean'];

export function PropertiesPanel({ page }: { page: Page }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Property[]>(page.properties);

  if (!page.properties.length && !editing) {
    if (!page.access.edit) return null;
  }

  const save = async () => {
    try {
      await api.put(`/api/v1/pages/${page.id}/properties`, { properties: draft.filter((p) => p.name.trim()) });
      setEditing(false);
      await qc.invalidateQueries({ queryKey: ['page', page.id] });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <section className="panel">
      <h2 className="panel-title">
        <Sliders size={17} />
        {t('page.properties')}
        <span className="spacer" />
        {page.access.edit && !editing && (
          <Button
            size="sm"
            variant="ghost"
            icon={page.properties.length ? Pencil : Plus}
            onClick={() => {
              setDraft(page.properties.length ? page.properties : [{ name: '', value: '', type: 'text' }]);
              setEditing(true);
            }}
          >
            {page.properties.length ? t('common.edit') : t('page.addProperty')}
          </Button>
        )}
      </h2>
      {editing ? (
        <div className="col">
          {draft.map((p, i) => (
            <div key={i} className="row">
              <Input className="input-sm" style={{ maxWidth: 200 }} value={p.name} placeholder={t('page.propertyName')} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Select className="input-sm" style={{ maxWidth: 120 }} value={p.type} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))}>
                {PROPERTY_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}
                  </option>
                ))}
              </Select>
              <Input
                className="input-sm grow"
                type={p.type === 'date' ? 'date' : p.type === 'number' ? 'number' : 'text'}
                value={p.value}
                placeholder={t('page.propertyValue')}
                onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
              />
              <IconButton icon={X} label={t('common.remove')} onClick={() => setDraft(draft.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div className="row">
            <Button size="sm" icon={Plus} onClick={() => setDraft([...draft, { name: '', value: '', type: 'text' }])}>
              {t('page.addProperty')}
            </Button>
            <span className="spacer" />
            <Button size="sm" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      ) : page.properties.length ? (
        <table className="props-table">
          <tbody>
            {page.properties.map((p) => (
              <tr key={p.name}>
                <td>
                  <Link to={`/search?q=${encodeURIComponent(`#${p.name.replace(/\s+/g, '_')}`)}`} className="muted">
                    {p.name}
                  </Link>
                </td>
                <td>
                  <PropertyValue value={p.value} type={p.type} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="small muted">{t('page.noProperties')}</div>
      )}
    </section>
  );
}

/* ------------------------------ Anhänge ------------------------------ */

function AttachmentCard({ a, page, onChanged }: { a: Attachment; page: Page; onChanged: () => void }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const [showVersions, setShowVersions] = useState(false);
  return (
    <div className={cx('attachment-card', a.deletedAt && 'deleted')}>
      <a className="attachment-thumb" href={a.url} target="_blank" rel="noopener noreferrer" aria-label={a.filename} tabIndex={-1}>
        {a.isImage ? <img src={a.url} alt={a.filename} loading="lazy" /> : <FileIcon size={20} />}
      </a>
      <div className="grow" style={{ minWidth: 0 }}>
        <a href={a.url} target="_blank" rel="noopener noreferrer" className="truncate strong" style={{ display: 'block' }} title={a.filename}>
          {a.filename}
        </a>
        <div className="tiny muted truncate">
          {fmt.bytes(a.size)} · v{a.version} · {a.uploadedBy?.displayName} · <Time value={a.createdAt} />
        </div>
        {a.versions && a.versions.length > 0 && (
          <button type="button" className="tiny" style={{ border: 'none', background: 'none', padding: 0, color: 'var(--text-link)' }} onClick={() => setShowVersions((s) => !s)}>
            {t('attachments.versions', { n: a.versions.length })}
          </button>
        )}
        {showVersions && (
          <ul className="tiny" style={{ margin: '0.25rem 0 0', paddingLeft: '1rem' }}>
            {a.versions?.map((v) => (
              <li key={v.id}>
                <a href={v.downloadUrl}>v{v.version}</a> · {fmt.bytes(v.size)} · <Time value={v.createdAt} mode="date" />
              </li>
            ))}
          </ul>
        )}
      </div>
      <a className="icon-btn" href={a.downloadUrl} title={t('common.download')}>
        <Download size={15} />
      </a>
      {page.access.attach &&
        (a.deletedAt ? (
          <IconButton
            icon={RotateCcw}
            label={t('attachments.restore')}
            onClick={async () => {
              await api.post(`/api/v1/attachments/${a.id}/restore`);
              onChanged();
            }}
          />
        ) : (
          <IconButton
            icon={Trash2}
            label={t('common.delete')}
            onClick={async () => {
              if (!(await dialogs.confirm({ title: t('attachments.deleteConfirm', { name: a.filename }), danger: true, confirmLabel: t('common.delete') }))) return;
              try {
                await api.del(`/api/v1/attachments/${a.id}`);
                onChanged();
              } catch (err) {
                toast.error(err);
              }
            }}
          />
        ))}
    </div>
  );
}

export function AttachmentsPanel({ page }: { page: Page }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [showDeleted, setShowDeleted] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useAttachments(page.id, showDeleted);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['attachments', page.id] });
    void qc.invalidateQueries({ queryKey: ['page', page.id] });
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    const form = new FormData();
    for (const f of files) form.append('file', f, f.name);
    setProgress(0);
    try {
      await uploadWithProgress(`/api/v1/pages/${page.id}/attachments`, form, setProgress);
      toast.success(t('attachments.uploaded', { n: files.length }));
      refresh();
    } catch (err) {
      toast.error(err);
    } finally {
      setProgress(null);
    }
  };

  if (!page.access.attach && page.attachmentCount === 0) return null;

  return (
    <section className="panel" id="attachments">
      <h2 className="panel-title">
        <Paperclip size={17} />
        {t('attachments.title')}
        {page.attachmentCount > 0 && <span className="count">{page.attachmentCount}</span>}
        <span className="spacer" />
        {page.access.attach && <Checkbox checked={showDeleted} onChange={setShowDeleted} label={<span className="small muted">{t('attachments.showDeleted')}</span>} />}
      </h2>
      {isLoading ? (
        <Loading inline />
      ) : (
        <div className="col">
          {data && data.length > 0 && (
            <div className="attachment-grid">
              {data.map((a) => (
                <AttachmentCard key={a.id} a={a} page={page} onChanged={refresh} />
              ))}
            </div>
          )}
          {page.access.attach && (
            <div
              className={cx('dropzone', drag && 'active')}
              onClick={() => input.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                void upload([...e.dataTransfer.files]);
              }}
            >
              {progress !== null ? (
                <div className="col" style={{ alignItems: 'center' }}>
                  <span>{t('attachments.uploading')}</span>
                  <div className="progress" style={{ width: 240 }}>
                    <div style={{ width: `${progress}%` }} />
                  </div>
                </div>
              ) : (
                <span className="row" style={{ justifyContent: 'center' }}>
                  <Upload size={16} /> {t('attachments.drop')}
                </span>
              )}
              <input ref={input} type="file" multiple hidden onChange={(e) => void upload([...(e.target.files ?? [])])} />
            </div>
          )}
          {!page.access.attach && data?.length === 0 && <EmptyState compact title={t('attachments.empty')} />}
        </div>
      )}
    </section>
  );
}

/* ------------------------------ Verweise ------------------------------ */

export function LinksPanel({ page }: { page: Page }) {
  const { t } = useI18n();
  const backlinks = useQuery({ queryKey: ['backlinks', page.id], queryFn: () => api.get<PageSummary[]>(`/api/v1/pages/${page.id}/backlinks`) });
  const children = useQuery({
    queryKey: ['children', page.id, 'position', 1],
    queryFn: () => api.get<PageSummary[]>(`/api/v1/pages/${page.id}/children`),
    enabled: page.childCount > 0 && !page.isHome,
  });
  const items = backlinks.data ?? [];
  const kids = page.isHome ? [] : (children.data ?? []);
  if (!items.length && !kids.length) return null;
  return (
    <section className="panel">
      <div className="form-grid" style={{ gap: '1.5rem' }}>
        {kids.length > 0 && (
          <div>
            <h2 className="panel-title">
              <FileText size={17} />
              {t('page.children')}
              <span className="count">{kids.length}</span>
            </h2>
            <div className="list">
              {kids.map((p) => (
                <Link key={p.id} to={p.url} className="list-item">
                  <span className="list-item-icon">{p.icon ?? <FileText size={15} />}</span>
                  <span className="list-item-body">
                    <div className="list-item-title">{p.title}</div>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
        {items.length > 0 && (
          <div>
            <h2 className="panel-title">
              <ArrowLeftRight size={17} />
              {t('page.backlinks')}
              <span className="count">{items.length}</span>
            </h2>
            <div className="list">
              {items.map((p) => (
                <Link key={p.id} to={p.url} className="list-item">
                  <span className="list-item-icon">{p.icon ?? <Link2 size={15} />}</span>
                  <span className="list-item-body">
                    <div className="list-item-title">{p.title}</div>
                    <div className="list-item-meta">{p.spaceName}</div>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

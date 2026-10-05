import { useEffect, useRef, useState } from 'react';
import { REVIEW_INTERVALS, intervalLabel } from '../page/ReviewCycle';
import { CategorySelect } from '../../components/CategorySelect';
import { Link, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Download, FileText, FileType, Lock, Pencil, Plus, Settings, Trash2, Upload, Users, X } from 'lucide-react';
import { api, saveFile } from '../../api/client';
import type { Space, SpaceGrant, SpaceRole, Template } from '../../api/types';
import { useCatalog, useTemplates } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Alert, Avatar, Badge, Button, Card, EmptyState, Field, Input, Loading, PageHeader, Select, Switch, TabLinks, Textarea } from '../../components/ui';
import { ColorPicker, EmojiPicker, PagePicker, SubjectPicker } from '../../components/Pickers';
import { TemplateEditorDialog } from '../../components/TemplateEditorDialog';
import { useSpaceContext } from './SpaceLayout';
import { WikiImportCard } from './WikiImportCard';
import { ApprovalWorkflowCard } from './ApprovalWorkflowCard';

const ROLES: SpaceRole[] = ['viewer', 'commenter', 'editor', 'admin'];

export default function SpaceSettings() {
  const { space } = useSpaceContext();
  const { tab = 'general' } = useParams();
  const { t } = useI18n();
  const base = `/s/${encodeURIComponent(space.key)}/settings`;
  if (!space.can.admin) return <div className="container"><EmptyState icon={Lock} title={t('errors.forbidden')} /></div>;
  return (
    <div className="container">
      <PageHeader icon={Settings} title={t('spaceSettings.title')} subtitle={`${space.icon ?? '📘'} ${space.name} (${space.key})`} />
      <TabLinks
        items={[
          { to: `${base}`, label: t('spaceSettings.tabs.general'), end: true },
          { to: `${base}/permissions`, label: t('spaceSettings.tabs.permissions') },
          { to: `${base}/members`, label: t('spaceSettings.tabs.members') },
          { to: `${base}/restricted`, label: t('spaceSettings.tabs.restricted') },
          { to: `${base}/approvals`, label: t('workflow.tab') },
          { to: `${base}/templates`, label: t('spaceSettings.tabs.templates') },
          { to: `${base}/data`, label: t('spaceSettings.tabs.data') },
          { to: `${base}/danger`, label: t('spaceSettings.tabs.danger') },
        ]}
      />
      {tab === 'general' && (
        <div className="col gap-lg">
          <GeneralTab space={space} />
          <ReviewCycleCard space={space} />
        </div>
      )}
      {tab === 'permissions' && <PermissionsTab space={space} />}
      {tab === 'members' && <MembersTab space={space} />}
      {tab === 'restricted' && <RestrictedTab space={space} />}
      {tab === 'approvals' && <ApprovalWorkflowCard space={space} />}
      {tab === 'templates' && <TemplatesTab space={space} />}
      {tab === 'data' && <DataTab space={space} />}
      {tab === 'danger' && <DangerTab space={space} />}
    </div>
  );
}

function useRefreshSpace(space: Space) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['space', space.key] });
    void qc.invalidateQueries({ queryKey: ['spaces'] });
  };
}

function GeneralTab({ space }: { space: Space }) {
  const { t } = useI18n();
  const toast = useToast();
  const refresh = useRefreshSpace(space);
  const [name, setName] = useState(space.name);
  const [description, setDescription] = useState(space.description);
  const [icon, setIcon] = useState<string | null>(space.icon);
  const [color, setColor] = useState<string | null>(space.color);
  const [home, setHome] = useState<{ id: number; title: string } | null>(space.homePageId ? { id: space.homePageId, title: '…' } : null);
  // Titel der aktuellen Startseite nachladen, damit nicht nur die ID dasteht.
  const homePage = useQuery({
    queryKey: ['page-title', space.homePageId],
    queryFn: () => api.get<{ id: number; title: string }>(`/api/v1/pages/${space.homePageId}`),
    enabled: !!space.homePageId,
  });
  useEffect(() => {
    if (homePage.data) setHome({ id: homePage.data.id, title: homePage.data.title });
  }, [homePage.data]);
  const [category, setCategory] = useState(space.category ?? '');
  const [reviewRequired, setReviewRequired] = useState(!!space.reviewRequired);
  const [defaultEditMode, setDefaultEditMode] = useState<'direct' | 'suggest'>(space.defaultEditMode ?? 'direct');
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <div className="row row-top gap-lg">
        <Field label={t('spaces.icon')}>
          <EmojiPicker value={icon} onChange={setIcon} allowClear={false} />
        </Field>
        <Field label={t('common.name')} className="grow">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <Field label={t('common.description')}>
        <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="row row-top gap-lg">
        <Field label={t('spaces.color')}>
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Field label={t('spaces.category')} help={t('spaces.categoryHelp')} className="grow">
          <CategorySelect value={category} onChange={setCategory} />
        </Field>
      </div>
      <Field label={t('review.title')}>
        <Switch
          checked={reviewRequired}
          onChange={setReviewRequired}
          label={t('spaces.reviewRequired')}
          description={t('spaces.reviewRequiredHelp')}
        />
      </Field>
      <Field label={t('suggest.defaultMode')} help={t('suggest.defaultModeHelp')}>
        <Select value={defaultEditMode} onChange={(e) => setDefaultEditMode(e.target.value as 'direct' | 'suggest')} style={{ maxWidth: 320 }}>
          <option value="direct">{t('suggest.modes.direct')}</option>
          <option value="suggest">{t('suggest.modes.suggest')}</option>
        </Select>
      </Field>
      <Field label={t('spaceSettings.homePage')}>
        <div style={{ maxWidth: 480 }}>
          <PagePicker value={home} spaceKey={space.key} onChange={(p) => setHome(p ? { id: p.id, title: p.title } : null)} />
        </div>
      </Field>
      <div className="form-actions">
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.patch(`/api/v1/spaces/${encodeURIComponent(space.key)}`, {
                name,
                description,
                icon,
                color,
                category,
                reviewRequired,
                defaultEditMode,
                homePageId: home?.id ?? space.homePageId,
              });
              toast.success(t('common.changesSaved'));
              refresh();
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('common.save')}
        </Button>
      </div>
    </Card>
  );
}

/** Vorgabe für die Wiedervorlage und Plan für überfällige Prüfungen. */
function ReviewCycleCard({ space }: { space: Space }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({
    queryKey: ['space-review-cycle', space.key],
    queryFn: () => api.get<{ intervalMonths: number; boardId: number | null }>(`/api/v1/spaces/${encodeURIComponent(space.key)}/review-cycle`),
  });
  const boards = useQuery({
    queryKey: ['boards', space.key],
    queryFn: () => api.get<{ items: { id: number; name: string }[] }>(`/api/v1/spaces/${encodeURIComponent(space.key)}/boards`),
  });
  const save = async (patch: { intervalMonths?: number; boardId?: number | null }) => {
    try {
      await api.put(`/api/v1/spaces/${encodeURIComponent(space.key)}/review-cycle`, patch);
      toast.success(t('common.changesSaved'));
      void qc.invalidateQueries({ queryKey: ['space-review-cycle', space.key] });
      void qc.invalidateQueries({ queryKey: ['page'] });
    } catch (err) {
      toast.error(err);
    }
  };
  if (!settings.data) return null;
  return (
    <Card title={t('reviewCycle.spaceTitle')}>
      <p className="small muted mb-2">{t('reviewCycle.spaceHelp')} {t('reviewCycle.help')}</p>
      <div className="form-grid">
        <Field label={t('reviewCycle.interval')}>
          <Select value={String(settings.data.intervalMonths)} onChange={(e) => void save({ intervalMonths: Number(e.target.value) })}>
            <option value="0">{t('reviewCycle.none')}</option>
            {REVIEW_INTERVALS.map((m) => (
              <option key={m} value={m}>
                {intervalLabel(t, m)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('reviewCycle.spaceBoard')}>
          <Select value={settings.data.boardId ? String(settings.data.boardId) : ''} onChange={(e) => void save({ boardId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">{t('reviewCycle.noBoard')}</option>
            {(boards.data?.items ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Card>
  );
}

function PermissionsTab({ space }: { space: Space }) {
  const { t } = useI18n();
  const toast = useToast();
  const { settings } = useAuth();
  const refresh = useRefreshSpace(space);
  const catalog = useCatalog();
  const { data, isLoading } = useQuery({
    queryKey: ['space-grants', space.key],
    queryFn: () => api.get<SpaceGrant[]>(`/api/v1/spaces/${encodeURIComponent(space.key)}/permissions`),
  });
  const [grants, setGrants] = useState<SpaceGrant[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setGrants(data);
  }, [data]);

  const has = (type: SpaceGrant['subjectType']) => grants.some((g) => g.subjectType === type);
  const update = (i: number, role: SpaceRole) => setGrants(grants.map((g, j) => (j === i ? { ...g, role } : g)));

  if (isLoading) return <Loading />;
  return (
    <div className="col gap-lg">
      <p className="muted">{t('spaceSettings.permissionsIntro')}</p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('spaceSettings.subject')}</th>
              <th style={{ width: 220 }}>{t('spaceSettings.role')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {grants.map((g, i) => (
              <tr key={`${g.subjectType}:${g.subjectId}`}>
                <td>
                  <div className="row">
                    {g.subjectType === 'user' ? (
                      <Avatar user={{ displayName: g.label ?? '?' }} size={26} />
                    ) : (
                      <span className="group-icon">
                        <Users size={14} />
                      </span>
                    )}
                    <div>
                      <div>{g.subjectType === 'authenticated' ? t('spaceSettings.everyoneLoggedIn') : g.subjectType === 'anonymous' ? t('spaceSettings.anonymous') : g.label}</div>
                      <div className="tiny muted">
                        {g.subjectType === 'group' ? t('common.group') : g.detail || (g.subjectType === 'anonymous' && !settings.anonymousAccess ? t('spaceSettings.anonymousDisabled') : '')}
                      </div>
                    </div>
                  </div>
                </td>
                <td>
                  <Select value={g.role} aria-label={t('spaceSettings.role')} onChange={(e) => update(i, e.target.value as SpaceRole)}>
                    {ROLES.filter((r) => g.subjectType !== 'anonymous' || r === 'viewer').map((r) => (
                      <option key={r} value={r}>
                        {t(`roles.${r}`)}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="actions-cell">
                  <button type="button" className="icon-btn" onClick={() => setGrants(grants.filter((_, j) => j !== i))} aria-label={t('common.remove')}>
                    <X size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row row-wrap">
        <div style={{ width: 360 }}>
          <SubjectPicker
            exclude={grants.filter((g) => g.subjectType === 'user' || g.subjectType === 'group').map((g) => ({ type: g.subjectType as 'user' | 'group', id: g.subjectId }))}
            onPick={(s) => setGrants([...grants, { subjectType: s.type, subjectId: s.id, role: 'editor', label: s.label, detail: s.detail }])}
          />
        </div>
        {!has('authenticated') && (
          <Button icon={Plus} onClick={() => setGrants([...grants, { subjectType: 'authenticated', subjectId: 0, role: 'viewer', label: t('spaceSettings.everyoneLoggedIn') }])}>
            {t('spaceSettings.everyoneLoggedIn')}
          </Button>
        )}
        {!has('anonymous') && (
          <Button icon={Plus} onClick={() => setGrants([...grants, { subjectType: 'anonymous', subjectId: 0, role: 'viewer', label: t('spaceSettings.anonymous') }])}>
            {t('spaceSettings.anonymous')}
          </Button>
        )}
        <span className="spacer" />
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const saved = await api.put<SpaceGrant[]>(`/api/v1/spaces/${encodeURIComponent(space.key)}/permissions`, {
                grants: grants.map(({ subjectType, subjectId, role }) => ({ subjectType, subjectId, role })),
              });
              setGrants(saved);
              toast.success(t('common.changesSaved'));
              refresh();
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('common.save')}
        </Button>
      </div>
      {catalog.data && (
        <Card title={t('spaceSettings.roleMatrix')}>
          <div className="table-wrap" style={{ border: 'none' }}>
            <table className="table perm-matrix">
              <thead>
                <tr>
                  <th />
                  {catalog.data.spaceRoles.map((r) => (
                    <th key={r.role}>{t(`roles.${r.role}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {['view', 'export', 'comment', 'create', 'edit', 'move', 'delete', 'attach', 'restrict', 'moderate', 'purge', 'admin'].map((action) => (
                  <tr key={action}>
                    <td className="mono small">{action}</td>
                    {catalog.data.spaceRoles.map((r) => (
                      <td key={r.role}>{r.actions.includes(action) ? '✓' : ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function MembersTab({ space }: { space: Space }) {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ['space-members', space.key],
    queryFn: () =>
      api.get<{ user: { id: number; username: string; displayName: string; avatarColor: string | null }; role: SpaceRole; via: string[] }[]>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/members`,
      ),
  });
  if (isLoading) return <Loading />;
  return (
    <div className="table-wrap">
      <table className="table">
        <tbody>
          {(data ?? []).map((m) => (
            <tr key={m.user.id}>
              <td>
                <div className="row">
                  <Avatar user={m.user} size={26} />
                  <Link to={`/people/${encodeURIComponent(m.user.username)}`}>{m.user.displayName}</Link>
                  <span className="small muted">@{m.user.username}</span>
                </div>
              </td>
              <td>
                <Badge color={m.role === 'admin' ? 'purple' : m.role === 'editor' ? 'blue' : 'gray'}>{t(`roles.${m.role}`)}</Badge>
              </td>
              <td className="small muted">{m.via.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RestrictedTab({ space }: { space: Space }) {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({
    queryKey: ['restricted-pages', space.key],
    queryFn: () =>
      api.get<{ id: number; title: string; url: string; view: { label: string }[]; edit: { label: string }[]; canView: boolean }[]>(
        `/api/v1/spaces/${encodeURIComponent(space.key)}/restricted-pages`,
      ),
  });
  if (isLoading) return <Loading />;
  if (!data?.length) return <EmptyState icon={Lock} title={t('spaceSettings.restrictedEmpty')} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>{t('common.page')}</th>
            <th>{t('restrictions.view')}</th>
            <th>{t('restrictions.edit')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((p) => (
            <tr key={p.id}>
              <td>{p.canView ? <Link to={`${p.url}?dialog=restrictions`}>{p.title}</Link> : <span>{p.title}</span>}</td>
              <td className="small">{p.view.map((s) => s.label).join(', ') || '–'}</td>
              <td className="small">{p.edit.map((s) => s.label).join(', ') || '–'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TemplatesTab({ space }: { space: Space }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const { data, isLoading } = useTemplates(space.key, 'space');
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  return (
    <div className="col">
      <p className="muted">{t('templates.subtitle')}</p>
      <div>
        <Button icon={Plus} variant="primary" onClick={() => setEditing('new')}>
          {t('templates.create')}
        </Button>
      </div>
      {isLoading && <Loading />}
      {data && data.length === 0 && <EmptyState icon={FileText} title={t('templates.empty')} compact />}
      {data && data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {data.map((tpl) => (
                <tr key={tpl.id}>
                  <td>
                    {tpl.icon} <strong>{tpl.name}</strong>
                    <div className="small muted">{tpl.description}</div>
                  </td>
                  <td className="actions-cell">
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(tpl)}>
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      aria-label={t('common.delete')}
                      onClick={async () => {
                        if (!(await dialogs.confirm({ title: t('templates.deleteConfirm', { name: tpl.name }), danger: true, confirmLabel: t('common.delete') }))) return;
                        try {
                          await api.del(`/api/v1/templates/${tpl.id}`);
                          void qc.invalidateQueries({ queryKey: ['templates'] });
                        } catch (err) {
                          toast.error(err);
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <TemplateEditorDialog template={editing === 'new' ? null : editing} spaceKey={space.key} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DataTab({ space }: { space: Space }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [parent, setParent] = useState<{ id: number; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [handbook, setHandbook] = useState<'pdf' | 'docx' | null>(null);
  const base = `/api/v1/spaces/${encodeURIComponent(space.key)}/export?format=`;
  const exportHandbook = async (format: 'pdf' | 'docx') => {
    if (!space.homePageId) return;
    setHandbook(format);
    try {
      await saveFile('GET', `/api/v1/pages/${space.homePageId}/export/document`, { query: { format, children: true } });
    } catch (err) {
      toast.error(err);
    } finally {
      setHandbook(null);
    }
  };
  return (
    <div className="col gap-lg">
      <Card title={t('spaceSettings.exportTitle')}>
        {space.homePageId && (
          <>
            <p className="muted mb-2">{t('spaceSettings.handbookHelp')}</p>
            <div className="row row-wrap mb-3">
              <Button icon={FileText} loading={handbook === 'pdf'} disabled={!!handbook} onClick={() => void exportHandbook('pdf')}>
                {t('spaceSettings.handbookPdf')}
              </Button>
              <Button icon={FileType} loading={handbook === 'docx'} disabled={!!handbook} onClick={() => void exportHandbook('docx')}>
                {t('spaceSettings.handbookDocx')}
              </Button>
            </div>
          </>
        )}
        <div className="row row-wrap">
          <a className="btn" href={`${base}markdown`}>
            <Download size={16} /> {t('spaceSettings.exportMd')}
          </a>
          <a className="btn" href={`${base}html`}>
            <Download size={16} /> {t('spaceSettings.exportHtml')}
          </a>
          <a className="btn" href={`${base}json`}>
            <Download size={16} /> {t('spaceSettings.exportJson')}
          </a>
        </div>
      </Card>
      <WikiImportCard space={space} />
      <Card title={t('spaceSettings.importTitle')}>
        <p className="muted mb-2">{t('spaceSettings.importHelp')}</p>
        <Field label={t('spaceSettings.importTarget')} help={!parent ? t('newPage.topLevel') : undefined}>
          <div style={{ maxWidth: 480 }}>
            <PagePicker value={parent} spaceKey={space.key} onChange={(p) => setParent(p ? { id: p.id, title: p.title } : null)} />
          </div>
        </Field>
        <Button icon={Upload} loading={busy} onClick={() => input.current?.click()}>
          {t('common.upload')}
        </Button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept=".md,.markdown,.txt,.html,.htm,.zip"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (!files.length) return;
            const form = new FormData();
            if (parent) form.append('parentId', String(parent.id));
            for (const f of files) form.append('file', f, f.name);
            setBusy(true);
            try {
              const res = await api.upload<{ created: number }>(`/api/v1/spaces/${encodeURIComponent(space.key)}/import`, form);
              toast.success(t('spaceSettings.importDone', { n: res.created }));
              void qc.invalidateQueries({ queryKey: ['tree', space.key] });
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        />
      </Card>
    </div>
  );
}

function DangerTab({ space }: { space: Space }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const refresh = useRefreshSpace(space);
  return (
    <div className="col gap-lg">
      <Card title={space.archivedAt ? t('spaceSettings.unarchive') : t('spaceSettings.archive')}>
        <p className="muted mb-2">{t('spaceSettings.archiveHelp')}</p>
        <Button
          icon={Archive}
          onClick={async () => {
            try {
              await api.post(`/api/v1/spaces/${encodeURIComponent(space.key)}/archive`, { archived: !space.archivedAt });
              refresh();
            } catch (err) {
              toast.error(err);
            }
          }}
        >
          {space.archivedAt ? t('spaceSettings.unarchive') : t('spaceSettings.archive')}
        </Button>
      </Card>
      <Card title={t('spaceSettings.deleteSpace')}>
        <Alert variant="error">{t('spaceSettings.deleteHelp')}</Alert>
        <div className="mt-2">
          <Button
            variant="danger"
            icon={Trash2}
            onClick={async () => {
              const ok = await dialogs.confirm({
                title: t('spaceSettings.deleteSpace'),
                message: t('spaceSettings.deleteConfirm', { key: space.key }),
                requireText: space.key,
                danger: true,
                confirmLabel: t('common.delete'),
              });
              if (!ok) return;
              try {
                await api.del(`/api/v1/spaces/${encodeURIComponent(space.key)}`, { confirm: space.key });
                toast.success(t('spaceSettings.deleted'));
                await qc.invalidateQueries({ queryKey: ['spaces'] });
                navigate('/spaces', { replace: true });
              } catch (err) {
                toast.error(err);
              }
            }}
          >
            {t('spaceSettings.deleteSpace')}
          </Button>
        </div>
      </Card>
    </div>
  );
}

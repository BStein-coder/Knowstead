import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Pencil, Plus, Shield, Trash2, Users, UsersRound, X } from 'lucide-react';
import { api } from '../../api/client';
import type { Group, UserRef } from '../../api/types';
import { useCatalog, useGroups } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Alert, Avatar, Badge, Button, Card, Checkbox, Field, Input, Loading, Modal, PageHeader, Textarea } from '../../components/ui';
import { SubjectPicker } from '../../components/Pickers';

export function AdminGroups() {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const { data, isLoading } = useGroups();
  const [editing, setEditing] = useState<Group | 'new' | null>(null);
  return (
    <>
      <PageHeader
        icon={UsersRound}
        title={t('admin.nav.groups')}
        subtitle={t('adminGroups.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            {t('adminGroups.create')}
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.group')}</th>
                <th>{t('adminGroups.globalPermissions')}</th>
                <th>{t('adminGroups.members')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((g) => (
                <tr key={g.id}>
                  <td>
                    <div className="strong row gap-xs">
                      {g.name} {g.isSystem && <Badge>{t('adminGroups.system')}</Badge>} {g.isDefault && <Badge color="blue">{t('adminGroups.default')}</Badge>}
                    </div>
                    <div className="small muted">{g.description}</div>
                  </td>
                  <td>
                    <div className="row row-wrap gap-xs">
                      {g.permissions.map((p) => (
                        <Badge key={p} color={p === 'admin' ? 'red' : 'accent'}>
                          {p}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td>{g.memberCount}</td>
                  <td className="actions-cell">
                    <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(g)}>
                      {t('common.edit')}
                    </Button>
                    {!g.isSystem && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={Trash2}
                        aria-label={t('common.delete')}
                        onClick={async () => {
                          if (!(await dialogs.confirm({ title: t('adminGroups.deleteTitle', { name: g.name }), message: t('adminGroups.deleteText'), danger: true, confirmLabel: t('common.delete') }))) return;
                          try {
                            await api.del(`/api/v1/admin/groups/${g.id}`);
                            void qc.invalidateQueries({ queryKey: ['groups'] });
                          } catch (err) {
                            toast.error(err);
                          }
                        }}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <GroupDialog group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function GroupDialog({ group, onClose }: { group: Group | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const catalog = useCatalog();
  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [permissions, setPermissions] = useState<string[]>(group?.permissions ?? []);
  const [isDefault, setIsDefault] = useState(group?.isDefault ?? false);
  const [directoryGroups, setDirectoryGroups] = useState((group?.directoryGroups ?? []).join('\n'));
  const [syncEnabled, setSyncEnabled] = useState(group?.syncEnabled ?? true);
  const [members, setMembers] = useState<UserRef[]>([]);
  const [busy, setBusy] = useState(false);
  const membersQuery = useQuery({
    queryKey: ['group-members', group?.id],
    queryFn: () => api.get<{ members: UserRef[] }>(`/api/v1/admin/groups/${group!.id}`),
    enabled: !!group,
  });
  useEffect(() => {
    if (membersQuery.data) setMembers(membersQuery.data.members);
  }, [membersQuery.data]);

  const save = async () => {
    setBusy(true);
    try {
      let id = group?.id;
      const payload = {
        name,
        description,
        permissions,
        isDefault,
        directoryGroups: directoryGroups.split(/[\r\n;]+/).map((v) => v.trim()).filter(Boolean),
        syncEnabled,
      };
      if (group) await api.patch(`/api/v1/admin/groups/${group.id}`, payload);
      else id = (await api.post<Group>('/api/v1/admin/groups', payload)).id;
      await api.put(`/api/v1/admin/groups/${id}/members`, { userIds: members.map((m) => m.id) });
      toast.success(t('common.changesSaved'));
      void qc.invalidateQueries({ queryKey: ['groups'] });
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Users}
      title={group ? t('adminGroups.dialogTitle', { name: group.name }) : t('adminGroups.create')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('common.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={group?.isSystem} autoFocus />
        </Field>
        <Field label={t('adminGroups.options')}>
          <Checkbox checked={isDefault} onChange={setIsDefault} label={t('adminGroups.addNewUsers')} />
        </Field>
      </div>
      <Field label={t('common.description')}>
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field
        label={t('adminGroups.directoryGroups')}
        help={t('adminGroups.directoryGroupsHelp')}
      >
        <Textarea
          rows={3}
          className="mono"
          value={directoryGroups}
          placeholder={'Knowstead-Redaktion\nCN=Knowstead-Admins,OU=Gruppen,DC=firma,DC=local'}
          onChange={(e) => setDirectoryGroups(e.target.value)}
        />
        <div style={{ marginTop: '0.5rem' }}>
          <Checkbox checked={syncEnabled} onChange={setSyncEnabled} label={t('adminGroups.sync')} />
        </div>
      </Field>
      <Field label={t('adminGroups.globalPermissions')}>
        <div className="col gap-sm">
          {Object.entries(catalog.data?.globalPermissions ?? {}).map(([key, p]) => (
            <Checkbox
              key={key}
              checked={permissions.includes(key)}
              onChange={(on) => setPermissions(on ? [...permissions, key] : permissions.filter((x) => x !== key))}
              label={
                <span>
                  <strong>{p.label}</strong> <span className="muted small">– {p.description}</span>
                </span>
              }
            />
          ))}
        </div>
      </Field>
      <Field label={t('adminGroups.membersCount', { n: members.length })}>
        <div className="col">
          <SubjectPicker groups={false} exclude={members.map((m) => ({ type: 'user', id: m.id }))} onPick={(s) => s.user && setMembers([...members, s.user])} placeholder={t('adminGroups.addUser')} />
          <div className="subject-list" style={{ maxHeight: 260, overflowY: 'auto' }}>
            {members.map((m) => (
              <div key={m.id} className="subject-row">
                <Avatar user={m} size={24} />
                <span className="grow">
                  {m.displayName} <span className="muted small">@{m.username}</span>
                </span>
                <button type="button" className="icon-btn" onClick={() => setMembers(members.filter((x) => x.id !== m.id))} aria-label={t('common.remove')}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      </Field>
    </Modal>
  );
}

/** Übersicht: globale Rechte je Gruppe (Matrix) und Erklärung des Rechtemodells. */
export function AdminPermissions() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const catalog = useCatalog();
  const { data: groups, isLoading } = useGroups();
  const [matrix, setMatrix] = useState<Record<number, string[]>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (groups) setMatrix(Object.fromEntries(groups.map((g) => [g.id, g.permissions])));
  }, [groups]);
  if (isLoading || !catalog.data) return <Loading />;
  const perms = Object.entries(catalog.data.globalPermissions);
  const dirty = (groups ?? []).some((g) => [...g.permissions].sort().join() !== [...(matrix[g.id] ?? [])].sort().join());
  return (
    <>
      <PageHeader
        icon={KeyRound}
        title={t('admin.nav.permissions')}
        subtitle={t('adminGroups.permSubtitle')}
        actions={
          <Button
            variant="primary"
            disabled={!dirty}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                for (const g of groups ?? []) {
                  const next = matrix[g.id] ?? [];
                  if ([...g.permissions].sort().join() !== [...next].sort().join()) await api.patch(`/api/v1/admin/groups/${g.id}`, { permissions: next });
                }
                toast.success(t('common.changesSaved'));
                void qc.invalidateQueries({ queryKey: ['groups'] });
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('common.save')}
          </Button>
        }
      />
      <Card title={<><Shield size={15} /> {t('adminGroups.matrixTitle')}</>} padded={false}>
        <div style={{ overflowX: 'auto' }}>
          <table className="table perm-matrix">
            <thead>
              <tr>
                <th>{t('adminGroups.permission')}</th>
                {(groups ?? []).map((g) => (
                  <th key={g.id}>{g.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {perms.map(([key, p]) => (
                <tr key={key}>
                  <td>
                    <div className="strong">{p.label}</div>
                    <div className="small muted">{p.description}</div>
                  </td>
                  {(groups ?? []).map((g) => (
                    <td key={g.id}>
                      <input
                        type="checkbox"
                        aria-label={`${p.label} – ${g.name}`}
                        checked={(matrix[g.id] ?? []).includes(key)}
                        onChange={(e) =>
                          setMatrix({ ...matrix, [g.id]: e.target.checked ? [...(matrix[g.id] ?? []), key] : (matrix[g.id] ?? []).filter((x) => x !== key) })
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="form-grid mt-3" style={{ gap: '1rem' }}>
        <Card title={t('adminGroups.model1')}>
          <p className="small soft">{t('adminGroups.model1Text')}</p>
        </Card>
        <Card title={t('adminGroups.model2')}>
          <p className="small soft">{t('adminGroups.model2Text')}</p>
        </Card>
        <Card title={t('adminGroups.model3')}>
          <p className="small soft">{t('adminGroups.model3Text')}</p>
        </Card>
      </div>
      <div className="mt-2">
        <Alert variant="info">{t('adminGroups.tokensHint')}</Alert>
      </div>
    </>
  );
}

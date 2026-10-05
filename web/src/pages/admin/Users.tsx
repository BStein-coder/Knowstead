import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, KeyRound, Search, Send, Trash2, Unlock, UserCheck, UserPlus, Users, UserX } from 'lucide-react';
import { api } from '../../api/client';
import type { ApiToken, Group, Paged, User } from '../../api/types';
import { useGroups } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Alert, Avatar, Badge, Button, Checkbox, CopyField, Field, Input, Loading, Modal, PageHeader, Select, Tabs, Time } from '../../components/ui';
import { TokenCreator, TokenTable } from '../profile/ProfilePage';
import type { LinkedIdentity } from '../../api/types';
import { SsoProviderIcon } from '../auth/SsoButtons';

/** Mit Entra ID, SAML oder dem Windows-Konto verknüpfte Anmeldungen einer Person. */
function LinkedIdentities({ userId }: { userId: number }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data, refetch } = useQuery({
    queryKey: ['admin-user-identities', userId],
    queryFn: () => api.get<{ items: LinkedIdentity[] }>(`/api/v1/admin/users/${userId}/identities`),
  });
  if (!data?.items.length) return null;
  return (
    <div>
      <h4 className="mb-1">{t('sso.linkedTitle')}</h4>
      <div className="col gap-xs">
        {data.items.map((identity) => (
          <div key={identity.id} className="row gap-sm">
            <SsoProviderIcon provider={identity.provider} />
            <strong>{t(`sso.providerNames.${identity.provider}`)}</strong>
            <span className="muted grow">{identity.label}</span>
            <Button
              size="sm"
              variant="ghost"
              icon={Trash2}
              onClick={async () => {
                try {
                  await api.del(`/api/v1/admin/users/${userId}/identities/${identity.id}`);
                  await refetch();
                  toast.success(t('common.changesSaved'));
                } catch (err) {
                  toast.error(err);
                }
              }}
            >
              {t('sso.unlink')}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AdminUsers() {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-users', q, status, kind],
    queryFn: () => api.get<Paged<User>>('/api/v1/admin/users', { q, status, kind, limit: 200 }),
  });
  return (
    <>
      <PageHeader
        icon={Users}
        title={t('admin.nav.users')}
        subtitle={data ? t('adminUsers.count', { n: data.total }) : undefined}
        actions={
          <Button variant="primary" icon={UserPlus} onClick={() => setCreating(true)}>
            {t('adminUsers.create')}
          </Button>
        }
      />
      <div className="row row-wrap mb-2">
        <div style={{ width: 320 }}>
          <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('adminUsers.searchPlaceholder')} />
        </div>
        <Select style={{ width: 160 }} aria-label={t('common.status')} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">{t('adminUsers.allStatus')}</option>
          <option value="active">{t('common.active')}</option>
          <option value="disabled">{t('common.disabled')}</option>
        </Select>
        <Select style={{ width: 180 }} aria-label={t('adminUsers.kind')} value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">{t('adminUsers.allKinds')}</option>
          <option value="user">{t('adminUsers.people')}</option>
          <option value="bot">{t('adminUsers.bots')}</option>
        </Select>
      </div>
      {isLoading ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.user')}</th>
                <th>{t('common.groups')}</th>
                <th>{t('common.status')}</th>
                <th>{t('adminUsers.lastLogin')}</th>
              </tr>
            </thead>
            <tbody>
              {(data?.items ?? []).map((u) => (
                <tr key={u.id} className="clickable" onClick={() => setSelected(u.id)}>
                  <td>
                    <div className="row">
                      <Avatar user={u} size={30} />
                      <div>
                        <div className="strong">
                          {u.displayName} {u.kind === 'bot' && <Badge color="purple">Bot</Badge>} {u.isAdmin && <Badge color="red">Admin</Badge>}
                        </div>
                        <div className="small muted">
                          @{u.username} {u.email && `· ${u.email}`}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="small">{u.groups?.map((g) => g.name).join(', ')}</td>
                  <td>{u.status === 'active' ? <Badge color="green">{t('common.active')}</Badge> : <Badge color="red">{t('common.disabled')}</Badge>}</td>
                  <td className="small muted">
                    <Time value={u.lastLoginAt} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <CreateUserDialog onClose={() => setCreating(false)} onCreated={() => void refetch()} />}
      {selected !== null && <UserDetailDialog id={selected} onClose={() => setSelected(null)} onChanged={() => void refetch()} />}
    </>
  );
}

function CreateUserDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const { data: groups } = useGroups();
  const [form, setForm] = useState({ username: '', displayName: '', email: '', password: '', kind: 'user' as 'user' | 'bot' });
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  return (
    <Modal
      open
      onClose={onClose}
      title={t('adminUsers.create')}
      icon={UserPlus}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post('/api/v1/admin/users', {
                  username: form.username,
                  displayName: form.displayName || form.username,
                  email: form.email || null,
                  password: form.kind === 'bot' ? null : form.password || null,
                  kind: form.kind,
                  groupIds,
                });
                onCreated();
                onClose();
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('common.create')}
          </Button>
        </>
      }
    >
      <Field label={t('adminUsers.kind')}>
        <Select value={form.kind} onChange={set('kind')}>
          <option value="user">{t('adminUsers.person')}</option>
          <option value="bot">{t('adminUsers.bot')}</option>
        </Select>
      </Field>
      <div className="form-grid">
        <Field label={t('auth.displayName')}>
          <Input value={form.displayName} onChange={set('displayName')} autoFocus />
        </Field>
        <Field label={t('auth.username')} required>
          <Input value={form.username} onChange={set('username')} />
        </Field>
      </div>
      <Field label={t('auth.email')}>
        <Input type="email" value={form.email} onChange={set('email')} />
      </Field>
      {form.kind === 'user' && (
        <Field label={t('auth.password')} help={t('adminUsers.passwordHelp')}>
          <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
      )}
      <Field label={t('common.groups')} help={t('adminUsers.groupsHelp')}>
        <div className="col gap-sm">
          {(groups ?? []).map((g) => (
            <Checkbox key={g.id} checked={groupIds.includes(g.id)} onChange={(on) => setGroupIds(on ? [...groupIds, g.id] : groupIds.filter((x) => x !== g.id))} label={g.isDefault ? t('adminUsers.defaultGroup', { name: g.name }) : g.name} />
          ))}
        </div>
      </Field>
    </Modal>
  );
}

function UserDetailDialog({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const { user: me, data: meData } = useAuth();
  const { data: groups } = useGroups();
  const [tab, setTab] = useState<'profile' | 'groups' | 'security' | 'tokens'>('profile');
  const [resetLink, setResetLink] = useState<string | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['admin-user', id],
    queryFn: () =>
      api.get<{ user: User; tokens: ApiToken[]; sessions: number; lockedUntil: string | null; registrationPendingAt: string | null }>(`/api/v1/admin/users/${id}`),
  });
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [groupIds, setGroupIds] = useState<number[] | null>(null);

  const refresh = async () => {
    await refetch();
    onChanged();
    void qc.invalidateQueries({ queryKey: ['groups'] });
  };

  if (isLoading || !data) {
    return (
      <Modal open onClose={onClose} size="lg">
        <Loading />
      </Modal>
    );
  }
  const u = data.user;
  const currentGroups = groupIds ?? (u.groups ?? []).map((g) => g.id);
  const call = async (fn: () => Promise<unknown>, msg = t('common.changesSaved')) => {
    try {
      await fn();
      toast.success(msg);
      await refresh();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={u.displayName} icon={u.kind === 'bot' ? Bot : Users}>
      <div className="row mb-2">
        <Avatar user={u} size={44} />
        <div className="grow">
          <div className="strong">@{u.username}</div>
          <div className="small muted">
            {t('adminUsers.created')} <Time value={u.createdAt} mode="date" /> · {t('adminUsers.lastLogin')} <Time value={u.lastLoginAt} /> · {t('adminUsers.sessions', { n: data.sessions })}
          </div>
        </div>
        <Link to={`/people/${encodeURIComponent(u.username)}`} className="btn btn-sm" onClick={onClose}>
          {t('adminUsers.profile')}
        </Link>
      </div>
      {data.registrationPendingAt && (
        <div className="mb-2">
          <Alert variant="info" title={t('adminUsers.unverified')} action={<Button size="sm" icon={Unlock} onClick={() => void call(() => api.post(`/api/v1/admin/users/${id}/unlock`))}>{t('adminUsers.approve')}</Button>}>
            {t('adminUsers.selfRegistered')} <Time value={data.registrationPendingAt} mode="datetime" />. {t('adminUsers.unverifiedText')}
          </Alert>
        </div>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'profile', label: t('profile.tabs.profile') },
          { value: 'groups', label: t('common.groups') },
          { value: 'security', label: t('adminUsers.security') },
          { value: 'tokens', label: t('profile.tabs.tokens'), count: data.tokens.filter((x) => !x.revokedAt).length },
        ]}
      />
      {tab === 'profile' && (
        <>
          <div className="form-grid">
            <Field label={t('auth.displayName')}>
              <Input defaultValue={u.displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </Field>
            <Field label={t('auth.email')}>
              <Input defaultValue={u.email ?? ''} onChange={(e) => setEmail(e.target.value)} />
            </Field>
          </div>
          <div className="form-actions">
            <Button variant="primary" onClick={() => void call(() => api.patch(`/api/v1/admin/users/${id}`, { displayName: displayName || undefined, email: email || undefined }))}>
              {t('common.save')}
            </Button>
          </div>
        </>
      )}
      {tab === 'groups' && (
        <>
          <div className="col gap-sm">
            {(groups ?? []).map((g: Group) => (
              <Checkbox
                key={g.id}
                checked={currentGroups.includes(g.id)}
                onChange={(on) => setGroupIds(on ? [...currentGroups, g.id] : currentGroups.filter((x) => x !== g.id))}
                label={
                  <>
                    <strong>{g.name}</strong> <span className="muted small">{g.permissions.join(', ') || '–'}</span>
                  </>
                }
              />
            ))}
          </div>
          <div className="form-actions">
            <Button variant="primary" onClick={() => void call(() => api.patch(`/api/v1/admin/users/${id}`, { groupIds: currentGroups }))}>
              {t('common.save')}
            </Button>
          </div>
        </>
      )}
      {tab === 'security' && (
        <div className="col gap-lg">
          {data.lockedUntil && new Date(data.lockedUntil) > new Date() && (
            <Alert variant="warning" title={t('adminUsers.locked')} action={<Button size="sm" icon={Unlock} onClick={() => void call(() => api.post(`/api/v1/admin/users/${id}/unlock`))}>{t('adminUsers.unlock')}</Button>}>
              {t('adminUsers.lockedText')} <Time value={data.lockedUntil} mode="datetime" />.
            </Alert>
          )}
          {u.kind === 'user' && (
            <div>
              <h4 className="mb-1">{t('adminUsers.password')}</h4>
              <div className="row row-wrap">
                <Button
                  icon={KeyRound}
                  onClick={async () => {
                    const pw = await dialogs.prompt({ title: t('adminUsers.setPasswordTitle'), label: t('profile.newPassword') });
                    if (pw) await call(() => api.post(`/api/v1/admin/users/${id}/password`, { password: pw }), t('profile.passwordChanged'));
                  }}
                >
                  {t('adminUsers.setPassword')}
                </Button>
                <Button
                  icon={KeyRound}
                  onClick={async () => {
                    try {
                      const res = await api.post<{ url: string }>(`/api/v1/admin/users/${id}/reset-link`);
                      setResetLink(res.url);
                    } catch (err) {
                      toast.error(err);
                    }
                  }}
                >
                  {t('adminUsers.resetLink')}
                </Button>
                {u.email && meData?.mailConfigured && (
                  <Button
                    icon={Send}
                    onClick={async () => {
                      try {
                        const res = await api.post<{ to: string }>(`/api/v1/admin/users/${id}/invite`);
                        toast.success(t('adminUsers.inviteSent', { to: res.to }));
                      } catch (err) {
                        toast.error(err);
                      }
                    }}
                  >
                    {t('adminUsers.invite')}
                  </Button>
                )}
              </div>
              {resetLink && (
                <div className="mt-1">
                  <CopyField value={resetLink} onCopied={() => toast.success(t('common.copied'))} />
                  <div className="small muted mt-1">{t('adminUsers.resetLinkHint')}</div>
                </div>
              )}
            </div>
          )}
          <LinkedIdentities userId={u.id} />
          <div>
            <h4 className="mb-1">{t('adminUsers.account')}</h4>
            <div className="row row-wrap">
              {u.status === 'active' ? (
                <Button icon={UserX} disabled={u.id === me?.id} onClick={() => void call(() => api.post(`/api/v1/admin/users/${id}/status`, { status: 'disabled' }))}>
                  {t('adminUsers.disable')}
                </Button>
              ) : (
                <Button icon={UserCheck} onClick={() => void call(() => api.post(`/api/v1/admin/users/${id}/status`, { status: 'active' }))}>
                  {t('adminUsers.enable')}
                </Button>
              )}
              <Button
                variant="danger"
                icon={Trash2}
                disabled={u.id === me?.id}
                onClick={async () => {
                  const ok = await dialogs.confirm({
                    title: t('adminUsers.deleteTitle', { name: u.displayName }),
                    message: t('adminUsers.deleteText'),
                    danger: true,
                    confirmLabel: t('common.delete'),
                  });
                  if (!ok) return;
                  try {
                    await api.del(`/api/v1/admin/users/${id}`);
                    onChanged();
                    onClose();
                  } catch (err) {
                    toast.error(err);
                  }
                }}
              >
                {t('common.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}
      {tab === 'tokens' && (
        <div className="col gap-lg">
          {u.kind === 'bot' && <TokenCreator userId={u.id} onCreated={() => void refetch()} />}
          <TokenTable
            tokens={data.tokens}
            onRevoke={async (tk) => {
              if (!(await dialogs.confirm({ title: t('profile.tokenRevokeConfirm', { name: tk.name }), danger: true, confirmLabel: t('profile.tokenRevoke') }))) return;
              await call(() => api.del(`/api/v1/admin/tokens/${tk.id}`));
            }}
          />
        </div>
      )}
    </Modal>
  );
}

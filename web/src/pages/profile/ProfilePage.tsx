import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, KeyRound, Laptop, Plus, Settings, Trash2, User } from 'lucide-react';
import { api } from '../../api/client';
import type { ApiToken, PageSummary, Session, Space } from '../../api/types';
import { useCatalog } from '../../api/hooks';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { applyTheme } from '../../lib/theme';
import { applyMotion, useMotionMode } from '../../lib/motion';
import { applyAppearance, isAppearance, useAppearance } from '../../lib/appearance';
import { Alert, Avatar, Badge, Button, Card, Checkbox, CopyField, EmptyState, Field, Input, Loading, PageHeader, Select, Switch, TabLinks, Textarea, Time } from '../../components/ui';
import { ColorPicker } from '../../components/Pickers';
import { DeputiesTab } from './DeputiesTab';
import { SignInTab } from './SignInTab';

export default function ProfilePage() {
  const { tab = 'profile' } = useParams();
  const { t } = useI18n();
  return (
    <div className="container container-narrow">
      <PageHeader icon={User} title={t('profile.title')} />
      <TabLinks
        items={[
          { to: '/profile', label: t('profile.tabs.profile'), end: true },
          { to: '/profile/preferences', label: t('profile.tabs.preferences') },
          { to: '/profile/password', label: t('profile.tabs.password') },
          { to: '/profile/tokens', label: t('profile.tabs.tokens') },
          { to: '/profile/sessions', label: t('profile.tabs.sessions') },
          { to: '/profile/sign-in', label: t('sso.profileTab') },
          { to: '/profile/deputies', label: t('deputies.tab') },
          { to: '/profile/notifications', label: t('profile.tabs.notifications') },
        ]}
      />
      {tab === 'profile' && <ProfileTab />}
      {tab === 'preferences' && <PreferencesTab />}
      {tab === 'password' && <PasswordTab />}
      {tab === 'tokens' && <TokensTab />}
      {tab === 'sessions' && <SessionsTab />}
      {tab === 'sign-in' && <SignInTab />}
      {tab === 'deputies' && <DeputiesTab />}
      {tab === 'notifications' && <WatchingTab />}
    </div>
  );
}

function ProfileTab() {
  const { user, refresh } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [bio, setBio] = useState(user?.bio ?? '');
  const [color, setColor] = useState<string | null>(user?.avatarColor ?? null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const emailChanged = email.trim().toLowerCase() !== (user.email ?? '').toLowerCase();
  const needsPassword = emailChanged && !!user.hasPassword;
  return (
    <Card>
      <div className="row mb-2">
        <Avatar user={{ displayName, avatarColor: color }} size={56} />
        <div>
          <div className="strong">@{user.username}</div>
          <div className="small muted">
            {t('profile.memberOf')}: {user.groups?.map((g) => g.name).join(', ')}
          </div>
        </div>
      </div>
      <div className="form-grid">
        <Field label={t('auth.displayName')}>
          <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label={t('auth.email')}>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
      </div>
      {needsPassword && (
        <Field label={t('profile.currentPassword')} help={t('auth.emailPasswordHelp')}>
          <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
        </Field>
      )}
      <Field label={t('profile.bio')}>
        <Textarea rows={3} value={bio} onChange={(e) => setBio(e.target.value)} />
      </Field>
      <Field label={t('profile.avatarColor')}>
        <ColorPicker value={color} onChange={setColor} />
      </Field>
      <div className="form-actions">
        <Button
          variant="primary"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api.patch('/api/v1/me', { displayName, email: email || null, bio, avatarColor: color, currentPassword: needsPassword ? currentPassword : undefined });
              setCurrentPassword('');
              await refresh();
              toast.success(t('common.changesSaved'));
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

function PreferencesTab() {
  const { user, data, updatePreferences } = useAuth();
  const { t, setLocale } = useI18n();
  const toast = useToast();
  const motion = useMotionMode();
  const appearance = useAppearance();
  if (!user) return null;
  const prefs = user.preferences;
  const save = async (patch: Record<string, unknown>) => {
    try {
      await updatePreferences(patch);
      toast.success(t('common.changesSaved'));
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <Card>
      <div className="form-grid">
        <Field label={t('profile.theme')}>
          <Select
            value={(prefs.theme as string) ?? 'system'}
            onChange={(e) => {
              applyTheme(e.target.value as 'light' | 'dark' | 'system');
              void save({ theme: e.target.value });
            }}
          >
            <option value="system">{t('app.themeSystem')}</option>
            <option value="light">{t('app.themeLight')}</option>
            <option value="dark">{t('app.themeDark')}</option>
          </Select>
        </Field>
        <Field label={t('profile.appearance')} help={t('profile.appearanceHelp')}>
          <Select
            value={appearance}
            onChange={(e) => {
              const next = isAppearance(e.target.value) ? e.target.value : 'classic';
              applyAppearance(next);
              void save({ appearance: next });
            }}
          >
            <option value="classic">{t('app.appearanceClassic')}</option>
            <option value="glass">{t('app.appearanceGlass')}</option>
            <option value="paper">{t('app.appearancePaper')}</option>
            <option value="frost">{t('app.appearanceFrost')}</option>
          </Select>
        </Field>
        <Field label={t('profile.language')}>
          <Select
            value={(prefs.locale as string) ?? 'de'}
            onChange={(e) => {
              setLocale(e.target.value as 'de' | 'en');
              void save({ locale: e.target.value });
            }}
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Field label={t('profile.motion')} help={t('profile.motionHelp')}>
          <Select
            value={motion}
            onChange={(e) => {
              const next = e.target.value === 'reduced' ? 'reduced' : 'full';
              applyMotion(next, true);
              void save({ motion: next });
            }}
          >
            <option value="full">{t('profile.motionFull')}</option>
            <option value="reduced">{t('profile.motionReduced')}</option>
          </Select>
        </Field>
      </div>
      <div className="col gap-lg mt-2">
        <Switch checked={prefs.autoWatch !== false} onChange={(v) => void save({ autoWatch: v })} label={t('profile.autoWatch')} />
      </div>
      <div className="profile-mail mt-2">
        <Field label={t('profile.emailMode')} help={data?.emailNotificationsEnabled ? t('profile.emailModeHelp') : t('profile.emailDisabled')}>
          <Select
            value={(prefs.emailMode as string) ?? (prefs.emailNotifications === false ? 'off' : 'instant')}
            disabled={!data?.emailNotificationsEnabled}
            onChange={(e) => void save({ emailMode: e.target.value, emailNotifications: e.target.value !== 'off' })}
          >
            <option value="instant">{t('profile.emailInstant')}</option>
            <option value="daily">{t('profile.emailDaily')}</option>
            <option value="off">{t('profile.emailOff')}</option>
          </Select>
        </Field>
        <Switch
          checked={prefs.emailOnlyMentions === true}
          disabled={!data?.emailNotificationsEnabled || prefs.emailMode === 'off'}
          onChange={(v) => void save({ emailOnlyMentions: v })}
          label={t('profile.emailOnlyMentions')}
          description={t('profile.emailOnlyMentionsHelp')}
        />
        <Field label={t('profile.taskReminder')} help={t('profile.taskReminderHelp')}>
          <Select value={String(prefs.taskReminderDays ?? 1)} onChange={(e) => void save({ taskReminderDays: Number(e.target.value) })}>
            <option value="-1">{t('profile.taskReminderNone')}</option>
            <option value="0">{t('profile.taskReminderSameDay')}</option>
            <option value="1">{t('profile.taskReminder1')}</option>
            <option value="2">{t('profile.taskReminderN', { n: 2 })}</option>
            <option value="3">{t('profile.taskReminderN', { n: 3 })}</option>
            <option value="7">{t('profile.taskReminderWeek')}</option>
          </Select>
        </Field>
      </div>
    </Card>
  );
}

function PasswordTab() {
  const { t } = useI18n();
  const toast = useToast();
  const { settings } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Card>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (next !== repeat) {
            toast.error(t('auth.passwordMismatch'));
            return;
          }
          setBusy(true);
          try {
            await api.post('/api/v1/auth/password', { current, next });
            toast.success(t('profile.passwordChanged'));
            setCurrent('');
            setNext('');
            setRepeat('');
          } catch (err) {
            toast.error(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        <Field label={t('profile.currentPassword')}>
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
        </Field>
        <div className="form-grid">
          <Field label={t('profile.newPassword')} help={t('auth.passwordHint', { n: settings.passwordMinLength })}>
            <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required />
          </Field>
          <Field label={t('auth.passwordRepeat')}>
            <Input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" required />
          </Field>
        </div>
        <div className="form-actions">
          <Button type="submit" variant="primary" icon={KeyRound} loading={busy}>
            {t('profile.changePassword')}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function TokenCreator({ onCreated, userId }: { onCreated: () => void; userId?: number }) {
  const { t } = useI18n();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const catalog = useCatalog();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [days, setDays] = useState('90');
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scopeList = Object.entries(catalog.data?.tokenScopes ?? { read: 'read', write: 'write', admin: 'admin' }).filter(([k]) => k !== 'admin' || isAdmin);
  return (
    <div className="col">
      {created && (
        <Alert variant="success" title={t('profile.tokenCreated')}>
          <CopyField value={created} onCopied={() => toast.success(t('common.copied'))} />
          <div className="small mt-1">
            {t('profile.tokenExample')}: <code>curl -H "Authorization: Bearer {created.slice(0, 12)}…" {window.location.origin}/api/v1/spaces</code>
          </div>
        </Alert>
      )}
      <div className="form-grid">
        <Field label={t('profile.tokenName')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="CI-Pipeline" />
        </Field>
        <Field label={t('profile.tokenExpiry')}>
          <Select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="30">{t('profile.tokenDays', { n: 30 })}</option>
            <option value="90">{t('profile.tokenDays', { n: 90 })}</option>
            <option value="365">{t('profile.tokenDays', { n: 365 })}</option>
            <option value="">{t('profile.tokenNoExpiry')}</option>
          </Select>
        </Field>
      </div>
      <Field label={t('profile.tokenScopes')}>
        <div className="col gap-sm">
          {scopeList.map(([key, label]) => (
            <Checkbox key={key} checked={scopes.includes(key)} onChange={(on) => setScopes(on ? [...scopes, key] : scopes.filter((s) => s !== key))} label={<><code>{key}</code> – {label}</>} />
          ))}
        </div>
      </Field>
      <div>
        <Button
          variant="primary"
          icon={Plus}
          loading={busy}
          disabled={!name.trim() || !scopes.length}
          onClick={async () => {
            setBusy(true);
            try {
              const body = { name, scopes, expiresInDays: days ? Number(days) : null };
              const res = await api.post<{ token: string }>(userId ? `/api/v1/admin/users/${userId}/tokens` : '/api/v1/me/tokens', body);
              setCreated(res.token);
              setName('');
              onCreated();
            } catch (err) {
              toast.error(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('profile.tokenCreate')}
        </Button>
      </div>
    </div>
  );
}

export function TokenTable({ tokens, onRevoke, showUser }: { tokens: ApiToken[]; onRevoke: (tk: ApiToken) => void; showUser?: boolean }) {
  const { t } = useI18n();
  if (!tokens.length) return <EmptyState compact icon={KeyRound} title={t('common.empty')} />;
  return (
    <div className="table-wrap">
      <table className="table">
        <tbody>
          {tokens.map((tk) => (
            <tr key={tk.id} style={tk.revokedAt ? { opacity: 0.55 } : undefined}>
              <td>
                <div className="strong">{tk.name}</div>
                <div className="small muted mono">{tk.prefix}…</div>
                {showUser && tk.user && <div className="small">{tk.user.displayName}</div>}
              </td>
              <td>
                <div className="row gap-xs">
                  {tk.scopes.map((s) => (
                    <Badge key={s} color={s === 'admin' ? 'red' : s === 'write' ? 'yellow' : 'blue'}>
                      {s}
                    </Badge>
                  ))}
                </div>
              </td>
              <td className="small muted">
                {tk.lastUsedAt ? (
                  <>
                    {t('profile.tokenLastUsed', { when: '' })} <Time value={tk.lastUsedAt} />
                  </>
                ) : (
                  t('profile.tokenNeverUsed')
                )}
                {tk.expiresAt && (
                  <div>
                    {t('profile.tokenExpires', { when: '' })} <Time value={tk.expiresAt} mode="date" />
                  </div>
                )}
              </td>
              <td className="actions-cell">
                {tk.revokedAt ? (
                  <Badge>{t('profile.tokenRevoked')}</Badge>
                ) : (
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => onRevoke(tk)}>
                    {t('profile.tokenRevoke')}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TokensTab() {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const { can } = useAuth();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['my-tokens'], queryFn: () => api.get<ApiToken[]>('/api/v1/me/tokens') });
  return (
    <div className="col gap-lg">
      <p className="muted">
        {t('profile.tokensIntro')} <a href="/api/docs" target="_blank" rel="noreferrer">{t('app.apiDocs')}</a>
      </p>
      {can('api.tokens') && (
        <Card>
          <TokenCreator onCreated={() => void refetch()} />
        </Card>
      )}
      {isLoading ? (
        <Loading />
      ) : (
        <TokenTable
          tokens={data ?? []}
          onRevoke={async (tk) => {
            if (!(await dialogs.confirm({ title: t('profile.tokenRevokeConfirm', { name: tk.name }), danger: true, confirmLabel: t('profile.tokenRevoke') }))) return;
            try {
              await api.del(`/api/v1/me/tokens/${tk.id}`);
              await refetch();
            } catch (err) {
              toast.error(err);
            }
          }}
        />
      )}
    </div>
  );
}

function SessionsTab() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<Session[]>('/api/v1/auth/sessions') });
  if (isLoading) return <Loading />;
  return (
    <div className="col gap-lg">
      <div className="row">
        <p className="muted grow">{t('profile.sessionsIntro')}</p>
        <Button
          onClick={async () => {
            await api.post('/api/v1/auth/sessions/revoke-others');
            await refetch();
            toast.success(t('common.changesSaved'));
          }}
        >
          {t('profile.sessionRevokeOthers')}
        </Button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {(data ?? []).map((s) => (
              <tr key={s.id}>
                <td>
                  <div className="row">
                    <Laptop size={16} className="muted" />
                    <span className="truncate" style={{ maxWidth: 360 }} title={s.userAgent ?? ''}>
                      {s.userAgent ?? '?'}
                    </span>
                    {s.current && <Badge color="green">{t('profile.sessionCurrent')}</Badge>}
                  </div>
                  <div className="small muted">
                    {s.ip} · {t('profile.lastSeen', { when: '' })} <Time value={s.lastSeenAt} />
                  </div>
                </td>
                <td className="actions-cell">
                  {!s.current && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await api.del(`/api/v1/auth/sessions/${s.id}`);
                        await refetch();
                      }}
                    >
                      {t('profile.sessionRevoke')}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WatchingTab() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['watching'],
    queryFn: () => api.get<{ pages: PageSummary[]; spaces: Space[] }>('/api/v1/me/watching'),
  });
  if (isLoading || !data) return <Loading />;
  return (
    <div className="col gap-lg">
      <Card title={<><Eye size={15} /> {t('profile.watchingSpaces')}</>}>
        {data.spaces.length === 0 && <div className="small muted">{t('common.none')}</div>}
        {data.spaces.map((s) => (
          <div key={s.key} className="row" style={{ padding: '0.3rem 0' }}>
            <Link to={`/s/${encodeURIComponent(s.key)}`} className="grow">
              {s.icon} {s.name}
            </Link>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await api.post(`/api/v1/spaces/${encodeURIComponent(s.key)}/watch`, { on: false });
                await refetch();
                void qc.invalidateQueries({ queryKey: ['spaces'] });
              }}
            >
              {t('spaces.unwatch')}
            </Button>
          </div>
        ))}
      </Card>
      <Card title={<><Eye size={15} /> {t('profile.watchingPages')}</>}>
        {data.pages.length === 0 && <div className="small muted">{t('common.none')}</div>}
        {data.pages.map((p) => (
          <div key={p.id} className="row" style={{ padding: '0.3rem 0' }}>
            <Link to={p.url} className="grow truncate">
              {p.icon} {p.title} <span className="muted small">· {p.spaceName}</span>
            </Link>
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                await api.post(`/api/v1/pages/${p.id}/watch`, { on: false });
                await refetch();
              }}
            >
              {t('page.unwatch')}
            </Button>
          </div>
        ))}
      </Card>
      <div className="small muted row">
        <Settings size={13} /> {t('profile.autoWatch')}
      </div>
    </div>
  );
}

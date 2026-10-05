import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Mail, PlugZap, RefreshCw, RotateCcw, Save, Send, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { useI18n, type TFn } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useAuth } from '../../lib/auth';
import { Alert, Badge, Button, Card, EmptyState, Field, IconButton, Input, Loading, PageHeader, Select, Switch, Tabs, Time } from '../../components/ui';

type Security = 'starttls' | 'tls' | 'none';

interface Smtp {
  host: string;
  port: number;
  security: Security;
  user: string;
  password: string;
  from: string;
  replyTo: string;
  rejectUnauthorized: boolean;
}

interface MailSettings {
  emailNotifications: boolean;
  mailDigestHour: number;
  smtp: Smtp;
}

interface MailItem {
  id: number;
  recipient: string;
  kind: string;
  subject: string;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
}

interface Overview {
  configured: boolean;
  notificationsEnabled: boolean;
  stats: { queued: number; failed: number; sent24h: number; failed24h: number };
  items: MailItem[];
  total: number;
}

const PRESETS: { id: string; label: string; host?: string; match?: RegExp; port?: number; security?: Security; hint: string }[] = [
  {
    id: 'm365',
    label: 'adminMail.presets.m365.label',
    host: 'smtp.office365.com',
    port: 587,
    security: 'starttls',
    hint: 'adminMail.presets.m365.hint',
  },
  {
    id: 'm365-relay',
    label: 'adminMail.presets.m365_relay.label',
    match: /\.mail\.protection\.outlook\.com$/i,
    port: 25,
    security: 'starttls',
    hint: 'adminMail.presets.m365_relay.hint',
  },
  { id: 'exchange', label: 'adminMail.presets.exchange.label', port: 25, security: 'starttls', hint: 'adminMail.presets.exchange.hint' },
  { id: 'google', label: 'Google Workspace', host: 'smtp.gmail.com', port: 587, security: 'starttls', hint: 'adminMail.presets.google.hint' },
  { id: 'ionos', label: 'IONOS', host: 'smtp.ionos.de', port: 587, security: 'starttls', hint: 'adminMail.presets.mailbox.hint' },
  { id: 'strato', label: 'STRATO', host: 'smtp.strato.de', port: 465, security: 'tls', hint: 'adminMail.presets.mailbox.hint' },
];

const SECURITY_LABELS: Record<Security, string> = {
  starttls: 'adminMail.security.starttls',
  tls: 'adminMail.security.tls',
  none: 'adminMail.security.none',
};

const STATUS: Record<MailItem['status'], { label: string; color: string }> = {
  queued: { label: 'adminMail.status.queued', color: 'yellow' },
  sending: { label: 'adminMail.status.sending', color: 'blue' },
  sent: { label: 'adminMail.status.sent', color: 'green' },
  failed: { label: 'adminMail.status.failed', color: 'red' },
};

function kindLabel(kind: string, t: TFn): string {
  if (kind === 'test') return t('adminMail.kinds.test');
  if (kind === 'digest') return t('adminMail.kinds.digest');
  if (kind === 'password-reset') return t('adminMail.kinds.password');
  if (kind === 'mention') return t('adminMail.kinds.mention');
  if (kind.startsWith('task.')) return t('adminMail.kinds.task');
  if (kind.startsWith('comment.')) return t('adminMail.kinds.comment');
  if (kind.startsWith('review.')) return t('adminMail.kinds.review');
  if (kind.startsWith('page.')) return t('adminMail.kinds.page');
  return kind;
}

/** Administration → E-Mail: SMTP-Server, Benachrichtigungen, Versandprotokoll. */
export function AdminMail() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<MailSettings>('/api/v1/admin/settings') });
  const [status, setStatus] = useState<'all' | MailItem['status']>('all');
  const [q, setQ] = useState('');
  const overview = useQuery({
    queryKey: ['admin-mail', status, q],
    queryFn: () => api.get<Overview>('/api/v1/admin/mail', { status: status === 'all' ? undefined : status, q: q || undefined, limit: 100 }),
    refetchInterval: 15_000,
  });
  const [s, setS] = useState<MailSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);
  const [testTo, setTestTo] = useState('');
  /** Gewählte Vorlage – bleibt stehen, auch wenn der Servername noch nicht passt (z. B. beim Relay). */
  const [presetId, setPresetId] = useState<string | null>(null);
  const [sendingTest, setSendingTest] = useState(false);

  useEffect(() => {
    if (settings.data) setS({ emailNotifications: settings.data.emailNotifications, mailDigestHour: settings.data.mailDigestHour, smtp: structuredClone(settings.data.smtp) });
  }, [settings.data]);
  useEffect(() => {
    if (user?.email && !testTo) setTestTo(user.email);
  }, [user?.email, testTo]);

  if (settings.isLoading || !s) return <Loading />;
  const smtp = s.smtp;
  const setSmtp = (patch: Partial<Smtp>) => {
    setS({ ...s, smtp: { ...smtp, ...patch } });
    setCheck(null);
  };
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS.find((p) => (p.host && p.host === smtp.host) || p.match?.test(smtp.host)) ?? null;

  const persist = async () => {
    const saved = await api.put<MailSettings>('/api/v1/admin/settings', s);
    setS({ emailNotifications: saved.emailNotifications, mailDigestHour: saved.mailDigestHour, smtp: structuredClone(saved.smtp) });
    void qc.invalidateQueries({ queryKey: ['admin-settings'] });
    void qc.invalidateQueries({ queryKey: ['admin-mail'] });
  };

  const save = async () => {
    setSaving(true);
    try {
      await persist();
      toast.success(t('common.changesSaved'));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const verify = async () => {
    setChecking(true);
    setCheck(null);
    try {
      await persist();
      const res = await api.post<{ message: string; durationMs: number }>('/api/v1/admin/mail/verify', {});
      setCheck({ ok: true, message: `${res.message} (${res.durationMs} ms)` });
    } catch (err) {
      setCheck({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setChecking(false);
    }
  };

  const sendTest = async () => {
    setSendingTest(true);
    try {
      await persist();
      const res = await api.post<{ durationMs: number }>('/api/v1/admin/mail/test', { to: testTo });
      toast.success(`${t('adminMail.testSent', { to: testTo })} (${res.durationMs} ms)`);
      setCheck({ ok: true, message: t('adminMail.testSent', { to: testTo }) });
    } catch (err) {
      setCheck({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setSendingTest(false);
      void qc.invalidateQueries({ queryKey: ['admin-mail'] });
    }
  };

  const retry = async (id?: number) => {
    try {
      if (id) await api.post(`/api/v1/admin/mail/${id}/retry`, {});
      else await api.post('/api/v1/admin/mail/retry-failed', {});
      toast.success(id ? t('adminMail.retryOne') : t('adminMail.retryAll'));
    } catch (err) {
      toast.error(err);
    } finally {
      void qc.invalidateQueries({ queryKey: ['admin-mail'] });
    }
  };

  const data = overview.data;
  const configured = !!(smtp.host && smtp.from);

  return (
    <>
      <PageHeader
        icon={Mail}
        title={t('adminMail.title')}
        subtitle={t('adminMail.subtitle')}
        actions={
          <Button variant="primary" icon={Save} loading={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        }
      />
      <div className="col gap-lg">
        {!configured && (
          <Alert variant="warning" title={t('adminMail.notConfigured')}>
            {t('adminMail.notConfiguredText')}
          </Alert>
        )}
        {configured && !s.emailNotifications && (
          <Alert variant="info" title={t('adminMail.notificationsOff')}>
            {t('adminMail.notificationsOffText')}
          </Alert>
        )}

        <Card title={t('adminMail.smtpServer')}>
          <div className="form-grid">
            <Field label={t('adminMail.preset')} help={preset ? t(preset.hint) : t('adminMail.presetHelp')}>
              <Select
                value={preset?.id ?? ''}
                onChange={(e) => {
                  const p = PRESETS.find((x) => x.id === e.target.value);
                  setPresetId(p?.id ?? null);
                  if (p) setSmtp({ host: p.host ?? smtp.host, port: p.port ?? smtp.port, security: p.security ?? smtp.security });
                }}
              >
                <option value="">{t('adminMail.customServer')}</option>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label.startsWith('adminMail.') ? t(p.label) : p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('adminMail.from')} help={t('adminMail.fromHelp')} required>
              <Input value={smtp.from} onChange={(e) => setSmtp({ from: e.target.value })} placeholder="knowstead@firma.de" />
            </Field>
            <Field label={t('adminMail.smtpServer')} required>
              <Input
                value={smtp.host}
                onChange={(e) => {
                  setPresetId(null);
                  setSmtp({ host: e.target.value.trim() });
                }}
                placeholder={preset?.id === 'm365-relay' ? 'firma-de.mail.protection.outlook.com' : 'smtp.firma.de'}
                className="mono"
              />
            </Field>
            <Field label={t('adminMail.port')}>
              <Input type="number" min={1} max={65535} value={smtp.port} onChange={(e) => setSmtp({ port: Number(e.target.value) })} />
            </Field>
            <Field label={t('adminMail.encryption')}>
              <Select value={smtp.security} onChange={(e) => setSmtp({ security: e.target.value as Security })}>
                {(Object.keys(SECURITY_LABELS) as Security[]).map((k) => (
                  <option key={k} value={k}>
                    {t(SECURITY_LABELS[k])}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('adminMail.replyTo')} help={t('adminMail.replyToHelp')}>
              <Input value={smtp.replyTo} onChange={(e) => setSmtp({ replyTo: e.target.value })} placeholder="it-support@firma.de" />
            </Field>
            <Field label={t('adminMail.user')} help={t('adminMail.userHelp')}>
              <Input value={smtp.user} onChange={(e) => setSmtp({ user: e.target.value })} autoComplete="off" />
            </Field>
            <Field label={t('adminMail.password')} help={t('adminMail.passwordHelp')}>
              <Input type="password" value={smtp.password} onChange={(e) => setSmtp({ password: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
          <div className="mt-2">
            <Switch
              checked={smtp.rejectUnauthorized}
              onChange={(v) => setSmtp({ rejectUnauthorized: v })}
              label={t('adminMail.verifyCert')}
              description={t('adminMail.verifyCertHelp')}
            />
          </div>
          {check && (
            <div className="mt-2">
              <Alert variant={check.ok ? 'success' : 'error'} title={check.ok ? t('adminMail.success') : t('adminMail.failure')}>
                {check.message}
              </Alert>
            </div>
          )}
          <div className="mail-actions">
            <Button icon={PlugZap} loading={checking} disabled={!configured} onClick={() => void verify()}>
              {t('adminMail.verify')}
            </Button>
            <span className="spacer" />
            <Input value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="empfaenger@firma.de" style={{ maxWidth: 260 }} aria-label={t('adminMail.testRecipient')} />
            <Button icon={Send} loading={sendingTest} disabled={!configured || !testTo.includes('@')} onClick={() => void sendTest()}>
              {t('adminMail.sendTest')}
            </Button>
          </div>
        </Card>

        <Card title={t('adminMail.notifications')}>
          <Switch
            checked={s.emailNotifications}
            onChange={(v) => setS({ ...s, emailNotifications: v })}
            label={t('adminMail.sendNotifications')}
            description={t('adminMail.sendNotificationsHelp')}
          />
          <div className="form-grid mt-2">
            <Field label={t('adminMail.digestHour')} help={t('adminMail.digestHourHelp')}>
              <Select value={String(s.mailDigestHour)} onChange={(e) => setS({ ...s, mailDigestHour: Number(e.target.value) })}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {t('adminMail.hour', { h: String(h).padStart(2, '0') })}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <p className="small muted mt-2">{t('adminMail.personalChoice')}</p>
        </Card>

        <Card
          title={t('adminMail.log')}
          actions={
            <div className="row gap-xs">
              {data && data.stats.queued + data.stats.failed > 0 && (
                <Button size="sm" icon={RotateCcw} onClick={() => void retry()}>
                  {t('adminMail.retryNow')}
                </Button>
              )}
              <IconButton icon={RefreshCw} label={t('adminMail.refresh')} onClick={() => void overview.refetch()} />
            </div>
          }
        >
          {data && (
            <div className="stat-row mb-2">
              <Badge color={data.stats.queued ? 'yellow' : 'gray'}>{t('adminMail.statQueued', { n: data.stats.queued })}</Badge>
              <Badge color="green">{t('adminMail.statSent', { n: data.stats.sent24h })}</Badge>
              <Badge color={data.stats.failed ? 'red' : 'gray'}>{t('adminMail.statFailed', { n: data.stats.failed })}</Badge>
            </div>
          )}
          <div className="row gap-sm mb-2" style={{ flexWrap: 'wrap' }}>
            <Tabs
              value={status}
              onChange={setStatus}
              items={[
                { value: 'all', label: t('adminMail.all') },
                { value: 'queued', label: t('adminMail.status.queued') },
                { value: 'sent', label: t('adminMail.status.sent') },
                { value: 'failed', label: t('adminMail.status.failed') },
              ]}
            />
            <span className="spacer" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('adminMail.searchPlaceholder')} style={{ maxWidth: 240 }} />
          </div>
          {overview.isLoading ? (
            <Loading inline />
          ) : !data?.items.length ? (
            <EmptyState compact icon={Mail} title={t('adminMail.empty')} text={t('adminMail.emptyText')} />
          ) : (
            <div className="table-wrap">
              <table className="table mail-table">
                <thead>
                  <tr>
                    <th>{t('adminMail.time')}</th>
                    <th>{t('adminMail.recipient')}</th>
                    <th>{t('adminMail.subject')}</th>
                    <th>{t('adminMail.kind')}</th>
                    <th>{t('adminMail.statusColumn')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((m) => (
                    <tr key={m.id}>
                      <td className="nowrap small">
                        <Time value={m.sentAt ?? m.createdAt} mode="datetime" />
                      </td>
                      <td className="small">{m.recipient}</td>
                      <td>
                        <div className="truncate" style={{ maxWidth: 360 }} title={m.subject}>
                          {m.subject}
                        </div>
                        {m.lastError && m.status !== 'sent' && <div className="tiny danger-text">{m.lastError}</div>}
                      </td>
                      <td className="small">{kindLabel(m.kind, t)}</td>
                      <td className="nowrap">
                        <Badge color={STATUS[m.status].color}>
                          {m.status === 'sent' ? <CheckCircle2 size={11} /> : m.status === 'failed' ? <XCircle size={11} /> : null} {t(STATUS[m.status].label)}
                        </Badge>
                        {m.attempts > 1 && <div className="tiny muted">{t('adminMail.attempts', { n: m.attempts })}</div>}
                      </td>
                      <td>{(m.status === 'failed' || m.status === 'queued') && <IconButton icon={RotateCcw} label={t('adminMail.retry')} onClick={() => void retry(m.id)} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

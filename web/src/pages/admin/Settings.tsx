import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Mail, Save, Send, Settings as SettingsIcon } from 'lucide-react';
import { api } from '../../api/client';
import { useI18n } from '../../i18n';
import { taglineText } from '../../lib/built-in-texts';
import { useToast } from '../../lib/toast';
import { Button, Card, Field, Input, Loading, PageHeader, Select, Switch, Textarea } from '../../components/ui';
import { ColorPicker } from '../../components/Pickers';
import type { AdminAlerts } from './Overview';

interface Settings {
  siteName: string;
  siteTagline: string;
  accentColor: string;
  uiMotion: 'full' | 'reduced';
  defaultLocale: 'de' | 'en';
  welcomeMessage: string;
  footerText: string;
  allowRegistration: boolean;
  registrationDomains: string[];
  anonymousAccess: boolean;
  personalSpaces: boolean;
  sessionDays: number;
  passwordMinLength: number;
  maxLoginAttempts: number;
  lockMinutes: number;
  maxUploadMb: number;
  blockedExtensions: string[];
  allowedEmbedHosts: string[];
  trashRetentionDays: number;
  revisionLimit: number;
  eventRetentionDays: number;
  backupEnabled: boolean;
  backupHour: number;
  backupKeep: number;
  backupIncludeUploads: boolean;
  alerts: { email: boolean; recipients: string; diskMinGb: number; backupMaxAgeDays: number };
  realtimeCollaboration: boolean;
}

function ListInput({ value, onChange, placeholder, id }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; id?: string }) {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => setText(value.join('\n')), [value]);
  return (
    <Textarea
      id={id}
      rows={4}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => onChange(text.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean))}
    />
  );
}

export function AdminSettings() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<Settings>('/api/v1/admin/settings') });
  const [s, setS] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const alertInfo = useQuery({ queryKey: ['admin-alerts'], queryFn: () => api.get<AdminAlerts>('/api/v1/admin/alerts') });
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    if (data) setS(structuredClone(data));
  }, [data]);
  if (isLoading || !s) return <Loading />;
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const num = (k: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, Number(e.target.value) as never);

  const save = async () => {
    setBusy(true);
    try {
      // E-Mail, Verzeichnis und KI haben eigene Seiten – hier nicht mit alten Werten überschreiben
      const { smtp: _smtp, emailNotifications: _mail, mailDigestHour: _digest, directory: _dir, ai: _ai, exportTemplate: _export, ...rest } = s as Settings & Record<string, unknown>;
      const saved = await api.put<Settings>('/api/v1/admin/settings', rest);
      setS(saved);
      toast.success(t('common.changesSaved'));
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['admin-alerts'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const setAlert = <K extends keyof Settings['alerts']>(k: K, v: Settings['alerts'][K]) => setS({ ...s, alerts: { ...s.alerts, [k]: v } });
  // Gespeichert wird mit dem Knopf oben – die Testwarnung geht an die zuletzt gespeicherten Empfänger
  const sendTestAlert = async () => {
    setTesting(true);
    try {
      const res = await api.post<{ recipients: number }>('/api/v1/admin/alerts/test');
      toast.success(t('adminSettings.alertsTestSent', { n: res.recipients }));
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(false);
    }
  };
  const alertMail = alertInfo.data?.mail;

  return (
    <>
      <PageHeader
        icon={SettingsIcon}
        title={t('admin.nav.settings')}
        actions={
          <Button variant="primary" icon={Save} loading={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        }
      />
      <div className="col gap-lg">
        <Card title={t('adminSettings.general')}>
          <div className="form-grid">
            <Field label={t('adminSettings.siteName')}>
              <Input value={s.siteName} onChange={(e) => set('siteName', e.target.value)} />
            </Field>
            <Field label={t('adminSettings.tagline')}>
              {/* Die mitgelieferte Vorgabe erscheint wie auf der Start- und Anmeldeseite in der Sprache der Oberfläche */}
              <Input value={taglineText(s.siteTagline, t)} onChange={(e) => set('siteTagline', e.target.value)} />
            </Field>
            <Field label={t('adminSettings.defaultLocale')}>
              <Select value={s.defaultLocale} onChange={(e) => set('defaultLocale', e.target.value as 'de' | 'en')}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label={t('adminSettings.accent')}>
              <div className="row">
                <ColorPicker value={s.accentColor} onChange={(c) => set('accentColor', c)} />
                <Input style={{ width: 110 }} className="mono" value={s.accentColor} aria-label={t('adminSettings.accentHex')} onChange={(e) => set('accentColor', e.target.value)} />
              </div>
            </Field>
          </div>
          <Field label={t('adminSettings.footer')}>
            <Input value={s.footerText} onChange={(e) => set('footerText', e.target.value)} />
          </Field>
          <Field label={t('adminSettings.motion')} help={t('adminSettings.motionHelp')}>
            <Select value={s.uiMotion ?? 'full'} onChange={(e) => set('uiMotion', e.target.value === 'reduced' ? 'reduced' : 'full')}>
              <option value="full">{t('profile.motionFull')}</option>
              <option value="reduced">{t('profile.motionReduced')}</option>
            </Select>
          </Field>
        </Card>

        <Card title={t('adminSettings.access')}>
          <div className="col gap-lg mb-2">
            <Switch checked={s.allowRegistration} onChange={(v) => set('allowRegistration', v)} label={t('adminSettings.registration')} description={t('adminSettings.registrationHelp')} />
            <Switch checked={s.anonymousAccess} onChange={(v) => set('anonymousAccess', v)} label={t('adminSettings.anonymous')} description={t('adminSettings.anonymousHelp')} />
            <Switch checked={s.personalSpaces} onChange={(v) => set('personalSpaces', v)} label={t('adminSettings.personal')} />
            <Switch
              checked={s.realtimeCollaboration}
              onChange={(v) => set('realtimeCollaboration', v)}
              label={t('adminSettings.realtime')}
              description={t('adminSettings.realtimeHelp')}
            />
          </div>
          <div className="form-grid">
            <Field
              label={t('adminSettings.domains')}
              help={t('adminSettings.domainsHelp')}
            >
              <ListInput value={s.registrationDomains} onChange={(v) => set('registrationDomains', v)} placeholder="firma.de" />
            </Field>
            <div>
              <Field label={t('adminSettings.passwordMin')}>
                <Input type="number" min={6} max={128} value={s.passwordMinLength} onChange={num('passwordMinLength')} />
              </Field>
              <Field label={t('adminSettings.sessionDays')}>
                <Input type="number" min={1} max={365} value={s.sessionDays} onChange={num('sessionDays')} />
              </Field>
            </div>
            <Field label={t('adminSettings.attempts')}>
              <Input type="number" min={1} max={100} value={s.maxLoginAttempts} onChange={num('maxLoginAttempts')} />
            </Field>
            <Field label={t('adminSettings.lockMinutes')}>
              <Input type="number" min={1} max={1440} value={s.lockMinutes} onChange={num('lockMinutes')} />
            </Field>
          </div>
        </Card>

        <Card title={t('adminSettings.content')}>
          <div className="form-grid">
            <Field label={t('adminSettings.maxUpload')}>
              <Input type="number" min={1} max={2048} value={s.maxUploadMb} onChange={num('maxUploadMb')} />
            </Field>
            <Field label={t('adminSettings.trash')} help={t('adminSettings.zeroNever')}>
              <Input type="number" min={0} value={s.trashRetentionDays} onChange={num('trashRetentionDays')} />
            </Field>
            <Field label={t('adminSettings.revisions')} help={t('adminSettings.zeroUnlimitedRecommended')}>
              <Input type="number" min={0} value={s.revisionLimit} onChange={num('revisionLimit')} />
            </Field>
            <Field label={t('adminSettings.retention')} help={t('adminSettings.zeroUnlimited')}>
              <Input type="number" min={0} value={s.eventRetentionDays} onChange={num('eventRetentionDays')} />
            </Field>
            <Field label={t('adminSettings.blocked')} help={t('adminSettings.onePerLine')}>
              <ListInput value={s.blockedExtensions} onChange={(v) => set('blockedExtensions', v)} />
            </Field>
            <Field label={t('adminSettings.embedHosts')} help={t('adminSettings.embedHostsHelp')}>
              <ListInput value={s.allowedEmbedHosts} onChange={(v) => set('allowedEmbedHosts', v)} />
            </Field>
          </div>
        </Card>

        <Card title={<><Mail size={15} /> {t('adminMail.title')}</>}>
          <p className="muted mb-2">{t('adminSettings.mailHint')}</p>
          <Link to="/admin/mail" className="btn btn-secondary">
            <Mail size={15} /> {t('adminSettings.toMail')}
          </Link>
        </Card>

        <Card title={t('adminSettings.backups')}>
          <div className="col gap-lg mb-2">
            <Switch checked={s.backupEnabled} onChange={(v) => set('backupEnabled', v)} label={t('adminSettings.backupDaily')} />
            <Switch checked={s.backupIncludeUploads} onChange={(v) => set('backupIncludeUploads', v)} label={t('adminSettings.backupUploads')} />
          </div>
          <div className="form-grid">
            <Field label={t('adminSettings.backupHour')}>
              <Input type="number" min={0} max={23} value={s.backupHour} onChange={num('backupHour')} />
            </Field>
            <Field label={t('adminSettings.backupKeep')}>
              <Input type="number" min={1} max={365} value={s.backupKeep} onChange={num('backupKeep')} />
            </Field>
          </div>
        </Card>

        <Card title={<><BellRing size={15} /> {t('adminSettings.alerts')}</>}>
          <p className="muted mb-2">{t('adminSettings.alertsHint')}</p>
          <div className="col gap-lg mb-2">
            <Switch checked={s.alerts.email} onChange={(v) => setAlert('email', v)} label={t('adminSettings.alertsEmail')} />
          </div>
          {alertMail && !alertMail.configured && (
            <p className="small mb-2">
              {t('adminSettings.alertsNoSmtp')} <Link to="/admin/mail">{t('adminSettings.toMail')}</Link>
            </p>
          )}
          <div className="form-grid">
            <Field label={t('adminSettings.alertsRecipients')} help={t('adminSettings.alertsRecipientsHint')}>
              <Input value={s.alerts.recipients} placeholder="betrieb@firma.de" onChange={(e) => setAlert('recipients', e.target.value)} />
            </Field>
            <Field label={t('adminSettings.alertsDisk')} help={t('adminSettings.alertsZeroOff')}>
              <Input type="number" min={0} max={1000} step={0.5} value={s.alerts.diskMinGb} onChange={(e) => setAlert('diskMinGb', Number(e.target.value))} />
            </Field>
            <Field label={t('adminSettings.alertsBackupAge')} help={t('adminSettings.alertsZeroOff')}>
              <Input type="number" min={0} max={60} value={s.alerts.backupMaxAgeDays} onChange={(e) => setAlert('backupMaxAgeDays', Number(e.target.value))} />
            </Field>
          </div>
          <div className="row gap-sm mt-2">
            <Button icon={Send} loading={testing} disabled={!alertMail?.configured} onClick={() => void sendTestAlert()}>
              {t('adminSettings.alertsTest')}
            </Button>
            {alertMail && <span className="small muted">{t('adminSettings.alertsRecipientCount', { n: alertMail.recipients })}</span>}
          </div>
        </Card>
      </div>
    </>
  );
}

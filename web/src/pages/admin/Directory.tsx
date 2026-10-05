import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Network, Save, Search, ShieldCheck, TestTube2, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Alert, Badge, Button, Card, Field, Input, Loading, PageHeader, Switch } from '../../components/ui';

export interface DirectorySettings {
  enabled: boolean;
  url: string;
  startTls: boolean;
  rejectUnauthorized: boolean;
  bindDn: string;
  bindPassword: string;
  baseDn: string;
  groupBaseDn: string;
  userFilter: string;
  userIdAttribute: string;
  nameAttribute: string;
  mailAttribute: string;
  groupAttribute: string;
  nestedGroups: boolean;
  defaultDomain: string;
  autoCreateUsers: boolean;
  adoptLocalUsers: boolean;
  allowLocalLogin: boolean;
  requireGroup: string;
}

interface TestStep {
  label: string;
  ok: boolean;
  detail: string;
}

/** Administration → Verzeichnis: Anmeldung und Gruppen aus Active Directory/LDAP. */
export function AdminDirectory() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api.get<{ directory: DirectorySettings }>('/api/v1/admin/settings'),
  });
  const [d, setD] = useState<DirectorySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [steps, setSteps] = useState<TestStep[] | null>(null);
  const [sample, setSample] = useState({ login: '', password: '' });
  const [groupQuery, setGroupQuery] = useState('');
  const [groups, setGroups] = useState<{ dn: string; name: string; description: string }[] | null>(null);

  useEffect(() => {
    if (data?.directory) setD(structuredClone(data.directory));
  }, [data]);

  if (isLoading || !d) return <Loading />;
  const set = <K extends keyof DirectorySettings>(k: K, v: DirectorySettings[K]) => setD({ ...d, [k]: v });

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.put<{ directory: DirectorySettings }>('/api/v1/admin/settings', { directory: d });
      setD(structuredClone(saved.directory));
      toast.success(t('common.changesSaved'));
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setSteps(null);
    try {
      // Erst speichern, damit der Test die aktuellen Angaben verwendet.
      await api.put('/api/v1/admin/settings', { directory: d });
      const result = await api.post<{ ok: boolean; steps: TestStep[] }>('/api/v1/admin/directory/test', {
        login: sample.login || undefined,
        password: sample.password || undefined,
      });
      setSteps(result.steps);
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(false);
    }
  };

  const searchGroups = async () => {
    try {
      const result = await api.get<{ items: { dn: string; name: string; description: string }[] }>('/api/v1/admin/directory/groups', {
        q: groupQuery,
      });
      setGroups(result.items);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <PageHeader
        icon={Network}
        title={t('adminDirectory.title')}
        subtitle={t('adminDirectory.subtitle')}
        actions={
          <>
            <Button icon={TestTube2} loading={testing} onClick={() => void test()}>
              {t('adminDirectory.test')}
            </Button>
            <Button variant="primary" icon={Save} loading={busy} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          </>
        }
      />

      <div className="col gap-lg">
        <Card title={t('adminDirectory.basics')}>
          <div className="col gap-lg mb-2">
            <Switch
              checked={d.enabled}
              onChange={(v) => set('enabled', v)}
              label={t('adminDirectory.enable')}
              description={t('adminDirectory.enableHelp')}
            />
            <Switch
              checked={d.allowLocalLogin}
              onChange={(v) => set('allowLocalLogin', v)}
              label={t('adminDirectory.allowLocal')}
              description={t('adminDirectory.allowLocalHelp')}
            />
          </div>
          <div className="form-grid">
            <Field label={t('adminDirectory.url')} help={t('adminDirectory.urlHelp')}>
              <Input value={d.url} onChange={(e) => set('url', e.target.value)} placeholder="ldaps://dc01.firma.local:636" className="mono" />
            </Field>
            <Field label={t('adminDirectory.baseDn')} help={t('adminDirectory.baseDnHelp')}>
              <Input value={d.baseDn} onChange={(e) => set('baseDn', e.target.value)} placeholder={t('adminDirectory.baseDnPlaceholder')} className="mono" />
            </Field>
            <Field label={t('adminDirectory.bindDn')} help={t('adminDirectory.bindDnHelp')}>
              <Input value={d.bindDn} onChange={(e) => set('bindDn', e.target.value)} placeholder={t('adminDirectory.bindDnPlaceholder')} className="mono" />
            </Field>
            <Field label={t('adminDirectory.bindPassword')} help={t('adminDirectory.encrypted')}>
              <Input type="password" value={d.bindPassword} onChange={(e) => set('bindPassword', e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label={t('adminDirectory.defaultDomain')} help={t('adminDirectory.defaultDomainHelp')}>
              <Input value={d.defaultDomain} onChange={(e) => set('defaultDomain', e.target.value)} placeholder="firma.local" />
            </Field>
            <Field label={t('adminDirectory.requireGroup')} help={t('adminDirectory.requireGroupHelp')}>
              <Input value={d.requireGroup} onChange={(e) => set('requireGroup', e.target.value)} placeholder={t('adminDirectory.requireGroupPlaceholder')} />
            </Field>
          </div>
          <div className="col gap-lg" style={{ marginTop: '0.75rem' }}>
            <Switch checked={d.startTls} onChange={(v) => set('startTls', v)} label={t('adminDirectory.startTls')} description={t('adminDirectory.startTlsHelp')} />
            <Switch
              checked={d.rejectUnauthorized}
              onChange={(v) => set('rejectUnauthorized', v)}
              label={t('adminDirectory.verifyCert')}
              description={t('adminDirectory.verifyCertHelp')}
            />
          </div>
        </Card>

        <Card title={t('adminDirectory.fields')}>
          <div className="form-grid">
            <Field label={t('adminDirectory.userFilter')} help={t('adminDirectory.userFilterHelp')}>
              <Input value={d.userFilter} onChange={(e) => set('userFilter', e.target.value)} className="mono" />
            </Field>
            <Field label={t('adminDirectory.userIdAttribute')}>
              <Input value={d.userIdAttribute} onChange={(e) => set('userIdAttribute', e.target.value)} className="mono" />
            </Field>
            <Field label={t('adminDirectory.nameAttribute')}>
              <Input value={d.nameAttribute} onChange={(e) => set('nameAttribute', e.target.value)} className="mono" />
            </Field>
            <Field label={t('adminDirectory.mailAttribute')}>
              <Input value={d.mailAttribute} onChange={(e) => set('mailAttribute', e.target.value)} className="mono" />
            </Field>
            <Field label={t('adminDirectory.groupAttribute')}>
              <Input value={d.groupAttribute} onChange={(e) => set('groupAttribute', e.target.value)} className="mono" />
            </Field>
            <Field label={t('adminDirectory.groupBaseDn')} help={t('adminDirectory.groupBaseDnHelp')}>
              <Input value={d.groupBaseDn} onChange={(e) => set('groupBaseDn', e.target.value)} className="mono" />
            </Field>
          </div>
          <div className="col gap-lg" style={{ marginTop: '0.75rem' }}>
            <Switch
              checked={d.nestedGroups}
              onChange={(v) => set('nestedGroups', v)}
              label={t('adminDirectory.nested')}
              description={t('adminDirectory.nestedHelp')}
            />
            <Switch
              checked={d.autoCreateUsers}
              onChange={(v) => set('autoCreateUsers', v)}
              label={t('adminDirectory.autoCreate')}
              description={t('adminDirectory.autoCreateHelp')}
            />
            <Switch
              checked={d.adoptLocalUsers}
              onChange={(v) => set('adoptLocalUsers', v)}
              label={t('adminDirectory.adopt')}
              description={t('adminDirectory.adoptHelp')}
            />
          </div>
        </Card>

        <Card title={t('adminDirectory.testTitle')}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('adminDirectory.testIntro')}
          </p>
          <div className="form-grid">
            <Field label={t('adminDirectory.sampleLogin')}>
              <Input value={sample.login} onChange={(e) => setSample({ ...sample, login: e.target.value })} placeholder="anna" />
            </Field>
            <Field label={t('adminDirectory.samplePassword')}>
              <Input
                type="password"
                value={sample.password}
                onChange={(e) => setSample({ ...sample, password: e.target.value })}
                autoComplete="off"
              />
            </Field>
          </div>
          <Button icon={TestTube2} loading={testing} onClick={() => void test()}>
            {t('adminDirectory.test')}
          </Button>
          {steps && (
            <ul className="check-list" style={{ marginTop: '0.9rem' }}>
              {steps.map((step, i) => (
                <li key={i} className="row gap-sm" style={{ padding: '0.25rem 0' }}>
                  {step.ok ? <CheckCircle2 size={16} color="var(--success)" /> : <XCircle size={16} color="var(--danger)" />}
                  <strong>{step.label}</strong>
                  <span className="muted small">{step.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('adminDirectory.findGroups')}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('adminDirectory.findGroupsIntro')}
          </p>
          <div className="row gap-sm">
            <Input
              value={groupQuery}
              onChange={(e) => setGroupQuery(e.target.value)}
              placeholder={t('adminDirectory.searchPlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && void searchGroups()}
            />
            <Button icon={Search} onClick={() => void searchGroups()} disabled={!d.enabled}>
              {t('adminDirectory.search')}
            </Button>
          </div>
          {groups && !groups.length && <Alert variant="info">{t('adminDirectory.noGroups')}</Alert>}
          {!!groups?.length && (
            <table className="table" style={{ marginTop: '0.75rem' }}>
              <thead>
                <tr>
                  <th>{t('adminDirectory.name')}</th>
                  <th>DN</th>
                  <th>{t('common.description')}</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.dn}>
                    <td>
                      <Badge color="blue">{g.name}</Badge>
                    </td>
                    <td className="mono tiny">{g.dn}</td>
                    <td className="small muted">{g.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Alert variant="info" title={t('adminDirectory.howTitle')}>
          <ol className="tight">
            <li>{t('adminDirectory.how1')}</li>
            <li>{t('adminDirectory.how2')}</li>
            <li>{t('adminDirectory.how3')}</li>
          </ol>
          <p className="small muted" style={{ marginBottom: 0 }}>
            <ShieldCheck size={13} /> {t('adminDirectory.noPasswords')}
          </p>
        </Alert>
      </div>
    </>
  );
}

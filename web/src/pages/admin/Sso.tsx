import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Fingerprint, KeyRound, MonitorSmartphone, Save, ShieldCheck, TestTube2, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { useI18n } from '../../i18n';
import { ssoLabelText } from '../../lib/built-in-texts';
import { useToast } from '../../lib/toast';
import { Alert, Button, Card, CopyField, Field, Input, Loading, PageHeader, Select, Switch, Textarea } from '../../components/ui';

interface AccountRules {
  autoCreateUsers: boolean;
  adoptExistingUsers: boolean;
  syncGroups: boolean;
  requireGroup: string;
  stripDomain: boolean;
}

export interface OidcSettings extends AccountRules {
  enabled: boolean;
  provider: 'entra' | 'generic';
  label: string;
  tenantId: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  usernameClaim: string;
  nameClaim: string;
  emailClaim: string;
  groupsClaim: string;
}

export interface SamlSettings extends AccountRules {
  enabled: boolean;
  label: string;
  entryPoint: string;
  idpEntityId: string;
  idpCert: string;
  spEntityId: string;
  usernameAttribute: string;
  nameAttribute: string;
  emailAttribute: string;
  groupsAttribute: string;
}

export interface KerberosSettings {
  enabled: boolean;
  label: string;
  header: string;
  trustedProxies: string[];
  proxySecret: string;
  autoLogin: boolean;
  autoCreateUsers: boolean;
}

interface SsoSettings {
  oidc: OidcSettings;
  saml: SamlSettings;
  kerberos: KerberosSettings;
  showLocalLogin: boolean;
}

interface SsoAdminInfo {
  baseUrl: string;
  redirectUri: string;
  acsUrl: string;
  metadataUrl: string;
  spEntityId: string;
  kerberosUrl: string;
  warnings: string[];
  request: { remoteAddress: string; trustedProxy: boolean; headerPresent: boolean };
}

interface TestResult {
  ok: boolean;
  steps: { label: string; ok: boolean; detail: string }[];
}

function Steps({ result }: { result: TestResult | null }) {
  const { t } = useI18n();
  if (!result) return null;
  return (
    <ul className="check-list" style={{ marginTop: '0.75rem' }}>
      {result.steps.map((step, i) => (
        <li key={i} className="row gap-sm" style={{ padding: '0.2rem 0', alignItems: 'flex-start' }}>
          {step.ok ? <CheckCircle2 size={16} color="var(--success)" /> : <XCircle size={16} color="var(--danger)" />}
          <strong>{t(`sso.steps.${step.label}`)}</strong>
          <span className="muted small" style={{ wordBreak: 'break-all' }}>
            {step.detail}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Kontoregeln – für OIDC und SAML gleich. */
function RulesFields<T extends AccountRules>({ value, onChange }: { value: T; onChange: (next: T) => void }) {
  const { t } = useI18n();
  return (
    <>
      <Field label={t('sso.requireGroup')} help={t('sso.requireGroupHelp')}>
        <Input value={value.requireGroup} onChange={(e) => onChange({ ...value, requireGroup: e.target.value })} className="mono" />
      </Field>
      <div className="col gap-lg" style={{ marginTop: '0.5rem' }}>
        <Switch checked={value.syncGroups} onChange={(v) => onChange({ ...value, syncGroups: v })} label={t('sso.syncGroups')} description={t('sso.syncGroupsHelp')} />
        <Switch checked={value.autoCreateUsers} onChange={(v) => onChange({ ...value, autoCreateUsers: v })} label={t('sso.autoCreate')} description={t('sso.autoCreateHelp')} />
        <Switch checked={value.adoptExistingUsers} onChange={(v) => onChange({ ...value, adoptExistingUsers: v })} label={t('sso.adopt')} description={t('sso.adoptHelp')} />
        <Switch checked={value.stripDomain} onChange={(v) => onChange({ ...value, stripDomain: v })} label={t('sso.stripDomain')} description={t('sso.stripDomainHelp')} />
      </div>
    </>
  );
}

/** Administration → Single Sign-on: Entra ID/OIDC, SAML und Windows-Anmeldung. */
export function AdminSso() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<SsoSettings>('/api/v1/admin/settings') });
  const info = useQuery({ queryKey: ['admin-sso'], queryFn: () => api.get<SsoAdminInfo>('/api/v1/admin/sso') });
  const [form, setForm] = useState<SsoSettings | null>(null);
  const [proxies, setProxies] = useState('');
  const [busy, setBusy] = useState(false);
  const [oidcTest, setOidcTest] = useState<TestResult | null>(null);
  const [samlTest, setSamlTest] = useState<TestResult | null>(null);

  useEffect(() => {
    if (!settings.data) return;
    const { oidc, saml, kerberos, showLocalLogin } = settings.data;
    setForm(structuredClone({ oidc, saml, kerberos, showLocalLogin }));
    setProxies(kerberos.trustedProxies.join('\n'));
  }, [settings.data]);

  if (!form || !info.data) return <Loading />;
  const urls = info.data;
  const copied = () => toast.success(t('common.copied'));

  const payload = (): SsoSettings => ({ ...form, kerberos: { ...form.kerberos, trustedProxies: proxies.split(/[\s,;]+/).filter(Boolean) } });

  const save = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const saved = await api.put<SsoSettings>('/api/v1/admin/settings', payload());
      setForm(structuredClone({ oidc: saved.oidc, saml: saved.saml, kerberos: saved.kerberos, showLocalLogin: saved.showLocalLogin }));
      setProxies(saved.kerberos.trustedProxies.join('\n'));
      toast.success(t('common.changesSaved'));
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
      return true;
    } catch (err) {
      toast.error(err);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (kind: 'oidc' | 'saml') => {
    if (!(await save())) return;
    try {
      const result = await api.post<TestResult>(`/api/v1/admin/sso/${kind}/test`);
      if (kind === 'oidc') setOidcTest(result);
      else setSamlTest(result);
    } catch (err) {
      toast.error(err);
    }
  };

  const { oidc, saml, kerberos } = form;
  const setOidc = (next: OidcSettings) => setForm({ ...form, oidc: next });
  const setSaml = (next: SamlSettings) => setForm({ ...form, saml: next });
  const setKerberos = (next: KerberosSettings) => setForm({ ...form, kerberos: next });

  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        title={t('sso.title')}
        subtitle={t('sso.subtitle')}
        actions={
          <Button variant="primary" icon={Save} loading={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        }
      />

      <div className="col gap-lg">
        {urls.warnings.includes('base_url_http') && (
          <Alert variant="warning" title={t('sso.warnHttpTitle')}>
            {t('sso.warnHttp', { url: urls.baseUrl })}
          </Alert>
        )}

        <Card title={t('sso.general')}>
          <Switch checked={form.showLocalLogin} onChange={(v) => setForm({ ...form, showLocalLogin: v })} label={t('sso.showLocal')} description={t('sso.showLocalHelp')} />
          <p className="small muted">{t('sso.groupMappingHint')}</p>
        </Card>

        <Card title={<><KeyRound size={15} /> {t('sso.oidcTitle')}</>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('sso.oidcIntro')}
          </p>
          <Switch checked={oidc.enabled} onChange={(v) => setOidc({ ...oidc, enabled: v })} label={t('sso.oidcEnable')} />
          <Field label={t('sso.redirectUri')} help={t('sso.redirectUriHelp')}>
            <CopyField value={urls.redirectUri} onCopied={copied} />
          </Field>
          <div className="form-grid">
            <Field label={t('sso.provider')}>
              <Select value={oidc.provider} onChange={(e) => setOidc({ ...oidc, provider: e.target.value as OidcSettings['provider'] })}>
                <option value="entra">Microsoft Entra ID</option>
                <option value="generic">{t('sso.providerGeneric')}</option>
              </Select>
            </Field>
            <Field label={t('sso.buttonLabel')}>
              <Input value={ssoLabelText('oidc', oidc.label, t)} onChange={(e) => setOidc({ ...oidc, label: e.target.value })} maxLength={60} />
            </Field>
            {oidc.provider === 'entra' ? (
              <Field label={t('sso.tenantId')} help={t('sso.tenantIdHelp')}>
                <Input value={oidc.tenantId} onChange={(e) => setOidc({ ...oidc, tenantId: e.target.value })} placeholder="00000000-0000-0000-0000-000000000000" className="mono" />
              </Field>
            ) : (
              <Field label={t('sso.issuer')} help={t('sso.issuerHelp')}>
                <Input value={oidc.issuer} onChange={(e) => setOidc({ ...oidc, issuer: e.target.value })} placeholder="https://sso.firma.de/realms/firma" className="mono" />
              </Field>
            )}
            <Field label={t('sso.clientId')}>
              <Input value={oidc.clientId} onChange={(e) => setOidc({ ...oidc, clientId: e.target.value })} className="mono" />
            </Field>
            <Field label={t('sso.clientSecret')} help={t('sso.secretHelp')}>
              <Input type="password" value={oidc.clientSecret} onChange={(e) => setOidc({ ...oidc, clientSecret: e.target.value })} autoComplete="new-password" />
            </Field>
            <Field label={t('sso.scopes')}>
              <Input value={oidc.scopes} onChange={(e) => setOidc({ ...oidc, scopes: e.target.value })} className="mono" />
            </Field>
            <Field label={t('sso.usernameClaim')}>
              <Input value={oidc.usernameClaim} onChange={(e) => setOidc({ ...oidc, usernameClaim: e.target.value })} className="mono" />
            </Field>
            <Field label={t('sso.nameClaim')}>
              <Input value={oidc.nameClaim} onChange={(e) => setOidc({ ...oidc, nameClaim: e.target.value })} className="mono" />
            </Field>
            <Field label={t('sso.emailClaim')}>
              <Input value={oidc.emailClaim} onChange={(e) => setOidc({ ...oidc, emailClaim: e.target.value })} className="mono" />
            </Field>
            <Field label={t('sso.groupsClaim')} help={t('sso.groupsClaimHelp')}>
              <Input value={oidc.groupsClaim} onChange={(e) => setOidc({ ...oidc, groupsClaim: e.target.value })} className="mono" />
            </Field>
          </div>
          <RulesFields value={oidc} onChange={setOidc} />
          <div className="form-actions">
            <Button icon={TestTube2} onClick={() => void runTest('oidc')}>
              {t('sso.test')}
            </Button>
          </div>
          <Steps result={oidcTest} />
        </Card>

        <Card title={<><Fingerprint size={15} /> {t('sso.samlTitle')}</>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('sso.samlIntro')}
          </p>
          <Switch checked={saml.enabled} onChange={(v) => setSaml({ ...saml, enabled: v })} label={t('sso.samlEnable')} />
          <div className="form-grid">
            <Field label={t('sso.spEntityId')} help={t('sso.spEntityIdHelp')}>
              <CopyField value={urls.spEntityId} onCopied={copied} />
            </Field>
            <Field label={t('sso.acsUrl')}>
              <CopyField value={urls.acsUrl} onCopied={copied} />
            </Field>
            <Field label={t('sso.metadataUrl')} help={t('sso.metadataHelp')}>
              <CopyField value={urls.metadataUrl} onCopied={copied} />
            </Field>
            <Field label={t('sso.buttonLabel')}>
              <Input value={ssoLabelText('saml', saml.label, t)} onChange={(e) => setSaml({ ...saml, label: e.target.value })} maxLength={60} />
            </Field>
            <Field label={t('sso.entryPoint')} help={t('sso.entryPointHelp')}>
              <Input value={saml.entryPoint} onChange={(e) => setSaml({ ...saml, entryPoint: e.target.value })} placeholder="https://login.microsoftonline.com/…/saml2" className="mono" />
            </Field>
            <Field label={t('sso.idpEntityId')} help={t('sso.idpEntityIdHelp')}>
              <Input value={saml.idpEntityId} onChange={(e) => setSaml({ ...saml, idpEntityId: e.target.value })} placeholder="https://sts.windows.net/…/" className="mono" />
            </Field>
            <Field label={t('sso.ownEntityId')} help={t('sso.ownEntityIdHelp')}>
              <Input value={saml.spEntityId} onChange={(e) => setSaml({ ...saml, spEntityId: e.target.value })} placeholder={urls.metadataUrl} className="mono" />
            </Field>
          </div>
          <Field label={t('sso.idpCert')} help={t('sso.idpCertHelp')}>
            <Textarea rows={5} className="mono" value={saml.idpCert} onChange={(e) => setSaml({ ...saml, idpCert: e.target.value })} placeholder={'-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----'} />
          </Field>
          <div className="form-grid">
            <Field label={t('sso.usernameAttribute')} help={t('sso.usernameAttributeHelp')}>
              <Input value={saml.usernameAttribute} onChange={(e) => setSaml({ ...saml, usernameAttribute: e.target.value })} className="mono" />
            </Field>
            <Field label={t('sso.nameAttribute')}>
              <Input value={saml.nameAttribute} onChange={(e) => setSaml({ ...saml, nameAttribute: e.target.value })} className="mono" />
            </Field>
            <Field label={t('sso.emailAttribute')}>
              <Input value={saml.emailAttribute} onChange={(e) => setSaml({ ...saml, emailAttribute: e.target.value })} className="mono" />
            </Field>
            <Field label={t('sso.groupsAttribute')}>
              <Input value={saml.groupsAttribute} onChange={(e) => setSaml({ ...saml, groupsAttribute: e.target.value })} className="mono" />
            </Field>
          </div>
          <RulesFields value={saml} onChange={setSaml} />
          <div className="form-actions">
            <Button icon={TestTube2} onClick={() => void runTest('saml')}>
              {t('sso.test')}
            </Button>
          </div>
          <Steps result={samlTest} />
        </Card>

        <Card title={<><MonitorSmartphone size={15} /> {t('sso.kerberosTitle')}</>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('sso.kerberosIntro')}
          </p>
          <Switch checked={kerberos.enabled} onChange={(v) => setKerberos({ ...kerberos, enabled: v })} label={t('sso.kerberosEnable')} />
          <Field label={t('sso.kerberosUrl')} help={t('sso.kerberosUrlHelp')}>
            <CopyField value={urls.kerberosUrl} onCopied={copied} />
          </Field>
          <div className="form-grid">
            <Field label={t('sso.buttonLabel')}>
              <Input value={ssoLabelText('kerberos', kerberos.label, t)} onChange={(e) => setKerberos({ ...kerberos, label: e.target.value })} maxLength={60} />
            </Field>
            <Field label={t('sso.header')} help={t('sso.headerHelp')}>
              <Input value={kerberos.header} onChange={(e) => setKerberos({ ...kerberos, header: e.target.value })} className="mono" />
            </Field>
            <Field label={t('sso.trustedProxies')} help={t('sso.trustedProxiesHelp')}>
              <Textarea rows={3} className="mono" value={proxies} onChange={(e) => setProxies(e.target.value)} />
            </Field>
            <Field label={t('sso.proxySecret')} help={t('sso.proxySecretHelp')}>
              <Input type="password" value={kerberos.proxySecret} onChange={(e) => setKerberos({ ...kerberos, proxySecret: e.target.value })} autoComplete="new-password" />
            </Field>
          </div>
          <div className="col gap-lg" style={{ marginTop: '0.5rem' }}>
            <Switch checked={kerberos.autoLogin} onChange={(v) => setKerberos({ ...kerberos, autoLogin: v })} label={t('sso.autoLogin')} description={t('sso.autoLoginHelp')} />
            <Switch checked={kerberos.autoCreateUsers} onChange={(v) => setKerberos({ ...kerberos, autoCreateUsers: v })} label={t('sso.kerberosAutoCreate')} description={t('sso.kerberosAutoCreateHelp')} />
          </div>
          <p className="small muted">
            {t('sso.currentRequest', { address: urls.request.remoteAddress || '–' })}{' '}
            {urls.request.trustedProxy ? t('sso.requestTrusted') : t('sso.requestUntrusted')}
          </p>
        </Card>
      </div>
    </>
  );
}

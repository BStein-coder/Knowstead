import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, BrainCircuit, CheckCircle2, FileText, PenTool, Save, ScanText, ShieldAlert, TestTube2, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Alert, Badge, Button, Card, Checkbox, Field, Input, Loading, PageHeader, Select, Switch, Textarea, Time } from '../../components/ui';

interface AiSettings {
  enabled: boolean;
  provider: 'anthropic' | 'openai' | 'azure' | 'ollama' | 'custom';
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  sendTemperature: boolean;
  temperature: number;
  actions: string[];
  dailyLimit: number;
  systemPrompt: string;
}

interface SettingsSubset {
  ai: AiSettings;
  officePreview: { enabled: boolean; sofficePath: string };
  ocr: { enabled: boolean; tesseractPath: string; languages: string; maxPages: number };
  drawioUrl: string;
}

interface OcrStatus {
  enabled: boolean;
  found: boolean;
  path: string | null;
  version: string | null;
  languages: string[];
  missingLanguages: string[];
  error: string | null;
  recognized: number;
}

interface Usage {
  since: string;
  totals: { requests: number; input: number; output: number; failed: number };
  perAction: { action: string; n: number }[];
  perUser: { name: string; n: number }[];
  recent: { action: string; model: string; created_at: string; ok: number; error: string | null; name: string | null }[];
  actions: Record<string, string>;
}

const PROVIDERS: { value: AiSettings['provider']; label: string; hint: string; models: string[]; needsUrl: boolean; needsKey: boolean }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)', hint: 'adminAi.hints.anthropic', models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'], needsUrl: false, needsKey: true },
  { value: 'openai', label: 'OpenAI', hint: 'adminAi.hints.openai', models: [], needsUrl: false, needsKey: true },
  { value: 'azure', label: 'Azure OpenAI', hint: 'adminAi.hints.azure', models: [], needsUrl: true, needsKey: true },
  { value: 'ollama', label: 'adminAi.providers.ollama', hint: 'adminAi.hints.ollama', models: ['llama3.1', 'mistral', 'qwen2.5'], needsUrl: true, needsKey: false },
  { value: 'custom', label: 'adminAi.providers.custom', hint: 'adminAi.hints.custom', models: [], needsUrl: true, needsKey: true },
];

/** Administration → KI & Dateien: KI-Anbindung, Office-Vorschau, draw.io. */
export function AdminAi() {
  const { t, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<SettingsSubset>('/api/v1/admin/settings') });
  const usage = useQuery({ queryKey: ['admin-ai-usage'], queryFn: () => api.get<Usage>('/api/v1/admin/ai/usage') });
  const office = useQuery({ queryKey: ['admin-office-preview'], queryFn: () => api.get<{ enabled: boolean; path: string | null; cached: number }>('/api/v1/admin/office-preview') });
  const [s, setS] = useState<SettingsSubset | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string; sample?: string } | null>(null);

  useEffect(() => {
    if (data) setS({ ai: structuredClone(data.ai), officePreview: structuredClone(data.officePreview), ocr: structuredClone(data.ocr), drawioUrl: data.drawioUrl });
  }, [data]);

  if (isLoading || !s) return <Loading />;
  const ai = s.ai;
  const provider = PROVIDERS.find((p) => p.value === ai.provider) ?? PROVIDERS[0];
  const setAi = (patch: Partial<AiSettings>) => setS({ ...s, ai: { ...ai, ...patch } });

  const save = async () => {
    setBusy(true);
    try {
      const saved = await api.put<SettingsSubset>('/api/v1/admin/settings', s);
      setS({ ai: structuredClone(saved.ai), officePreview: structuredClone(saved.officePreview), ocr: structuredClone(saved.ocr), drawioUrl: saved.drawioUrl });
      toast.success(t('common.changesSaved'));
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['ai-status'] });
      void qc.invalidateQueries({ queryKey: ['admin-office-preview'] });
      void qc.invalidateQueries({ queryKey: ['admin-ocr'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      await api.put('/api/v1/admin/settings', { ai: s.ai });
      setTest(await api.post('/api/v1/admin/ai/test', {}));
      void qc.invalidateQueries({ queryKey: ['admin-ai-usage'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setTesting(false);
    }
  };

  const actionLabels = usage.data?.actions ?? {};

  return (
    <>
      <PageHeader
        icon={BrainCircuit}
        title={t('adminAi.title')}
        subtitle={t('adminAi.subtitle')}
        actions={
          <Button variant="primary" icon={Save} loading={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        }
      />
      <div className="col gap-lg">
        <Card title={t('adminAi.connection')}>
          <Alert variant="warning" title={t('adminAi.privacy')}>
            {t('adminAi.privacyText')}
          </Alert>
          <div className="col gap-lg" style={{ margin: '0.9rem 0' }}>
            <Switch checked={ai.enabled} onChange={(v) => setAi({ enabled: v })} label={t('adminAi.enable')} description={t('adminAi.enableHelp')} />
          </div>
          <div className="form-grid">
            <Field label={t('adminAi.provider')} help={t(provider.hint)}>
              <Select value={ai.provider} onChange={(e) => setAi({ provider: e.target.value as AiSettings['provider'] })}>
                {PROVIDERS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label.startsWith('adminAi.') ? t(p.label) : p.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('adminAi.model')} help={provider.models.length ? t('adminAi.suggestions', { list: provider.models.join(', ') }) : t('adminAi.modelHelp')}>
              <Input value={ai.model} onChange={(e) => setAi({ model: e.target.value })} list="ai-models" className="mono" aria-label={t('adminAi.model')} />
              <datalist id="ai-models">
                {provider.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            {(provider.needsUrl || ai.baseUrl) && (
              <Field label={t('adminAi.baseUrl')}>
                <Input value={ai.baseUrl} onChange={(e) => setAi({ baseUrl: e.target.value })} placeholder={ai.provider === 'ollama' ? 'http://localhost:11434' : 'https://…'} className="mono" />
              </Field>
            )}
            {provider.needsKey && (
              <Field label={t('adminAi.apiKey')} help={t('adminAi.encrypted')}>
                <Input type="password" value={ai.apiKey} onChange={(e) => setAi({ apiKey: e.target.value })} autoComplete="new-password" />
              </Field>
            )}
            <Field label={t('adminAi.maxTokens')}>
              <Input type="number" min={100} max={32000} value={ai.maxTokens} onChange={(e) => setAi({ maxTokens: Number(e.target.value) })} />
            </Field>
            <Field label={t('adminAi.dailyLimit')} help={t('adminAi.unlimited')}>
              <Input type="number" min={0} value={ai.dailyLimit} onChange={(e) => setAi({ dailyLimit: Number(e.target.value) })} />
            </Field>
          </div>
          <div style={{ height: '1rem' }} />
          <Field label={t('adminAi.actions')}>
            <div className="check-grid">
              {Object.entries(actionLabels).map(([key, label]) => (
                <Checkbox key={key} checked={ai.actions.includes(key)} onChange={(on) => setAi({ actions: on ? [...ai.actions, key] : ai.actions.filter((a) => a !== key) })} label={label} />
              ))}
            </div>
          </Field>
          <Field label={t('adminAi.systemPrompt')} help={t('adminAi.systemPromptHelp')}>
            <Textarea rows={2} value={ai.systemPrompt} onChange={(e) => setAi({ systemPrompt: e.target.value })} placeholder={t('adminAi.systemPromptPlaceholder')} />
          </Field>
          {ai.provider !== 'anthropic' && (
            <div className="row gap-lg">
              <Checkbox checked={ai.sendTemperature} onChange={(v) => setAi({ sendTemperature: v })} label={t('adminAi.temperature')} />
              {ai.sendTemperature && <Input type="number" step={0.1} min={0} max={2} value={ai.temperature} onChange={(e) => setAi({ temperature: Number(e.target.value) })} style={{ width: 90 }} />}
            </div>
          )}
          <div className="row gap-sm" style={{ marginTop: '0.9rem' }}>
            <Button icon={TestTube2} loading={testing} onClick={() => void runTest()}>
              {t('adminAi.test')}
            </Button>
            {test && (
              <span className="row gap-xs small">
                {test.ok ? <CheckCircle2 size={16} color="var(--success)" /> : <XCircle size={16} color="var(--danger)" />}
                {test.message}
              </span>
            )}
          </div>
          {test?.sample && <blockquote className="ai-sample">{test.sample}</blockquote>}
        </Card>

        <Card title={<><BarChart3 size={15} /> {t('adminAi.usage')}</>}>
          {usage.isLoading ? (
            <Loading inline />
          ) : usage.data ? (
            <>
              <div className="stat-row">
                <div className="stat">
                  <span className="stat-value">{usage.data.totals.requests}</span>
                  <span className="stat-label">{t('adminAi.requests')}</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{(usage.data.totals.input + usage.data.totals.output).toLocaleString(locale === 'en' ? 'en-GB' : 'de-DE')}</span>
                  <span className="stat-label">{t('adminAi.tokens')}</span>
                </div>
                <div className="stat">
                  <span className="stat-value">{usage.data.totals.failed}</span>
                  <span className="stat-label">{t('adminAi.failed')}</span>
                </div>
              </div>
              <div className="form-grid">
                <div>
                  <h4 className="section-title">{t('adminAi.byAction')}</h4>
                  {usage.data.perAction.map((a) => (
                    <div key={a.action} className="row small">
                      <span className="grow">{actionLabels[a.action] ?? a.action}</span>
                      <Badge>{a.n}</Badge>
                    </div>
                  ))}
                </div>
                <div>
                  <h4 className="section-title">{t('adminAi.byUser')}</h4>
                  {usage.data.perUser.map((u) => (
                    <div key={u.name} className="row small">
                      <span className="grow">{u.name}</span>
                      <Badge>{u.n}</Badge>
                    </div>
                  ))}
                </div>
              </div>
              {usage.data.recent.some((r) => !r.ok) && (
                <>
                  <h4 className="section-title">{t('adminAi.recentErrors')}</h4>
                  {usage.data.recent
                    .filter((r) => !r.ok)
                    .slice(0, 5)
                    .map((r, i) => (
                      <div key={i} className="small row gap-xs">
                        <ShieldAlert size={13} color="var(--danger)" /> <Time value={r.created_at} /> · {actionLabels[r.action] ?? r.action}: {r.error}
                      </div>
                    ))}
                </>
              )}
            </>
          ) : null}
        </Card>

        <Card title={<><FileText size={15} /> {t('adminAi.officeTitle')}</>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('adminAi.officeIntro')}
          </p>
          <div className="col gap-lg">
            <Switch
              checked={s.officePreview.enabled}
              onChange={(v) => setS({ ...s, officePreview: { ...s.officePreview, enabled: v } })}
              label={t('adminAi.officeEnable')}
              description={t('adminAi.officeEnableHelp')}
            />
          </div>
          <Field label={t('adminAi.sofficePath')} help={t('adminAi.sofficePathHelp')}>
            <Input
              value={s.officePreview.sofficePath}
              onChange={(e) => setS({ ...s, officePreview: { ...s.officePreview, sofficePath: e.target.value } })}
              placeholder="C:\Program Files\LibreOffice\program\soffice.exe"
              className="mono"
            />
          </Field>
          {office.data && (
            <p className="small">
              {office.data.path ? (
                <>
                  <CheckCircle2 size={14} color="var(--success)" /> {t('adminAi.found')} <code>{office.data.path}</code> · {t('adminAi.cached', { n: office.data.cached })}
                </>
              ) : (
                <>
                  <XCircle size={14} color="var(--danger)" /> {office.data.enabled ? t('adminAi.officeNotFound') : t('adminAi.disabled')}
                </>
              )}
            </p>
          )}
        </Card>

        <OcrCard value={s.ocr} onChange={(ocr) => setS({ ...s, ocr })} />

        <Card title={<><PenTool size={15} /> {t('adminAi.drawio')}</>}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('adminAi.drawioIntro')}
          </p>
          <Field label={t('adminAi.drawioUrl')}>
            <Input value={s.drawioUrl} onChange={(e) => setS({ ...s, drawioUrl: e.target.value })} placeholder="https://embed.diagrams.net" className="mono" />
          </Field>
        </Card>
      </div>
    </>
  );
}

/** Texterkennung (OCR) mit Tesseract für eingescannte PDFs und Bilder. */
function OcrCard({ value, onChange }: { value: SettingsSubset['ocr']; onChange: (v: SettingsSubset['ocr']) => void }) {
  const { t } = useI18n();
  const status = useQuery({ queryKey: ['admin-ocr'], queryFn: () => api.get<OcrStatus>('/api/v1/admin/ocr') });
  const st = status.data;
  return (
    <Card title={<><ScanText size={15} /> {t('adminOcr.title')}</>}>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('adminOcr.intro')}
      </p>
      <Switch checked={value.enabled} onChange={(v) => onChange({ ...value, enabled: v })} label={t('adminOcr.enable')} description={t('adminOcr.enableHelp')} />
      <Field label={t('adminOcr.path')} help={t('adminOcr.pathHelp')}>
        <Input value={value.tesseractPath} onChange={(e) => onChange({ ...value, tesseractPath: e.target.value })} placeholder="C:\Program Files\Tesseract-OCR\tesseract.exe" className="mono" />
      </Field>
      <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
        <Field label={t('adminOcr.languages')} help={t('adminOcr.languagesHelp')}>
          <Input value={value.languages} onChange={(e) => onChange({ ...value, languages: e.target.value })} className="mono" style={{ width: 200 }} />
        </Field>
        <Field label={t('adminOcr.maxPages')}>
          <Input type="number" min={1} max={200} value={value.maxPages} onChange={(e) => onChange({ ...value, maxPages: Number(e.target.value) || 1 })} style={{ width: 120 }} />
        </Field>
      </div>
      {st && (
        <div className="small col gap-xs">
          {st.found ? (
            <span>
              <CheckCircle2 size={14} color="var(--success)" /> {t('adminOcr.found', { path: st.path ?? '' })} {st.version && <code>{st.version}</code>}
            </span>
          ) : (
            <span>
              <XCircle size={14} color="var(--danger)" /> {t('adminOcr.notFound')}
            </span>
          )}
          {st.error && <span className="danger-text">{st.error}</span>}
          {st.missingLanguages.length > 0 && <span className="danger-text">{t('adminOcr.missingLanguages', { list: st.missingLanguages.join(', ') })}</span>}
          {st.languages.length > 0 && <span className="muted">{t('adminOcr.installed', { list: st.languages.join(', ') })}</span>}
          <span className="muted">{t('adminOcr.recognized', { n: st.recognized })}</span>
        </div>
      )}
    </Card>
  );
}

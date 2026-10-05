import { useState } from 'react';
import { Navigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, CheckCircle2, ListChecks, Network, Rocket, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { Alert, Button, Checkbox, Field, Input, Loading, Select, cx } from '../../components/ui';
import { ColorPicker } from '../../components/Pickers';
import { AuthCard } from './AuthPages';

/**
 * Ersteinrichtung in drei Schritten: Grunddaten → Administratorkonto → fertig.
 * Danach führt der Rundgang direkt in die Oberfläche.
 */
export function SetupPage() {
  const { t, locale, setLocale } = useI18n();
  const { data, loading } = useAuth();
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [siteName, setSiteName] = useState('Knowstead');
  const [accentColor, setAccentColor] = useState('#2563eb');
  const [form, setForm] = useState({ displayName: '', username: 'admin', email: '', password: '', repeat: '' });
  const [sample, setSample] = useState(true);
  const [setupCode, setSetupCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (data && !data.needsSetup && step < 3) return <Navigate to="/" replace />;
  const min = data?.settings.passwordMinLength ?? 10;
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const finish = async () => {
    if (form.password !== form.repeat) {
      setError(t('auth.passwordMismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/v1/setup', {
        siteName,
        username: form.username,
        displayName: form.displayName || form.username,
        email: form.email || undefined,
        password: form.password,
        locale,
        accentColor,
        sampleContent: sample,
        setupCode: data?.setupCodeRequired ? setupCode : undefined,
      });
      await qc.invalidateQueries({ queryKey: ['me'] });
      setBusy(false);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <AuthCard title={step === 3 ? t('auth.setupDone') : t('auth.setupTitle')} subtitle={step === 3 ? undefined : t('auth.setupSubtitle')} wide>
      <div className="steps">
        <div className={cx('step', step >= 1 && 'done')} />
        <div className={cx('step', step >= 2 && 'done')} />
        <div className={cx('step', step >= 3 && 'done')} />
      </div>
      {error && (
        <div className="mb-2">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      {step === 1 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setStep(2);
          }}
        >
          <h3 className="mb-2">{t('auth.setupStep1')}</h3>
          <Field label={t('auth.setupSite')}>
            <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} autoFocus required />
          </Field>
          <div className="form-grid">
            <Field label={t('app.language')}>
              <Select value={locale} onChange={(e) => setLocale(e.target.value as 'de' | 'en')}>
                <option value="de">Deutsch</option>
                <option value="en">English</option>
              </Select>
            </Field>
            <Field label={t('auth.setupAccent')}>
              <ColorPicker value={accentColor} onChange={(c) => setAccentColor(c ?? '#2563eb')} />
            </Field>
          </div>
          <div className="mb-2">
            <Checkbox checked={sample} onChange={setSample} label={t('auth.setupSample')} />
          </div>
          <Button type="submit" variant="primary" block iconRight={ArrowRight}>
            {t('common.next')}
          </Button>
        </form>
      )}

      {step === 2 && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void finish();
          }}
        >
          <h3 className="mb-2">{t('auth.setupAdmin')}</h3>
          {data?.setupCodeRequired && (
            <Field label={t('auth.setupCode')} help={t('auth.setupCodeHelp')}>
              <Input value={setupCode} onChange={(e) => setSetupCode(e.target.value)} placeholder="XXXX-XXXX" autoComplete="off" autoFocus required />
            </Field>
          )}
          <div className="form-grid">
            <Field label={t('auth.displayName')}>
              <Input value={form.displayName} onChange={set('displayName')} autoFocus={!data?.setupCodeRequired} placeholder={t('auth.displayNamePlaceholder')} required />
            </Field>
            <Field label={t('auth.username')}>
              <Input value={form.username} onChange={set('username')} autoComplete="username" required />
            </Field>
          </div>
          <Field label={t('auth.email')} help={t('common.optional')}>
            <Input type="email" value={form.email} onChange={set('email')} autoComplete="email" />
          </Field>
          <div className="form-grid">
            <Field label={t('auth.password')} help={t('auth.passwordHint', { n: min })}>
              <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={min} required />
            </Field>
            <Field label={t('auth.passwordRepeat')}>
              <Input type="password" value={form.repeat} onChange={set('repeat')} autoComplete="new-password" required />
            </Field>
          </div>
          <div className="row">
            <Button onClick={() => setStep(1)}>{t('common.back')}</Button>
            <span className="spacer" />
            <Button type="submit" variant="primary" icon={Rocket} loading={busy}>
              {t('auth.setupFinish')}
            </Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <div className="col gap-lg">
          <Alert variant="success" title={t('auth.setupDoneTitle')}>
            {t('auth.setupDoneText', { site: siteName })}
          </Alert>
          <ul className="setup-hints">
            <li>
              <BookOpen size={15} /> {t('auth.setupHintHandbook')}
            </li>
            <li>
              <Network size={15} /> {t('auth.setupHintDirectory')}
            </li>
            <li>
              <CheckCircle2 size={15} /> {t('auth.setupHintBackup')}
            </li>
          </ul>
          <Button variant="primary" icon={ListChecks} block onClick={() => (window.location.href = '/admin/setup?tour=0')}>
            {t('auth.setupFinishConfig')}
          </Button>
          <div className="row gap-sm">
            <Button icon={Sparkles} block onClick={() => (window.location.href = '/?tour=1')}>
              {t('onboarding.start')}
            </Button>
            <Button variant="ghost" block onClick={() => (window.location.href = '/')}>
              {t('onboarding.skip')}
            </Button>
          </div>
        </div>
      )}
    </AuthCard>
  );
}

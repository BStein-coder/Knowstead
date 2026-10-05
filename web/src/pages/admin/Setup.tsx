import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Circle, EyeOff, ListChecks, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import type { SetupChecklist, SetupChecklistItem } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Alert, Badge, Button, Card, ErrorView, Loading, PageHeader, Switch, cx } from '../../components/ui';

export function useSetupChecklist(enabled = true) {
  return useQuery({ queryKey: ['setup-checklist'], queryFn: () => api.get<SetupChecklist>('/api/v1/admin/setup-checklist'), enabled });
}

function Progress({ done, total }: { done: number; total: number }) {
  const { t } = useI18n();
  const percent = total ? Math.round((done / total) * 100) : 100;
  return (
    <div className="setup-progress">
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={t('adminSetup.progress', { done, total })}>
        <div style={{ width: `${percent}%` }} />
      </div>
      <span className="small muted">{t('adminSetup.progress', { done, total })}</span>
    </div>
  );
}

/** Hinweis in der Administrationsübersicht, solange Pflichtpunkte offen sind. */
export function SetupChecklistCard() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const query = useSetupChecklist();
  const data = query.data;
  if (!data || data.dismissed || data.done >= data.total) return null;
  const hide = async () => {
    qc.setQueryData(['setup-checklist'], await api.put<SetupChecklist>('/api/v1/admin/setup-checklist', { dismissed: true }));
  };
  // Zuerst, was sich direkt in der Oberfläche erledigen lässt – Adresse und Autostart stehen in der Serverkonfiguration
  const inApp = ['mail', 'backup', 'users', 'spaces'];
  const next = data.items.find((item) => item.state === 'open' && inApp.includes(item.id)) ?? data.items.find((item) => item.state === 'open');
  return (
    <Card className="setup-card mb-3">
      <div className="row gap-md setup-card-body">
        <span className="setup-card-icon" aria-hidden>
          <ListChecks size={22} />
        </span>
        <div className="grow">
          <strong className="setup-card-title">{t('adminSetup.overviewTitle')}</strong>
          <p className="small muted mb-2">{next ? t('adminSetup.overviewNext', { item: t(`adminSetup.items.${next.id}.title`) }) : t('adminSetup.subtitle')}</p>
          <Progress done={data.done} total={data.total} />
        </div>
        <div className="row gap-sm setup-card-actions">
          <Link to="/admin/setup" className="btn btn-primary">
            {t('adminSetup.continue')} <ArrowRight size={15} />
          </Link>
          <Button variant="ghost" icon={EyeOff} onClick={() => void hide()}>
            {t('adminSetup.hide')}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ItemActions({ item, onBackup, backingUp }: { item: SetupChecklistItem; onBackup: () => void; backingUp: boolean }) {
  const { t } = useI18n();
  const link = (to: string, label: string, primary = false) => (
    <Link to={to} className={cx('btn', primary ? 'btn-primary' : 'btn-secondary', 'btn-sm')}>
      {label}
    </Link>
  );
  const primary = item.state === 'open';
  switch (item.id) {
    case 'mail':
      return link('/admin/mail', t('adminSetup.items.mail.action'), primary);
    case 'backup':
      return (
        <>
          <Button size="sm" variant={primary ? 'primary' : 'secondary'} loading={backingUp} onClick={onBackup}>
            {t('adminSetup.items.backup.action')}
          </Button>
          {link('/admin/backups', t('adminSetup.items.backup.settings'))}
        </>
      );
    case 'users':
      return link('/admin/users', t('adminSetup.items.users.action'), primary);
    case 'spaces':
      return link('/spaces', t('adminSetup.items.spaces.action'), primary);
    case 'login':
      return (
        <>
          {link('/admin/directory', t('adminSetup.items.login.directory'))}
          {link('/admin/sso', t('adminSetup.items.login.sso'))}
        </>
      );
    case 'extras':
      return link('/admin/ai', t('adminSetup.items.extras.action'));
    default:
      return null;
  }
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function ItemDetail({ item }: { item: SetupChecklistItem }) {
  const { t, fmt } = useI18n();
  switch (item.id) {
    case 'address': {
      const mismatch = !!item.detail && originOf(item.detail) !== null && originOf(item.detail) !== window.location.origin;
      return (
        <>
          <p className="small">
            {t('adminSetup.items.address.current')} <code>{item.detail}</code>
          </p>
          {mismatch && (
            <Alert variant="warning">{t('adminSetup.items.address.mismatch', { browser: window.location.origin, configured: item.detail ?? '' })}</Alert>
          )}
        </>
      );
    }
    case 'service':
      return item.detail ? <p className="small">{t(`adminSetup.items.service.modes.${item.detail}`)}</p> : null;
    case 'backup':
      return item.detail ? <p className="small">{t('adminSetup.items.backup.newest', { date: fmt.dateTime(item.detail) })}</p> : null;
    case 'mail':
      return item.detail ? (
        <p className="small">
          {t('adminSetup.items.mail.server')} <code>{item.detail}</code>
        </p>
      ) : null;
    default:
      return null;
  }
}

/** Administration → Nächste Schritte: geführte Liste mit Stand und Sprung zur passenden Seite. */
export function AdminSetup() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const query = useSetupChecklist();
  const [backingUp, setBackingUp] = useState(false);
  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorView error={query.error} />;
  const data = query.data;

  const backup = async () => {
    setBackingUp(true);
    try {
      await api.post('/api/v1/admin/backups', {});
      toast.success(t('adminSetup.items.backup.created'));
      await qc.invalidateQueries({ queryKey: ['setup-checklist'] });
      void qc.invalidateQueries({ queryKey: ['admin-backups'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBackingUp(false);
    }
  };
  const setDismissed = async (dismissed: boolean) => {
    qc.setQueryData(['setup-checklist'], await api.put<SetupChecklist>('/api/v1/admin/setup-checklist', { dismissed }));
  };

  const OPTIONAL = ['login', 'extras'];
  const required = data.items.filter((item) => !OPTIONAL.includes(item.id));
  const optional = data.items.filter((item) => OPTIONAL.includes(item.id));

  const renderItem = (item: SetupChecklistItem) => (
    <li key={item.id} className={cx('setup-item', `setup-item-${item.state}`)} data-item={item.id}>
      <span className="setup-item-icon" aria-hidden>
        {item.state === 'done' ? <CheckCircle2 size={20} /> : item.state === 'optional' ? <Sparkles size={20} /> : <Circle size={20} />}
      </span>
      <div className="grow">
        <div className="row gap-sm">
          <strong>{t(`adminSetup.items.${item.id}.title`)}</strong>
          <Badge color={item.state === 'done' ? 'green' : item.state === 'optional' ? 'gray' : 'yellow'}>{t(`adminSetup.state.${item.state}`)}</Badge>
        </div>
        <p className="small muted mb-1">{t(`adminSetup.items.${item.id}.${item.state === 'done' ? 'done' : 'open'}`)}</p>
        <ItemDetail item={item} />
        <div className="row gap-sm setup-item-actions">
          <ItemActions item={item} onBackup={() => void backup()} backingUp={backingUp} />
        </div>
      </div>
    </li>
  );

  return (
    <>
      <PageHeader icon={ListChecks} title={t('adminSetup.title')} subtitle={t('adminSetup.subtitle')} />
      <div className="col gap-lg">
        <Card>
          {data.done >= data.total ? (
            <Alert variant="success" title={t('adminSetup.allDoneTitle')}>
              {t('adminSetup.allDone')}
            </Alert>
          ) : (
            <Progress done={data.done} total={data.total} />
          )}
          <div className="mt-2">
            <Switch checked={!data.dismissed} onChange={(v) => void setDismissed(!v)} label={t('adminSetup.showOnOverview')} />
          </div>
        </Card>
        <Card title={t('adminSetup.required')}>
          <ul className="setup-list">{required.map(renderItem)}</ul>
        </Card>
        <Card title={t('adminSetup.optional')}>
          <ul className="setup-list">{optional.map(renderItem)}</ul>
        </Card>
      </div>
    </>
  );
}

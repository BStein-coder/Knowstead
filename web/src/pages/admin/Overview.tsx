import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, Server } from 'lucide-react';
import { api } from '../../api/client';
import type { UserRef } from '../../api/types';
import { useI18n } from '../../i18n';
import { Avatar, Card, ErrorView, Loading, PageHeader, Time } from '../../components/ui';
import { SetupChecklistCard } from './Setup';

interface Stats {
  counts: Record<string, number>;
  storage: { database: number; attachments: number };
  activity: { day: string; edits: number }[];
  topPages: { id: number; title: string; view_count: number; url: string }[];
  topContributors: { user: UserRef | null; edits: number }[];
}

interface SystemInfo {
  version: string;
  schemaVersion: number;
  node: string;
  platform: string;
  hostname: string;
  startedAt: string;
  uptimeSeconds: number;
  memory: { rss: number; heapUsed: number };
  dataDir: string;
  pluginsDir: string;
  baseUrl: string;
  sqlite: string;
  realtime: { connections: number; activePages: number };
  pluginsLoaded: number;
  mailConfigured: boolean;
  service: string | null;
  logFile: string | null;
  packageBuiltAt: string | null;
  /** Programmdateien seit dem Start ersetzt, aktualisiert oder entfernt – der Server läuft noch mit dem alten Stand */
  restartRequired: 'missing' | 'replaced' | 'updated' | null;
}

/** Betriebswarnungen (Sicherung, Speicherplatz, Neustart) – Texte kommen in der Sprache der Oberfläche vom Server */
export interface AdminAlerts {
  alerts: { id: string; severity: 'warn' | 'error'; title: string; message: string; hint: string; since: string }[];
  mail: { enabled: boolean; configured: boolean; recipients: number };
}

const SERVICE_MODES = new Set(['task', 'nssm', 'systemd', 'docker']);

const LABELS: Record<string, string> = {
  users: 'adminOverview.counts.users',
  activeUsers: 'adminOverview.counts.activeUsers',
  spaces: 'adminOverview.counts.spaces',
  pages: 'adminOverview.counts.pages',
  revisions: 'adminOverview.counts.revisions',
  comments: 'adminOverview.counts.comments',
  attachments: 'adminOverview.counts.attachments',
  drafts: 'adminOverview.counts.drafts',
  trashed: 'adminOverview.counts.trashed',
  groups: 'adminOverview.counts.groups',
  personalSpaces: 'adminOverview.counts.personalSpaces',
  templates: 'adminOverview.counts.templates',
  webhooks: 'adminOverview.counts.webhooks',
  connectors: 'adminOverview.counts.connectors',
  tokens: 'adminOverview.counts.tokens',
  bots: 'adminOverview.counts.bots',
  archivedSpaces: 'adminOverview.counts.archivedSpaces',
  events: 'adminOverview.counts.events',
};

export function AdminOverview() {
  const { t, fmt } = useI18n();
  const stats = useQuery({ queryKey: ['admin-stats'], queryFn: () => api.get<Stats>('/api/v1/admin/stats') });
  const system = useQuery({ queryKey: ['admin-system'], queryFn: () => api.get<SystemInfo>('/api/v1/admin/system') });
  const alerts = useQuery({ queryKey: ['admin-alerts'], queryFn: () => api.get<AdminAlerts>('/api/v1/admin/alerts') });
  if (stats.isLoading) return <Loading />;
  if (stats.error || !stats.data) return <ErrorView error={stats.error} />;
  const s = stats.data;
  const max = Math.max(1, ...s.activity.map((a) => a.edits));
  const days: { day: string; edits: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    days.push({ day: d, edits: s.activity.find((a) => a.day === d)?.edits ?? 0 });
  }
  const uptime = system.data ? `${Math.floor(system.data.uptimeSeconds / 3600)} h ${Math.floor((system.data.uptimeSeconds % 3600) / 60)} min` : '';
  return (
    <>
      <PageHeader icon={BarChart3} title={t('admin.nav.overview')} />
      {(alerts.data?.alerts ?? []).map((alert) => (
        <div key={alert.id} className={`banner admin-alert mb-2${alert.severity === 'error' ? ' banner-danger' : ''}`} role="alert">
          <AlertTriangle size={15} aria-hidden="true" />
          <span className="grow">
            <strong>{alert.title}.</strong> {alert.message}
            <span className="admin-alert-hint">{alert.hint}</span>
            <span className="admin-alert-since muted">
              {t('adminOverview.alertSince')} <Time value={alert.since} />
            </span>
          </span>
        </div>
      ))}
      <SetupChecklistCard />
      <div className="stat-grid mb-3">
        {Object.entries(s.counts).map(([k, v]) => (
          <div key={k} className="stat">
            <div className="stat-value">{fmt.number(v)}</div>
            <div className="stat-label">{LABELS[k] ? t(LABELS[k]) : k}</div>
          </div>
        ))}
        <div className="stat">
          <div className="stat-value">{fmt.bytes(s.storage.database)}</div>
          <div className="stat-label">{t('adminOverview.database')}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{fmt.bytes(s.storage.attachments)}</div>
          <div className="stat-label">{t('adminOverview.attachmentStorage')}</div>
        </div>
      </div>
      <div className="dashboard-grid">
        <Card title={t('adminOverview.edits')}>
          <div className="bar-chart">
            {days.map((d) => (
              <div key={d.day} className="bar" style={{ height: `${(d.edits / max) * 100}%` }} title={`${fmt.date(d.day)}: ${d.edits}`} />
            ))}
          </div>
          <div className="row tiny muted mt-1">
            <span>{fmt.date(days[0].day)}</span>
            <span className="spacer" />
            <span>{fmt.date(days[days.length - 1].day)}</span>
          </div>
        </Card>
        <Card title={t('adminOverview.contributors')}>
          {s.topContributors.map((c) => (
            <div key={c.user?.id ?? 0} className="row" style={{ padding: '0.25rem 0' }}>
              <Avatar user={c.user} size={24} />
              <span className="grow">{c.user?.displayName ?? '–'}</span>
              <span className="muted small">{c.edits}</span>
            </div>
          ))}
          {!s.topContributors.length && <div className="small muted">{t('common.none')}</div>}
        </Card>
        <Card title={t('adminOverview.topPages')}>
          {s.topPages.map((p) => (
            <div key={p.id} className="row" style={{ padding: '0.25rem 0' }}>
              <Link to={p.url} className="grow truncate">
                {p.title}
              </Link>
              <span className="muted small">{p.view_count}</span>
            </div>
          ))}
        </Card>
        <Card title={<><Server size={15} /> System</>}>
          {system.data ? (
            <dl className="kv">
              <dt>{t('adminOverview.version')}</dt>
              <dd>
                Knowstead {system.data.version} ({t('adminOverview.schema', { n: system.data.schemaVersion })})
              </dd>
              <dt>Node.js / SQLite</dt>
              <dd>
                {system.data.node} / {system.data.sqlite}
              </dd>
              {system.data.packageBuiltAt && (
                <>
                  <dt>{t('adminOverview.packageBuilt')}</dt>
                  <dd>{fmt.dateTime(system.data.packageBuiltAt)}</dd>
                </>
              )}
              <dt>{t('adminOverview.platform')}</dt>
              <dd>{system.data.platform}</dd>
              <dt>{t('adminOverview.uptime')}</dt>
              <dd>{uptime}</dd>
              <dt>{t('adminOverview.memory')}</dt>
              <dd>{fmt.bytes(system.data.memory.rss)}</dd>
              <dt>{t('adminOverview.dataDir')}</dt>
              <dd className="mono small">{system.data.dataDir}</dd>
              <dt>{t('adminOverview.service')}</dt>
              <dd>
                {system.data.service && SERVICE_MODES.has(system.data.service)
                  ? t(`adminSetup.items.service.modes.${system.data.service}`)
                  : (system.data.service ?? `– ${t('adminOverview.serviceNone')}`)}
              </dd>
              {system.data.logFile && (
                <>
                  <dt>{t('adminOverview.logFile')}</dt>
                  <dd className="mono small">{system.data.logFile}</dd>
                </>
              )}
              <dt>{t('adminOverview.baseUrl')}</dt>
              <dd className="mono small">{system.data.baseUrl}</dd>
              <dt>{t('adminOverview.live')}</dt>
              <dd>{system.data.realtime.connections}</dd>
              <dt>{t('adminOverview.plugins')}</dt>
              <dd>{system.data.pluginsLoaded}</dd>
              <dt>{t('adminOverview.mail')}</dt>
              <dd>{system.data.mailConfigured ? `✓ ${t('adminOverview.configured')}` : `– ${t('adminOverview.notConfigured')}`}</dd>
            </dl>
          ) : (
            <Loading inline />
          )}
        </Card>
      </div>
    </>
  );
}

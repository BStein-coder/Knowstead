import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Download, HardDrive, Play, Trash2, Wrench } from 'lucide-react';
import { api } from '../../api/client';
import type { Backup } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Alert, Badge, Button, Card, EmptyState, Loading, PageHeader, Time } from '../../components/ui';

export function AdminBackups() {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);
  const { data, isLoading, refetch } = useQuery({ queryKey: ['backups'], queryFn: () => api.get<Backup[]>('/api/v1/admin/backups') });
  return (
    <>
      <PageHeader
        icon={Database}
        title={t('admin.nav.backups')}
        subtitle={t('adminBackups.subtitle')}
        actions={
          <Button
            variant="primary"
            icon={HardDrive}
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.post('/api/v1/admin/backups');
                toast.success(t('adminBackups.created'));
                await refetch();
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('adminBackups.backupNow')}
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={Database} title={t('adminBackups.empty')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('adminBackups.backup')}</th>
                <th>{t('adminBackups.createdAt')}</th>
                <th>{t('adminBackups.size')}</th>
                <th>{t('adminBackups.content')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((b) => (
                <tr key={b.name}>
                  <td className="mono small">{b.name}</td>
                  <td className="small">
                    <Time value={b.createdAt} mode="datetime" /> {b.reason === 'auto' ? <Badge>{t('adminBackups.auto')}</Badge> : <Badge color="blue">{t('adminBackups.manual')}</Badge>}
                  </td>
                  <td className="small">{fmt.bytes(b.size)}</td>
                  <td className="small">
                    {t('adminBackups.database', { size: fmt.bytes(b.dbSize) })}{b.includesUploads ? ` + ${t('adminBackups.attachments')}` : ''} · v{b.version}
                  </td>
                  <td className="actions-cell">
                    <a className="btn btn-sm btn-ghost" href={`/api/v1/admin/backups/${b.name}/download`}>
                      <Download size={14} /> ZIP
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      aria-label={t('common.delete')}
                      onClick={async () => {
                        if (!(await dialogs.confirm({ title: t('adminBackups.deleteTitle', { name: b.name }), danger: true, confirmLabel: t('common.delete') }))) return;
                        await api.del(`/api/v1/admin/backups/${b.name}`);
                        await refetch();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3">
        <Alert variant="info" title={t('adminBackups.restore')}>
          {t('adminBackups.restoreText1')} <code>npm run cli -- restore &lt;name&gt;</code> {t('adminBackups.restoreText2')}
        </Alert>
      </div>
    </>
  );
}

const TASKS = [
  { id: 'reindex', title: 'adminBackups.tasks.reindex.title', text: 'adminBackups.tasks.reindex.text' },
  { id: 'reindex-attachments', title: 'adminBackups.tasks.reindex_attachments.title', text: 'adminBackups.tasks.reindex_attachments.text' },
  { id: 'purge-trash', title: 'adminBackups.tasks.purge_trash.title', text: 'adminBackups.tasks.purge_trash.text' },
  { id: 'prune-events', title: 'adminBackups.tasks.prune_events.title', text: 'adminBackups.tasks.prune_events.text' },
  { id: 'cleanup-sessions', title: 'adminBackups.tasks.cleanup_sessions.title', text: 'adminBackups.tasks.cleanup_sessions.text' },
  { id: 'vacuum', title: 'adminBackups.tasks.vacuum.title', text: 'adminBackups.tasks.vacuum.text' },
  { id: 'sync-handbook', title: 'adminBackups.tasks.sync_handbook.title', text: 'adminBackups.tasks.sync_handbook.text' },
] as const;

export function AdminMaintenance() {
  const { t } = useI18n();
  const toast = useToast();
  const [running, setRunning] = useState<string | null>(null);
  return (
    <>
      <PageHeader icon={Wrench} title={t('admin.nav.maintenance')} subtitle={t('adminBackups.maintenanceSubtitle')} />
      <div className="form-grid" style={{ gap: '1rem' }}>
        {TASKS.map((task) => (
          <Card key={task.id} title={t(task.title)}>
            <p className="small soft mb-2">{t(task.text)}</p>
            <Button
              icon={Play}
              loading={running === task.id}
              onClick={async () => {
                setRunning(task.id);
                try {
                  const res = await api.post<Record<string, unknown>>(`/api/v1/admin/maintenance/${task.id}`);
                  toast.success(`${t(task.title)}: ${Object.entries(res).map(([k, v]) => `${k}=${String(v)}`).join(', ')}`);
                } catch (err) {
                  toast.error(err);
                } finally {
                  setRunning(null);
                }
              }}
            >
              {t('adminBackups.run')}
            </Button>
          </Card>
        ))}
      </div>
    </>
  );
}

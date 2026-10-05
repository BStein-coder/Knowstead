import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KanbanSquare, RotateCcw, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import type { UserRef } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Avatar, Button, EmptyState, Loading, PageHeader, Time } from '../../components/ui';
import { useSpaceContext } from './SpaceLayout';

interface DeletedTask {
  id: number;
  title: string;
  boardId: number;
  boardName: string;
  deletedAt: string;
  deletedBy: UserRef | null;
  dependencies: number;
}

interface TrashItem {
  id: number;
  title: string;
  icon: string | null;
  deletedAt: string;
  deletedBy: UserRef | null;
  subPages: number;
  version: number;
}

export default function SpaceTrash() {
  const { space } = useSpaceContext();
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['trash', space.key],
    queryFn: () => api.get<TrashItem[]>(`/api/v1/spaces/${encodeURIComponent(space.key)}/trash`),
  });
  const tasks = useQuery({
    queryKey: ['task-trash', space.key],
    queryFn: () => api.get<{ items: DeletedTask[] }>(`/api/v1/spaces/${encodeURIComponent(space.key)}/task-trash`),
  });

  const refresh = async () => {
    await refetch();
    void qc.invalidateQueries({ queryKey: ['tree', space.key] });
  };
  const refreshTasks = async () => {
    await tasks.refetch();
    void qc.invalidateQueries({ queryKey: ['board'] });
    void qc.invalidateQueries({ queryKey: ['boards', space.key] });
  };

  return (
    <div className="container container-narrow">
      <PageHeader
        icon={Trash2}
        title={t('trash.title')}
        subtitle={t('trash.subtitle', { days: 30 })}
        actions={
          space.can.purge &&
          !!data?.length && (
            <Button
              variant="danger"
              icon={Trash2}
              onClick={async () => {
                if (!(await dialogs.confirm({ title: t('trash.emptyTrash'), message: t('trash.emptyConfirm'), danger: true, confirmLabel: t('trash.emptyTrash') }))) return;
                try {
                  await api.del(`/api/v1/spaces/${encodeURIComponent(space.key)}/trash`);
                  await refresh();
                } catch (err) {
                  toast.error(err);
                }
              }}
            >
              {t('trash.emptyTrash')}
            </Button>
          )
        }
      />
      {isLoading && <Loading />}
      {data && data.length === 0 && !tasks.data?.items.length && <EmptyState icon={Trash2} title={t('trash.empty')} />}
      {data && data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {data.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="row">
                      <span>{item.icon ?? '📄'}</span>
                      <strong>{item.title}</strong>
                      {item.subPages > 0 && <span className="small muted">{t('trash.subPages', { n: item.subPages })}</span>}
                    </div>
                    <div className="small muted row gap-xs">
                      <Avatar user={item.deletedBy} size={16} />
                      {item.deletedBy?.displayName} · <Time value={item.deletedAt} />
                    </div>
                  </td>
                  <td className="actions-cell">
                    <div className="row gap-xs">
                      <Button
                        size="sm"
                        icon={RotateCcw}
                        onClick={async () => {
                          try {
                            await api.post(`/api/v1/pages/${item.id}/restore`);
                            toast.success(t('trash.restored'));
                            await refresh();
                          } catch (err) {
                            toast.error(err);
                          }
                        }}
                      >
                        {t('page.restore')}
                      </Button>
                      {space.can.purge && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          onClick={async () => {
                            if (!(await dialogs.confirm({ title: t('trash.purge'), message: t('trash.purgeConfirm', { title: item.title }), danger: true, confirmLabel: t('trash.purge') }))) return;
                            try {
                              await api.del(`/api/v1/pages/${item.id}/purge`);
                              await refresh();
                            } catch (err) {
                              toast.error(err);
                            }
                          }}
                        >
                          {t('trash.purge')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!tasks.data?.items.length && (
        <>
          <h2 className="h4">{t('trash.tasks')}</h2>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {tasks.data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <div className="row">
                        <KanbanSquare size={15} className="muted" />
                        <strong>{item.title}</strong>
                        <span className="small muted">{item.boardName}</span>
                        {item.dependencies > 0 && <span className="small muted">{t('trash.taskDependencies', { n: item.dependencies })}</span>}
                      </div>
                      <div className="small muted row gap-xs">
                        <Avatar user={item.deletedBy} size={16} />
                        {item.deletedBy?.displayName} · <Time value={item.deletedAt} />
                      </div>
                    </td>
                    <td className="actions-cell">
                      <div className="row gap-xs">
                        <Button
                          size="sm"
                          icon={RotateCcw}
                          onClick={async () => {
                            try {
                              await api.post(`/api/v1/tasks/${item.id}/restore`);
                              toast.success(t('trash.restored'));
                              await refreshTasks();
                            } catch (err) {
                              toast.error(err);
                            }
                          }}
                        >
                          {t('page.restore')}
                        </Button>
                        {space.can.purge && (
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={Trash2}
                            onClick={async () => {
                              if (!(await dialogs.confirm({ title: t('trash.purge'), message: t('trash.purgeConfirm', { title: item.title }), danger: true, confirmLabel: t('trash.purge') }))) return;
                              try {
                                await api.del(`/api/v1/tasks/${item.id}/purge`);
                                await refreshTasks();
                              } catch (err) {
                                toast.error(err);
                              }
                            }}
                          >
                            {t('trash.purge')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

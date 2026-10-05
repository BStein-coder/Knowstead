import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CheckCircle2, Circle, ListChecks } from 'lucide-react';
import { api } from '../../api/client';
import type { Board, Task } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Badge, Button, EmptyState, ErrorView, Loading, PageHeader, Tabs, cx } from '../../components/ui';
import { ChatBadge, DueBadge, PriorityBadge, TaskDialog } from './TaskComponents';
import { CalendarDialog } from './CalendarDialog';

type Group = { key: string; title: string; items: Task[] };

/** „Meine Aufgaben“: alles, was mir zugewiesen ist – nach Fälligkeit gruppiert. */
export default function MyTasksPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [scope, setScope] = useState<'open' | 'done'>('open');
  const [open, setOpen] = useState<{ task: Task; board: Board } | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', 'mine', scope],
    queryFn: () => api.get<{ items: Task[] }>('/api/v1/tasks', { assignee: 'me', status: scope === 'open' ? 'open-all' : 'done', limit: 300 }),
  });

  const toggle = useMutation({
    mutationFn: (task: Task) => api.patch<Task>(`/api/v1/tasks/${task.id}`, { status: task.status === 'done' ? 'open' : 'done' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => toast.error(err),
  });

  const groups = useMemo<Group[]>(() => {
    const items = data?.items ?? [];
    if (scope === 'done') return [{ key: 'done', title: t('tasks.statuses.done'), items }];
    const local = (offset: number) => {
      const d = new Date(Date.now() + offset * 86400000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    const today = local(0);
    const week = local(7);
    const result: Group[] = [
      { key: 'overdue', title: t('tasks.groups.overdue'), items: items.filter((x) => x.dueDate && x.dueDate < today) },
      { key: 'today', title: t('tasks.groups.today'), items: items.filter((x) => x.dueDate === today) },
      { key: 'week', title: t('tasks.groups.week'), items: items.filter((x) => x.dueDate && x.dueDate > today && x.dueDate <= week) },
      { key: 'later', title: t('tasks.groups.later'), items: items.filter((x) => x.dueDate && x.dueDate > week) },
      { key: 'none', title: t('tasks.groups.none'), items: items.filter((x) => !x.dueDate) },
    ];
    return result.filter((g) => g.items.length);
  }, [data, scope, t]);

  const openTask = async (task: Task) => {
    try {
      const res = await api.get<{ board: Board }>(`/api/v1/boards/${task.boardId}`);
      setOpen({ task, board: res.board });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="container">
      <PageHeader
        icon={ListChecks}
        title={t('tasks.myTitle')}
        subtitle={t('tasks.mySubtitle')}
        actions={
          <Button icon={CalendarPlus} onClick={() => setCalendarOpen(true)}>
            {t('tasks.calendarTitle')}
          </Button>
        }
      />
      {calendarOpen && <CalendarDialog onClose={() => setCalendarOpen(false)} />}
      <Tabs
        value={scope}
        onChange={setScope}
        items={[
          { value: 'open', label: t('tasks.filters.open') },
          { value: 'done', label: t('tasks.statuses.done') },
        ]}
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorView error={error} />
      ) : !groups.length ? (
        <EmptyState icon={CheckCircle2} title={t('tasks.myEmpty')} text={t('tasks.myEmptyHint')} />
      ) : (
        groups.map((group) => (
          <section key={group.key} className="my-task-group">
            <h3 className={cx('space-group-title', group.key === 'overdue' && 'danger')}>
              {group.title} <Badge color={group.key === 'overdue' ? 'red' : 'gray'}>{group.items.length}</Badge>
            </h3>
            <ul className="my-task-list">
              {group.items.map((task) => (
                <li key={task.id} className={cx('my-task', task.status === 'done' && 'done')}>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => toggle.mutate(task)}
                    aria-label={task.status === 'done' ? t('tasks.reopen') : t('tasks.complete')}
                  >
                    {task.status === 'done' ? <CheckCircle2 size={18} className="success" /> : <Circle size={18} />}
                  </button>
                  <button type="button" className="my-task-main" onClick={() => void openTask(task)}>
                    <span className="my-task-title">{task.title}</span>
                    <span className="my-task-meta">
                      <Link to={`/s/${encodeURIComponent(task.spaceKey)}/tasks?board=${task.boardId}`} onClick={(e) => e.stopPropagation()}>
                        {task.spaceName} · {task.boardName}
                      </Link>
                      {task.page && (
                        <>
                          {' · '}
                          <Link to={task.page.url} onClick={(e) => e.stopPropagation()}>
                            {task.page.title}
                          </Link>
                        </>
                      )}
                    </span>
                  </button>
                  <ChatBadge task={task} />
                  <PriorityBadge priority={task.priority} />
                  <DueBadge task={task} />
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {open && <TaskDialog board={open.board} task={open.task} onClose={() => setOpen(null)} />}
    </div>
  );
}

import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, CheckCircle2, ListChecks } from 'lucide-react';
import { api } from '../../api/client';
import type { Board, Task } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useFlash, useFlip } from '../../lib/flip';
import { motionReduced } from '../../lib/motion';
import { Badge, Button, EmptyState, ErrorView, Loading, PageHeader, Tabs, cx } from '../../components/ui';
import { ChatBadge, DueBadge, PriorityBadge, TaskDialog } from './TaskComponents';
import { CalendarDialog } from './CalendarDialog';
import { TaskCheck } from './TaskCheck';

type Group = { key: string; title: string; items: Task[] };

/** Zähler an der Gruppenüberschrift: leuchtet kurz auf, wenn sich die Zahl ändert. */
function GroupCount({ n, red }: { n: number; red: boolean }) {
  const flash = useFlash(n);
  return (
    <Badge color={red ? 'red' : 'gray'} className={flash}>
      {n}
    </Badge>
  );
}

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

  // Aufgaben, die gerade abgehakt werden: Haken und Durchstreichen laufen, dann gleitet die Zeile hinaus – erst danach geht die Anfrage los
  const [completing, setCompleting] = useState<number[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  useFlip(listRef, [data]);

  const toggle = useMutation({
    mutationFn: (task: Task) => api.patch<Task>(`/api/v1/tasks/${task.id}`, { status: task.status === 'done' ? 'open' : 'done' }),
    // Die Zeile verschwindet sofort aus der Liste (die übrigen rücken gleitend nach); bei einem Fehler kommt sie zurück
    onMutate: async (task) => {
      await qc.cancelQueries({ queryKey: ['tasks', 'mine', scope] });
      const previous = qc.getQueryData<{ items: Task[] }>(['tasks', 'mine', scope]);
      if (previous) qc.setQueryData(['tasks', 'mine', scope], { items: previous.items.filter((x) => x.id !== task.id) });
      return { previous };
    },
    onError: (err, task, context) => {
      setCompleting((ids) => ids.filter((id) => id !== task.id));
      if (context?.previous) qc.setQueryData(['tasks', 'mine', scope], context.previous);
      toast.error(err);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const check = (task: Task) => {
    if (motionReduced()) {
      toggle.mutate(task);
      return;
    }
    setCompleting((ids) => [...ids, task.id]);
    window.setTimeout(() => {
      toggle.mutate(task);
      setCompleting((ids) => ids.filter((id) => id !== task.id));
    }, 640);
  };

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
        <div ref={listRef}>
          {groups.map((group) => (
            <section key={group.key} className="my-task-group" data-flip={`group-${group.key}`}>
              <h3 className={cx('space-group-title', group.key === 'overdue' && 'danger')}>
                {group.title} <GroupCount n={group.items.length} red={group.key === 'overdue'} />
              </h3>
              <ul className="my-task-list">
                {group.items.map((task, index) => {
                  const leaving = completing.includes(task.id);
                  // Während des Abhakens zeigt die Zeile schon den neuen Zustand
                  const showDone = (task.status === 'done') !== leaving;
                  return (
                    <li
                      key={task.id}
                      className={cx('my-task', showDone && 'done', leaving && 'is-completing')}
                      data-flip={`task-${task.id}`}
                      style={{ ['--i' as string]: Math.min(index, 10) }}
                    >
                      <TaskCheck
                        done={showDone}
                        label={`${task.status === 'done' ? t('tasks.reopen') : t('tasks.complete')}: ${task.title}`}
                        disabled={leaving}
                        onToggle={() => check(task)}
                      />
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
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {open && <TaskDialog board={open.board} task={open.task} onClose={() => setOpen(null)} />}
    </div>
  );
}

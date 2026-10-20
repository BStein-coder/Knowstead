import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus } from 'lucide-react';
import { api } from '../../api/client';
import type { Board, Task } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Button, ErrorView, PageHeader, cx } from '../../components/ui';
import { CalendarDialog } from './CalendarDialog';
import { TaskDialog } from './TaskComponents';
import { TaskCalendar, ymd } from './TaskCalendar';

type Scope = 'mine' | 'all';

/** „Kalender“: Fälligkeiten über alle Bereiche – die eigenen oder alle, die man sehen darf. */
export default function CalendarPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>('mine');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [open, setOpen] = useState<{ task: Task; board: Board } | null>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  const assignee = scope === 'mine' ? 'me' : undefined;
  const yesterday = ymd(new Date(Date.now() - 86400000));

  const tasks = useQuery({
    queryKey: ['tasks', 'calendar', scope, range?.from, range?.to],
    // Zeitraum: alles, dessen Beginn-bis-Fälligkeit den sichtbaren Ausschnitt berührt – auch was ihn ganz überspannt
    queryFn: () => api.get<{ items: Task[] }>('/api/v1/tasks', { assignee, spanFrom: range?.from, spanTo: range?.to, limit: 500 }),
    enabled: !!range,
    // Beim Blättern bleibt der alte Monat stehen, bis der neue da ist – das Raster flackert nicht leer
    placeholderData: (previous) => previous,
  });
  // „Heute“ zeigt auch, was überfällig ist – unabhängig vom sichtbaren Monat
  const late = useQuery({
    queryKey: ['tasks', 'calendar-late', scope],
    queryFn: () => api.get<{ items: Task[] }>('/api/v1/tasks', { assignee, status: 'open-all', dueBefore: yesterday, limit: 100 }),
  });

  const toggle = useMutation({
    mutationFn: (task: Task) => api.patch<Task>(`/api/v1/tasks/${task.id}`, { status: task.status === 'done' ? 'open' : 'done' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => toast.error(err),
  });

  const openTask = async (task: Task) => {
    try {
      const res = await api.get<{ board: Board }>(`/api/v1/boards/${task.boardId}`);
      setOpen({ task, board: res.board });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="container container-wide calendar-page">
      <PageHeader
        icon={CalendarDays}
        title={t('planner.calendar.title')}
        subtitle={t('planner.calendar.subtitle')}
        actions={
          <Button icon={CalendarPlus} onClick={() => setSubscribeOpen(true)}>
            {t('tasks.calendarTitle')}
          </Button>
        }
      />
      {tasks.error && <ErrorView error={tasks.error} />}
      <TaskCalendar
        tasks={tasks.data?.items ?? []}
        overdue={late.data?.items}
        onOpen={(task) => void openTask(task)}
        onToggle={(task) => toggle.mutate(task)}
        showPlan
        onRange={setRange}
        controls={
          <div className="cal-modes" role="group" aria-label={t('planner.calendar.scopeLabel')}>
            {(['mine', 'all'] as const).map((value) => (
              <button key={value} type="button" className={cx('cal-mode', scope === value && 'active')} aria-pressed={scope === value} onClick={() => setScope(value)}>
                {t(value === 'mine' ? 'planner.calendar.scopeMine' : 'planner.calendar.scopeAll')}
              </button>
            ))}
          </div>
        }
      />
      {open && <TaskDialog board={open.board} task={open.task} onClose={() => setOpen(null)} />}
      {subscribeOpen && <CalendarDialog onClose={() => setSubscribeOpen(false)} />}
    </div>
  );
}

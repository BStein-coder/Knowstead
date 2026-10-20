import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, CalendarPlus, Columns3, FileDown, GanttChart, KanbanSquare, List, ListTodo, Plus, Settings2, Trash2, X } from 'lucide-react';
import { api, download } from '../../api/client';
import type { Board, Bucket, Task } from '../../api/types';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { useFlash, useFlip } from '../../lib/flip';
import { useCountUp } from '../../lib/motion';
import { Avatar, Badge, Button, EmptyState, ErrorView, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Switch, Tabs, Textarea, cx } from '../../components/ui';
import { BulkBar, DueBadge, PriorityBadge, TaskCard, TaskDialog } from './TaskComponents';
import { TaskTimeline } from './TaskTimeline';
import { TaskCalendar, ymd } from './TaskCalendar';
import { CalendarDialog } from './CalendarDialog';

type Filter = 'all' | 'mine' | 'overdue' | 'open';

/**
 * Aufgabenplaner eines Bereichs – angelehnt an Microsoft Planner:
 * Spalten („Buckets“), Karten per Drag & Drop, Filter, Listenansicht.
 */
export default function BoardPage() {
  const { spaceKey = '' } = useParams();
  const { t } = useI18n();
  const toast = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  // „Neuer Plan“ aus der Übersicht „Projekte“ öffnet den Dialog gleich
  const [creatingBoard, setCreatingBoard] = useState(params.get('new') === '1');
  const savedNew = useRef(false);

  const boards = useQuery({
    queryKey: ['boards', spaceKey],
    queryFn: () => api.get<{ items: Board[] }>(`/api/v1/spaces/${encodeURIComponent(spaceKey)}/boards`),
  });
  const list = boards.data?.items ?? [];
  const boardId = Number(params.get('board')) || list[0]?.id || 0;

  if (boards.isLoading) return <Loading />;
  if (boards.error) return <ErrorView error={boards.error} />;

  return (
    <div className="container container-wide board-page">
      <PageHeader
        icon={KanbanSquare}
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        actions={
          <div className="row gap-sm">
            {list.length > 1 && (
              <Select value={String(boardId)} onChange={(e) => setParams({ board: e.target.value })} aria-label={t('tasks.board')}>
                {list.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
            <Button icon={Plus} onClick={() => setCreatingBoard(true)}>
              {t('tasks.newBoard')}
            </Button>
          </div>
        }
      />
      {!list.length ? (
        <EmptyState
          icon={ListTodo}
          title={t('tasks.noBoards')}
          text={t('tasks.noBoardsHint')}
          action={
            <Button variant="primary" icon={Plus} onClick={() => setCreatingBoard(true)}>
              {t('tasks.newBoard')}
            </Button>
          }
        />
      ) : (
        <BoardView key={boardId} boardId={boardId} currentUserId={user?.id ?? 0} focusTaskId={Number(params.get('task')) || null} />
      )}
      {creatingBoard && (
        <BoardDialog
          spaceKey={spaceKey}
          board={null}
          onClose={() => {
            setCreatingBoard(false);
            // Beim Speichern setzt `onSaved` die Adresse selbst (der Dialog ruft danach noch onClose auf)
            if (params.has('new') && !savedNew.current) {
              const next = new URLSearchParams(params);
              next.delete('new');
              setParams(next, { replace: true });
            }
          }}
          onSaved={(b) => {
            savedNew.current = true;
            void qc.invalidateQueries({ queryKey: ['boards', spaceKey] });
            setParams({ board: String(b.id) });
            toast.success(t('tasks.boardCreated'));
          }}
        />
      )}
    </div>
  );
}

function BoardView({ boardId, currentUserId, focusTaskId }: { boardId: number; currentUserId: number; focusTaskId: number | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<'board' | 'list' | 'timeline' | 'calendar'>(() => {
    try {
      const stored = localStorage.getItem('knowstead.tasks.view');
      return stored === 'list' || stored === 'timeline' || stored === 'calendar' ? stored : 'board';
    } catch {
      return 'board';
    }
  });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [newIn, setNewIn] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState('');
  // Welche Karte gezogen wird, steht in einer Referenz: Die Ereignisse beim Ziehen kommen schneller, als React neu zeichnet –
  // mit einem Zustand sähen die ersten das alte „nichts wird gezogen“ (auf langsamen Rechnern fehlte dann die Einfügemarke)
  const dragId = useRef<number | null>(null);
  // Das Abdunkeln der gezogenen Karte folgt erst nach dem Start: Das Ziehbild, das der Browser beim Start macht, soll noch normal aussehen
  const [dragVisual, setDragVisual] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // Einfügemarke beim Ziehen: Spalte und Abstand von oben, damit man sieht, wo die Karte landet
  const [dropLine, setDropLine] = useState<{ bucket: string; top: number } | null>(null);
  // Beim Öffnen einer Ansicht erscheinen die Karten nacheinander; später hinzukommende ohne Verzögerung
  const [intro, setIntro] = useState(true);
  const [editBoard, setEditBoard] = useState(false);
  // Mehrfachauswahl: Karten mit Strg/Cmd oder Umschalt anklicken, dann gemeinsam ändern
  const [selected, setSelected] = useState<number[]>([]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['board', boardId],
    queryFn: () => api.get<{ board: Board; tasks: Task[] }>(`/api/v1/boards/${boardId}`),
    enabled: !!boardId,
  });

  useEffect(() => {
    try {
      localStorage.setItem('knowstead.tasks.view', view);
    } catch {
      /* ignorieren */
    }
  }, [view]);

  useEffect(() => {
    if (focusTaskId && data) setOpenTask(data.tasks.find((x) => x.id === focusTaskId) ?? null);
  }, [focusTaskId, data]);

  // Vorschau, bevor der Server antwortet: Die Karte gleitet sofort an den neuen Platz (useFlip); bei einem Fehler kehrt sie zurück
  const preview = async (change: (board: Board, all: Task[]) => Task[]) => {
    await qc.cancelQueries({ queryKey: ['board', boardId] });
    const previous = qc.getQueryData<{ board: Board; tasks: Task[] }>(['board', boardId]);
    if (previous) qc.setQueryData(['board', boardId], { ...previous, tasks: change(previous.board, previous.tasks) });
    return { previous };
  };
  const reconcile = {
    onError: (err: unknown, _vars: unknown, context: { previous?: { board: Board; tasks: Task[] } } | undefined) => {
      if (context?.previous) qc.setQueryData(['board', boardId], context.previous);
      toast.error(err);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['board', boardId] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  };

  const move = useMutation({
    mutationFn: ({ id, bucket, index }: { id: number; bucket: string; index: number }) => api.post<Task>(`/api/v1/tasks/${id}/move`, { bucket, index }),
    onMutate: ({ id, bucket, index }) => preview((b, all) => moveTask(b, all, id, bucket, index)),
    ...reconcile,
  });

  const complete = useMutation({
    mutationFn: (task: Task) => api.patch<Task>(`/api/v1/tasks/${task.id}`, { status: task.status === 'done' ? 'open' : 'done' }),
    onMutate: (task) => preview((b, all) => toggleDone(b, all, task)),
    ...reconcile,
  });

  const quickAdd = useMutation({
    mutationFn: ({ bucket, title }: { bucket: string; title: string }) => api.post<Task>(`/api/v1/boards/${boardId}/tasks`, { bucket, title }),
    onSuccess: () => {
      setQuickTitle('');
      void qc.invalidateQueries({ queryKey: ['board', boardId] });
    },
    onError: (err) => toast.error(err),
  });

  const tasks = useMemo(() => {
    const all = data?.tasks ?? [];
    switch (filter) {
      case 'mine':
        return all.filter((x) => x.assignee?.id === currentUserId);
      case 'overdue':
        return all.filter((x) => x.overdue);
      case 'open':
        return all.filter((x) => x.status !== 'done');
      default:
        return all;
    }
  }, [data, filter, currentUserId]);

  const columnsRef = useRef<HTMLDivElement>(null);
  useFlip(columnsRef, [tasks, view]);
  useEffect(() => {
    setIntro(true);
    const id = window.setTimeout(() => setIntro(false), 900);
    return () => window.clearTimeout(id);
  }, [view, boardId]);

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorView error={error} />;
  const { board } = data;
  const doneShare = board.counts.total ? Math.round((board.counts.done / board.counts.total) * 100) : 0;

  return (
    <>
      <PlanStats tasks={data.tasks} />
      <div className="board-toolbar">
        <div className="board-summary">
          <strong>{board.name}</strong>
          {board.description && <span className="muted small">{board.description}</span>}
          <span className="board-stats">
            <Badge color="gray">{t('tasks.countTotal', { n: board.counts.total })}</Badge>
            <Badge color="green">{doneShare} % {t('tasks.statuses.done')}</Badge>
            {board.counts.overdue > 0 && <Badge color="red">{t('tasks.countOverdue', { n: board.counts.overdue })}</Badge>}
          </span>
        </div>
        <span className="spacer" />
        <Tabs
          value={filter}
          onChange={setFilter}
          items={[
            { value: 'all', label: t('tasks.filters.all') },
            { value: 'mine', label: t('tasks.filters.mine') },
            { value: 'open', label: t('tasks.filters.open') },
            { value: 'overdue', label: t('tasks.filters.overdue') },
          ]}
        />
        <div className="btn-group">
          <IconButton icon={Columns3} label={t('tasks.viewBoard')} active={view === 'board'} onClick={() => setView('board')} />
          <IconButton icon={List} label={t('tasks.viewList')} active={view === 'list'} onClick={() => setView('list')} />
          <IconButton icon={GanttChart} label={t('tasks.viewTimeline')} active={view === 'timeline'} onClick={() => setView('timeline')} />
          <IconButton icon={CalendarDays} label={t('tasks.viewCalendar')} active={view === 'calendar'} onClick={() => setView('calendar')} />
        </div>
        <IconButton icon={CalendarPlus} label={t('tasks.calendarTitle')} onClick={() => setCalendarOpen(true)} />
        <IconButton icon={FileDown} label={t('tasks.exportCsv')} onClick={() => download(`/api/v1/boards/${board.id}/export.csv`)} />
        {board.canEdit && <IconButton icon={Settings2} label={t('tasks.editBoard')} onClick={() => setEditBoard(true)} />}
      </div>

      {selected.length > 0 && (
        <BulkBar
          board={board}
          ids={selected}
          onDone={() => {
            setSelected([]);
            void qc.invalidateQueries({ queryKey: ['board', boardId] });
            void qc.invalidateQueries({ queryKey: ['tasks'] });
          }}
          onCancel={() => setSelected([])}
        />
      )}
      <div key={view} className="view-enter">
        {view === 'timeline' ? (
          <TaskTimeline board={board} tasks={tasks} onOpen={setOpenTask} />
        ) : view === 'calendar' ? (
          <TaskCalendar tasks={tasks} onOpen={setOpenTask} onToggle={board.canEdit ? (task) => complete.mutate(task) : undefined} />
        ) : view === 'board' ? (
          <div className="board-columns" ref={columnsRef}>
            {board.buckets.map((bucket) => {
              const items = tasks.filter((x) => x.bucket === bucket.id);
              return (
                <section
                  key={bucket.id}
                  className={cx('board-column', dropTarget === bucket.id && 'drop')}
                  onDragOver={(e) => {
                    if (!board.canEdit || dragId.current === null) return;
                    e.preventDefault();
                    setDropTarget(bucket.id);
                    // Einfügemarke: zwischen den Karten, wo die gezogene Karte landen würde
                    const holder = e.currentTarget.querySelector<HTMLElement>('.board-cards');
                    if (!holder) return;
                    const cards = [...holder.querySelectorAll<HTMLElement>('.task-card')].filter((c) => c.dataset.taskId !== String(dragId.current));
                    const index = cards.filter((c) => c.getBoundingClientRect().top + c.offsetHeight / 2 < e.clientY).length;
                    const base = holder.getBoundingClientRect().top;
                    const top = index === 0 ? (cards[0] ? cards[0].getBoundingClientRect().top - base - 5 : 0) : cards[index - 1].getBoundingClientRect().bottom - base + 4;
                    setDropLine((current) => (current && current.bucket === bucket.id && current.top === top ? current : { bucket: bucket.id, top }));
                  }}
                  onDragLeave={(e) => {
                    // Das Ereignis kommt auch, wenn der Zeiger nur über eine Karte in der Spalte wandert
                    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
                    setDropTarget((d) => (d === bucket.id ? null : d));
                    setDropLine((l) => (l?.bucket === bucket.id ? null : l));
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDropTarget(null);
                    setDropLine(null);
                    const moving = dragId.current;
                    if (moving === null) return;
                    // Einfügeposition anhand der Mausposition bestimmen.
                    const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.task-card')].filter((c) => c.dataset.taskId !== String(moving));
                    const index = cards.filter((c) => c.getBoundingClientRect().top + c.offsetHeight / 2 < e.clientY).length;
                    move.mutate({ id: moving, bucket: bucket.id, index });
                    dragId.current = null;
                    setDragVisual(null);
                  }}
                >
                  <header className="board-column-head" style={{ ['--bucket-color' as string]: bucket.color ?? 'var(--accent)' }}>
                    <span className="bucket-dot" />
                    <span className="truncate">{bucket.name}</span>
                    <ColumnCount n={items.length} />
                    <span className="spacer" />
                    {board.canEdit && <IconButton icon={Plus} label={t('tasks.addHere')} onClick={() => setNewIn(newIn === bucket.id ? null : bucket.id)} />}
                  </header>
                  {newIn === bucket.id && (
                    <form
                      className="board-quick-add"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (quickTitle.trim()) quickAdd.mutate({ bucket: bucket.id, title: quickTitle.trim() });
                      }}
                    >
                      <Input value={quickTitle} onChange={(e) => setQuickTitle(e.target.value)} placeholder={t('tasks.quickPlaceholder')} autoFocus />
                      <div className="row gap-xs">
                        <Button type="submit" size="sm" variant="primary" loading={quickAdd.isPending} disabled={!quickTitle.trim()}>
                          {t('tasks.create')}
                        </Button>
                        <IconButton icon={X} label={t('common.cancel')} onClick={() => setNewIn(null)} />
                      </div>
                    </form>
                  )}
                  <div className="board-cards">
                    {dropLine?.bucket === bucket.id && <div className="drop-line" style={{ top: dropLine.top }} aria-hidden="true" />}
                    {items.map((task, index) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        index={intro ? index : 0}
                        dragging={dragVisual === task.id}
                        onToggleDone={board.canEdit ? (done) => complete.mutate(done) : undefined}
                        draggable={board.canEdit}
                        onDragStart={(e) => {
                          dragId.current = task.id;
                          window.requestAnimationFrame(() => setDragVisual(task.id));
                          e.dataTransfer.effectAllowed = 'move';
                          // Firefox startet das Ziehen nur mit gesetzten Daten
                          e.dataTransfer.setData('text/plain', task.title);
                        }}
                        onDragEnd={() => {
                          dragId.current = null;
                          setDragVisual(null);
                          setDropTarget(null);
                          setDropLine(null);
                        }}
                        selected={selected.includes(task.id)}
                        onOpen={(multi) => {
                          if (multi || selected.length) {
                            setSelected((current) => (current.includes(task.id) ? current.filter((id) => id !== task.id) : [...current, task.id]));
                            return;
                          }
                          setOpenTask(task);
                        }}
                      />
                    ))}
                    {!items.length && <div className="board-empty">{t('tasks.columnEmpty')}</div>}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div className="table-wrap">
            <table className="table task-table">
              <thead>
                <tr>
                  <th>{t('tasks.task')}</th>
                  <th>{t('tasks.bucket')}</th>
                  <th>{t('tasks.assignee')}</th>
                  <th>{t('tasks.due')}</th>
                  <th>{t('tasks.priority')}</th>
                  <th>{t('tasks.progress')}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className={cx(task.status === 'done' && 'muted')} onClick={() => setOpenTask(task)} style={{ cursor: 'pointer' }}>
                    <td className={cx(task.status === 'done' && 'strike')}>{task.title}</td>
                    <td className="small">{board.buckets.find((b) => b.id === task.bucket)?.name}</td>
                    <td>
                      {task.assignee ? (
                        <span className="row gap-xs small">
                          <Avatar user={task.assignee} size={20} /> {task.assignee.displayName}
                        </span>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td>
                      <DueBadge task={task} />
                    </td>
                    <td>
                      <PriorityBadge priority={task.priority} />
                    </td>
                    <td style={{ minWidth: 90 }}>
                      <div className="task-progress">
                        <span style={{ width: `${task.status === 'done' ? 100 : task.progress}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
                {!tasks.length && (
                  <tr>
                    <td colSpan={6} className="muted">
                      {t('tasks.noneFiltered')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {openTask && <TaskDialog board={board} task={openTask} onClose={() => setOpenTask(null)} />}
      {calendarOpen && <CalendarDialog boardId={board.id} boardName={board.name} onClose={() => setCalendarOpen(false)} />}
      {editBoard && (
        <BoardDialog
          spaceKey={board.spaceKey}
          board={board}
          onClose={() => setEditBoard(false)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ['board', boardId] });
            void qc.invalidateQueries({ queryKey: ['boards', board.spaceKey] });
          }}
        />
      )}
    </>
  );
}

/* ------------------------------ Vorschau beim Verschieben und Erledigen ------------------------------ */

/**
 * Zeigt ein Verschieben schon, bevor der Server geantwortet hat. Die letzte Spalte gilt als „erledigt“ – wie auf dem
 * Server: Wer dorthin zieht, schließt die Aufgabe ab, wer sie von dort wegzieht, öffnet sie wieder.
 * `index` zählt unter den übrigen Karten der Zielspalte; ein zu großer Wert hängt die Karte hinten an.
 */
export function moveTask(board: Board, tasks: Task[], id: number, bucket: string, index: number): Task[] {
  const moving = tasks.find((x) => x.id === id);
  if (!moving) return tasks;
  const lastBucket = board.buckets.length > 1 ? board.buckets[board.buckets.length - 1].id : null;
  const done = lastBucket !== null && bucket === lastBucket;
  const reopened = !done && moving.status === 'done';
  const moved: Task = { ...moving, bucket, status: done ? 'done' : reopened ? 'open' : moving.status, progress: done ? 100 : moving.progress, overdue: done ? false : moving.overdue };
  const rest = tasks.filter((x) => x.id !== id);
  const target = rest.filter((x) => x.bucket === bucket);
  const before = target[index];
  if (before) {
    rest.splice(rest.indexOf(before), 0, moved);
    return rest;
  }
  const last = target[target.length - 1];
  if (last) {
    rest.splice(rest.indexOf(last) + 1, 0, moved);
    return rest;
  }
  return [...rest, moved];
}

/** Haken auf der Karte: in die letzte Spalte, beim Wiederöffnen in die erste. Ohne zweite Spalte ändert sich nur der Status. */
export function toggleDone(board: Board, tasks: Task[], task: Task): Task[] {
  const first = board.buckets[0]?.id;
  const last = board.buckets.length > 1 ? board.buckets[board.buckets.length - 1].id : null;
  if (last && first) return moveTask(board, tasks, task.id, task.status === 'done' ? first : last, Infinity);
  return tasks.map((x) => (x.id === task.id ? { ...x, status: task.status === 'done' ? 'open' : 'done', progress: task.status === 'done' ? 0 : 100, overdue: false } : x));
}

/** Zähler im Kopf einer Spalte: leuchtet kurz auf, wenn Karten hinzukommen oder gehen. */
function ColumnCount({ n }: { n: number }) {
  const flash = useFlash(n);
  return <span className={cx('board-count', flash)}>{n}</span>;
}

/* ------------------------------ Kennzahlen des Plans ------------------------------ */

function StatValue({ value, tone }: { value: number; tone?: 'danger' }) {
  const shown = useCountUp(value, 700) ?? value;
  const flash = useFlash(value);
  return <span className={cx('plan-stat-value', tone === 'danger' && value > 0 && 'danger', flash)}>{shown}</span>;
}

/** Vier Kacheln über dem Plan: offen, diese Woche fällig, überfällig, diese Woche erledigt – die Zahlen zählen hoch. */
function PlanStats({ tasks }: { tasks: Task[] }) {
  const { t } = useI18n();
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const from = ymd(monday);
  const to = ymd(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6));
  const open = tasks.filter((x) => x.status !== 'done');
  const stats: { key: string; label: string; value: number; tone?: 'danger' }[] = [
    { key: 'open', label: t('planner.stats.open'), value: open.length },
    { key: 'week', label: t('planner.stats.dueWeek'), value: open.filter((x) => x.dueDate && x.dueDate >= from && x.dueDate <= to).length },
    { key: 'overdue', label: t('planner.stats.overdue'), value: tasks.filter((x) => x.overdue).length, tone: 'danger' },
    { key: 'done', label: t('planner.stats.doneWeek'), value: tasks.filter((x) => x.status === 'done' && !!x.completedAt && x.completedAt.slice(0, 10) >= from).length },
  ];
  return (
    <div className="plan-stats stagger">
      {stats.map((stat) => (
        <div key={stat.key} className="plan-stat">
          <span className="plan-stat-label">{stat.label}</span>
          <StatValue value={stat.value} tone={stat.tone} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ Plan anlegen/ändern ------------------------------ */

function BoardDialog({ spaceKey, board, onClose, onSaved }: { spaceKey: string; board: Board | null; onClose: () => void; onSaved: (b: Board) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const [name, setName] = useState(board?.name ?? '');
  const [description, setDescription] = useState(board?.description ?? '');
  const [buckets, setBuckets] = useState<Bucket[]>(
    board?.buckets ?? [
      { id: 'todo', name: t('tasks.defaultBuckets.todo'), color: '#64748b' },
      { id: 'doing', name: t('tasks.defaultBuckets.doing'), color: '#2563eb' },
      { id: 'review', name: t('tasks.defaultBuckets.review'), color: '#a855f7' },
      { id: 'done', name: t('tasks.defaultBuckets.done'), color: '#16a34a' },
    ],
  );
  const [busy, setBusy] = useState(false);
  const [autoSchedule, setAutoSchedule] = useState(board?.autoSchedule ?? true);

  const save = async () => {
    setBusy(true);
    try {
      const body = board ? { name, description, buckets, autoSchedule } : { name, description, buckets };
      const saved = board
        ? await api.patch<Board>(`/api/v1/boards/${board.id}`, body)
        : await api.post<Board>(`/api/v1/spaces/${encodeURIComponent(spaceKey)}/boards`, body);
      onSaved(saved);
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!board) return;
    const ok = await dialogs.confirm({ title: t('tasks.deleteBoard'), message: t('tasks.deleteBoardText', { name: board.name }), danger: true, requireText: board.name });
    if (!ok) return;
    try {
      await api.del(`/api/v1/boards/${board.id}`);
      void qc.invalidateQueries({ queryKey: ['boards', spaceKey] });
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={board ? t('tasks.editBoard') : t('tasks.newBoard')}
      footer={
        <>
          {board && (
            <Button variant="ghost" icon={Trash2} onClick={() => void remove()}>
              {t('tasks.deleteBoard')}
            </Button>
          )}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <Field label={t('common.name')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('tasks.boardNamePlaceholder')} autoFocus />
      </Field>
      <Field label={t('common.description')}>
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label={t('tasks.buckets')} help={t('tasks.bucketsHelp')}>
        <ul className="bucket-editor">
          {buckets.map((b, i) => (
            <li key={i}>
              <input
                type="color"
                value={b.color ?? '#64748b'}
                onChange={(e) => setBuckets(buckets.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))}
                aria-label={t('spaces.color')}
              />
              <Input value={b.name} onChange={(e) => setBuckets(buckets.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <IconButton icon={X} label={t('common.remove')} disabled={buckets.length <= 1} onClick={() => setBuckets(buckets.filter((_, j) => j !== i))} />
            </li>
          ))}
        </ul>
        <Button size="sm" icon={Plus} onClick={() => setBuckets([...buckets, { id: `b${Date.now().toString(36)}`, name: t('tasks.newBucket'), color: '#0891b2' }])} disabled={buckets.length >= 12}>
          {t('tasks.addBucket')}
        </Button>
      </Field>
      {board && <Switch checked={autoSchedule} onChange={setAutoSchedule} label={t('tasks.autoSchedule')} description={t('tasks.autoScheduleHelp')} />}
    </Modal>
  );
}

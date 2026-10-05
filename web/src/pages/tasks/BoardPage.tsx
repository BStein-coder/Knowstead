import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, Columns3, FileDown, GanttChart, KanbanSquare, List, ListTodo, Plus, Settings2, Trash2, X } from 'lucide-react';
import { api, download } from '../../api/client';
import type { Board, Bucket, Task } from '../../api/types';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Avatar, Badge, Button, EmptyState, ErrorView, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Switch, Tabs, Textarea, cx } from '../../components/ui';
import { BulkBar, DueBadge, PriorityBadge, TaskCard, TaskDialog } from './TaskComponents';
import { TaskTimeline } from './TaskTimeline';
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
  const [creatingBoard, setCreatingBoard] = useState(false);

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
          onClose={() => setCreatingBoard(false)}
          onSaved={(b) => {
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
  const [view, setView] = useState<'board' | 'list' | 'timeline'>(() => {
    try {
      const stored = localStorage.getItem('knowstead.tasks.view');
      return stored === 'list' || stored === 'timeline' ? stored : 'board';
    } catch {
      return 'board';
    }
  });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [newIn, setNewIn] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState('');
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
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

  const move = useMutation({
    mutationFn: ({ id, bucket, index }: { id: number; bucket: string; index: number }) => api.post<Task>(`/api/v1/tasks/${id}/move`, { bucket, index }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['board', boardId] }),
    onError: (err) => toast.error(err),
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

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorView error={error} />;
  const { board } = data;
  const doneShare = board.counts.total ? Math.round((board.counts.done / board.counts.total) * 100) : 0;

  return (
    <>
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
      {view === 'timeline' ? (
        <TaskTimeline board={board} tasks={tasks} onOpen={setOpenTask} />
      ) : view === 'board' ? (
        <div className="board-columns">
          {board.buckets.map((bucket) => {
            const items = tasks.filter((x) => x.bucket === bucket.id);
            return (
              <section
                key={bucket.id}
                className={cx('board-column', dropTarget === bucket.id && 'drop')}
                onDragOver={(e) => {
                  if (!board.canEdit || dragId === null) return;
                  e.preventDefault();
                  setDropTarget(bucket.id);
                }}
                onDragLeave={() => setDropTarget((d) => (d === bucket.id ? null : d))}
                onDrop={(e) => {
                  e.preventDefault();
                  setDropTarget(null);
                  if (dragId === null) return;
                  // Einfügeposition anhand der Mausposition bestimmen.
                  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.task-card')].filter((c) => c.dataset.taskId !== String(dragId));
                  const index = cards.filter((c) => c.getBoundingClientRect().top + c.offsetHeight / 2 < e.clientY).length;
                  move.mutate({ id: dragId, bucket: bucket.id, index });
                  setDragId(null);
                }}
              >
                <header className="board-column-head" style={{ ['--bucket-color' as string]: bucket.color ?? 'var(--accent)' }}>
                  <span className="bucket-dot" />
                  <span className="truncate">{bucket.name}</span>
                  <span className="board-count">{items.length}</span>
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
                  {items.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      draggable={board.canEdit}
                      onDragStart={(e) => {
                        setDragId(task.id);
                        e.dataTransfer.effectAllowed = 'move';
                        // Firefox startet das Ziehen nur mit gesetzten Daten
                        e.dataTransfer.setData('text/plain', task.title);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropTarget(null);
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

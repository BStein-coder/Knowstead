import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat, AlertTriangle, CalendarClock, CheckSquare, Flag, Link2, MessageSquare, Plus, Square, Trash2, UserRound, X } from 'lucide-react';
import { api } from '../../api/client';
import type { TaskRecurrence, Board, ChecklistItem, Task, TaskDependencyInput, TaskPriority, TaskStatus, UserRef } from '../../api/types';
import { localeTag, useI18n, type Locale } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Avatar, Badge, Button, Field, IconButton, Input, Modal, Popover, Select, Switch, Textarea, cx } from '../../components/ui';
import { PagePicker, TagInput, useUserSearch } from '../../components/Pickers';
import { BlockedBadge, DependencyBadge, DependencyEditor } from './TaskDependencies';
import { TaskChat } from './TaskChat';
import { TaskCheck } from './TaskCheck';

export const PRIORITY_COLORS: Record<TaskPriority, string> = { low: 'gray', normal: 'blue', high: 'yellow', urgent: 'red' };

/** Fälligkeit in Kurzform – „14. Okt.“ bzw. “14 Oct”, je nach Sprache der Oberfläche */
export function formatDue(date: string | null, locale: Locale): string {
  if (!date) return '';
  const d = new Date(`${date}T00:00:00`);
  return d.toLocaleDateString(localeTag(locale), { day: '2-digit', month: 'short' });
}

/** Fälligkeitsangabe: rot bei Überfälligkeit, gelb bei „heute/morgen“. */
export function DueBadge({ task }: { task: Pick<Task, 'dueDate' | 'status' | 'overdue'> }) {
  const { t, locale } = useI18n();
  if (!task.dueDate) return null;
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const color = task.status === 'done' ? 'gray' : task.overdue ? 'red' : task.dueDate === today || task.dueDate === tomorrow ? 'yellow' : 'gray';
  return (
    <Badge color={color} title={t('tasks.due')}>
      {task.overdue && task.status !== 'done' ? <AlertTriangle size={11} /> : <CalendarClock size={11} />} {formatDue(task.dueDate, locale)}
    </Badge>
  );
}

/** Anzahl der Nachrichten im Chat – mit Punkt und anderer Farbe, solange für mich etwas ungelesen ist. */
export function ChatBadge({ task }: { task: Task }) {
  const { t } = useI18n();
  if (task.commentCount <= 0) return null;
  const unread = task.unreadComments ?? 0;
  const label = unread > 0 ? (unread === 1 ? t('tasks.chatUnreadOne') : t('tasks.chatUnread', { n: unread })) : task.commentCount === 1 ? t('tasks.chatMessageOne') : t('tasks.chatMessages', { n: task.commentCount });
  return (
    <Badge color={unread > 0 ? 'accent' : 'gray'} title={label} className={unread > 0 ? 'chat-unread' : undefined}>
      <MessageSquare size={11} aria-hidden="true" /> {task.commentCount}
      {unread > 0 && <span className="chat-unread-dot" aria-hidden="true" />}
      <span className="sr-only">{label}</span>
    </Badge>
  );
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  const { t } = useI18n();
  if (priority === 'normal') return null;
  return (
    <Badge color={PRIORITY_COLORS[priority]}>
      <Flag size={11} /> {t(`tasks.priorities.${priority}`)}
    </Badge>
  );
}

/** Kompakte Karte für das Board. */
export function TaskCard({
  task,
  onOpen,
  draggable,
  onDragStart,
  onDragEnd,
  selected,
  index = 0,
  dragging,
  onToggleDone,
}: {
  task: Task;
  /** `multi` = mit Strg/Cmd oder Umschalt geklickt: auswählen statt öffnen */
  onOpen: (multi: boolean) => void;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  selected?: boolean;
  /** Platz in der Spalte – staffelt den Auftritt beim Öffnen der Ansicht (höchstens zwölf Stufen) */
  index?: number;
  /** Wird gerade gezogen */
  dragging?: boolean;
  /** Haken auf der Karte; ohne Angabe fehlt er (keine Schreibrechte) */
  onToggleDone?: (task: Task) => void;
}) {
  const { t } = useI18n();
  const done = task.checklist.filter((c) => c.done).length;
  return (
    <article
      className={cx('task-card', task.status === 'done' && 'done', task.overdue && 'overdue', selected && 'selected', dragging && 'is-dragging')}
      style={{ ['--i' as string]: Math.min(index, 12) }}
      data-flip={`task-${task.id}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      data-task-id={task.id}
      data-selected={selected ? 'true' : undefined}
      onClick={(e) => onOpen(e.ctrlKey || e.metaKey || e.shiftKey)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(e.ctrlKey || e.metaKey || e.shiftKey)}
      tabIndex={0}
      data-priority={task.priority}
    >
      {/* `aria-selected` wäre auf einem <article> nicht erlaubt, deshalb der vorgelesene Hinweis. */}
      {selected && <span className="sr-only">{t('tasks.bulkCardSelected')}</span>}
      {task.labels.length > 0 && (
        <div className="task-card-labels">
          {task.labels.map((l) => (
            <span key={l} className="task-label">
              {l}
            </span>
          ))}
        </div>
      )}
      <div className="task-card-title">
        {onToggleDone && (
          <TaskCheck done={task.status === 'done'} size={20} label={`${task.status === 'done' ? t('tasks.reopen') : t('tasks.complete')}: ${task.title}`} onToggle={() => onToggleDone(task)} />
        )}
        <span className="task-card-title-text">
          {task.title}
          {task.recurrence && <Repeat size={12} className="task-card-repeat" aria-label={t('tasks.repeat')} />}
        </span>
      </div>
      {task.progress > 0 && task.status !== 'done' && (
        <div className="task-progress" aria-label={`${task.progress} %`}>
          <span style={{ width: `${task.progress}%` }} />
        </div>
      )}
      <div className="task-card-meta">
        <PriorityBadge priority={task.priority} />
        <DueBadge task={task} />
        <BlockedBadge task={task} />
        <DependencyBadge task={task} />
        {task.checklist.length > 0 && (
          <Badge color={done === task.checklist.length ? 'green' : 'gray'}>
            <CheckSquare size={11} /> {done}/{task.checklist.length}
          </Badge>
        )}
        <ChatBadge task={task} />
        {task.page && (
          <span className="muted" title={task.page.title}>
            <Link2 size={12} />
          </span>
        )}
        <span className="spacer" />
        {task.assignee ? <Avatar user={task.assignee} size={22} title={task.assignee.displayName} /> : <UserRound size={16} className="faint" />}
      </div>
    </article>
  );
}

/**
 * Aktionsleiste der Mehrfachauswahl: Was man bei mehreren Karten wirklich am Stück ändert –
 * Verantwortliche, Spalte, Fälligkeit, Priorität, erledigt, löschen.
 */
export function BulkBar({ board, ids, onDone, onCancel }: { board: Board; ids: number[]; onDone: () => void; onCancel: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const [busy, setBusy] = useState(false);
  const [assignee, setAssignee] = useState<UserRef | null>(null);

  const run = async (body: { patch?: Record<string, unknown>; delete?: boolean }) => {
    setBusy(true);
    try {
      const res = await api.post<{ changed: number }>('/api/v1/tasks/bulk', { ids, ...body });
      toast.success(t('tasks.bulkDone', { n: res.changed }));
      onDone();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bulk-bar" role="region" aria-label={t('tasks.bulkSelected', { n: ids.length })}>
      <strong>{t('tasks.bulkSelected', { n: ids.length })}</strong>
      <div className="bulk-bar-field">
        <AssigneePicker
          value={assignee}
          onChange={(user) => {
            setAssignee(user);
            void run({ patch: { assigneeId: user?.id ?? null } });
          }}
        />
      </div>
      <Select
        value=""
        disabled={busy}
        aria-label={t('tasks.bucket')}
        onChange={(e) => e.target.value && void run({ patch: { bucket: e.target.value } })}
      >
        <option value="">{t('tasks.bulkBucket')}</option>
        {board.buckets.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
      <Input type="date" disabled={busy} aria-label={t('tasks.due')} onChange={(e) => e.target.value && void run({ patch: { dueDate: e.target.value } })} />
      <Select value="" disabled={busy} aria-label={t('tasks.priority')} onChange={(e) => e.target.value && void run({ patch: { priority: e.target.value } })}>
        <option value="">{t('tasks.bulkPriority')}</option>
        {(['low', 'normal', 'high', 'urgent'] as TaskPriority[]).map((p) => (
          <option key={p} value={p}>
            {t(`tasks.priorities.${p}`)}
          </option>
        ))}
      </Select>
      <Button size="sm" icon={CheckSquare} disabled={busy} onClick={() => void run({ patch: { status: 'done' } })}>
        {t('tasks.bulkDoneStatus')}
      </Button>
      <Button
        size="sm"
        variant="danger"
        icon={Trash2}
        disabled={busy}
        onClick={async () => {
          if (!(await dialogs.confirm({ title: t('tasks.bulkDeleteTitle'), message: t('tasks.bulkDeleteText', { n: ids.length }), danger: true, confirmLabel: t('common.delete') }))) return;
          await run({ delete: true });
        }}
      >
        {t('common.delete')}
      </Button>
      <span className="spacer" />
      <Button size="sm" variant="ghost" onClick={onCancel}>
        {t('common.cancel')}
      </Button>
    </div>
  );
}

/* ------------------------------ Personenauswahl ------------------------------ */

export function AssigneePicker({ value, onChange }: { value: UserRef | null; onChange: (user: UserRef | null) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = useUserSearch(q);
  if (value && !open) {
    return (
      <div className="subject-row">
        <Avatar user={value} size={24} />
        <span className="grow truncate">{value.displayName}</span>
        <IconButton icon={X} label={t('common.remove')} onClick={() => onChange(null)} />
        <Button size="sm" onClick={() => setOpen(true)}>
          {t('common.edit')}
        </Button>
      </div>
    );
  }
  return (
    <div ref={ref}>
      <Input
        icon={UserRound}
        value={q}
        autoFocus={open}
        placeholder={t('tasks.assigneePlaceholder')}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      <Popover anchor={ref.current} open={open && (data?.length ?? 0) > 0} onClose={() => setOpen(false)} matchWidth>
        <div className="picker-list">
          {(data ?? []).map((u) => (
            <button
              key={u.id}
              type="button"
              className="picker-item"
              onClick={() => {
                onChange(u);
                setQ('');
                setOpen(false);
              }}
            >
              <Avatar user={u} size={24} />
              <span className="grow">
                <div>{u.displayName}</div>
                <div className="picker-sub">@{u.username}</div>
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/* ------------------------------ Aufgaben-Dialog ------------------------------ */

interface TaskDialogProps {
  board: Board;
  task: Task | null;
  /** Vorbelegte Spalte beim Anlegen */
  bucket?: string;
  /** Vorbelegte Seite beim Anlegen (z. B. aus einem Makro) */
  pageId?: number | null;
  onClose: () => void;
}

/**
 * Anlegen und Bearbeiten einer Aufgabe. Pflicht ist nur der Titel –
 * alles andere ist optional, damit das Werkzeug leicht bleibt.
 */
export function TaskDialog({ board, task, bucket, pageId, onClose }: TaskDialogProps) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const [title, setTitle] = useState(task?.title ?? '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [assignee, setAssignee] = useState<UserRef | null>(task?.assignee ?? null);
  const [dueDate, setDueDate] = useState(task?.dueDate ?? '');
  const [startDate, setStartDate] = useState(task?.startDate ?? '');
  const [priority, setPriority] = useState<TaskPriority>(task?.priority ?? 'normal');
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? 'open');
  const [progress, setProgress] = useState(task?.progress ?? 0);
  const [progressFromChecklist, setProgressFromChecklist] = useState(task?.progressFromChecklist ?? false);
  const [column, setColumn] = useState(task?.bucket ?? bucket ?? board.buckets[0]?.id ?? '');
  const [labels, setLabels] = useState<string[]>(task?.labels ?? []);
  const [checklist, setChecklist] = useState<ChecklistItem[]>(task?.checklist ?? []);
  const [page, setPage] = useState<{ id: number; title: string } | null>(task?.page ?? null);
  const [newItem, setNewItem] = useState('');
  const [repeat, setRepeat] = useState<string>(task?.recurrence ? `${task.recurrence.freq}:${task.recurrence.interval}` : '');
  const initialPredecessors = (task?.predecessors ?? []).map((p) => ({ taskId: p.taskId, type: p.type, lagDays: p.lagDays }));
  const [predecessors, setPredecessors] = useState<TaskDependencyInput[]>(initialPredecessors);
  // Aufgaben des Plans für die Auswahl der Vorgängerinnen (meist schon im Cache der Planansicht)
  const boardData = useQuery({
    queryKey: ['board', board.id],
    queryFn: () => api.get<{ board: Board; tasks: Task[] }>(`/api/v1/boards/${board.id}`),
  });
  const checklistDone = checklist.filter((c) => c.done).length;
  const checklistProgress = checklist.length ? Math.round((checklistDone / checklist.length) * 100) : 0;
  // Schon im Plan verwendete Stichwörter vorschlagen – spart Tippen und hält die Schreibweise einheitlich
  const labelSuggestions = [...new Set((boardData.data?.tasks ?? []).flatMap((x) => x.labels))].sort((a, b) => a.localeCompare(b));

  useEffect(() => {
    if (!task && pageId) setPage({ id: pageId, title: '…' });
  }, [task, pageId]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['board', board.id] });
    void qc.invalidateQueries({ queryKey: ['tasks'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        notes,
        assigneeId: assignee?.id ?? null,
        dueDate: dueDate || null,
        startDate: startDate || null,
        priority,
        status,
        progress,
        progressFromChecklist,
        bucket: column,
        labels,
        checklist,
        recurrence: repeat ? { freq: repeat.split(':')[0] as TaskRecurrence['freq'], interval: Number(repeat.split(':')[1]) || 1 } : null,
        // Nur bei Änderung senden – sonst würde die automatische Planung unnötig neu rechnen
        ...(JSON.stringify(predecessors) !== JSON.stringify(initialPredecessors) ? { predecessors } : {}),
        // Nur bei Änderung senden: Eine für mich unsichtbare verknüpfte Seite bleibt so erhalten.
        ...(!task || (page?.id ?? null) !== (task.page?.id ?? null) ? { pageId: page?.id ?? null } : {}),
      };
      return task ? api.patch<Task>(`/api/v1/tasks/${task.id}`, body) : api.post<Task>(`/api/v1/boards/${board.id}/tasks`, body);
    },
    onSuccess: (saved) => {
      toast.success(task ? t('common.changesSaved') : t('tasks.created'));
      // Automatische Planung hat die Termine hinter die Vorgängerinnen gelegt
      if ((startDate && saved.startDate !== startDate) || (dueDate && saved.dueDate !== dueDate)) toast.info(t('tasks.alignedToPredecessors'));
      refresh();
      onClose();
    },
    onError: (err) => toast.error(err),
  });

  const remove = async () => {
    if (!task) return;
    const ok = await dialogs.confirm({ title: t('tasks.deleteTitle'), message: t('tasks.deleteText', { title: task.title }), danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    try {
      await api.del(`/api/v1/tasks/${task.id}`);
      refresh();
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };

  const readOnly = !board.canEdit;
  // Der Beginn darf nicht nach der Fälligkeit liegen (der Server lehnt es ebenfalls ab)
  const datesInvalid = !!startDate && !!dueDate && startDate > dueDate;

  return (
    <Modal
      open
      onClose={onClose}
      title={task ? t('tasks.editTitle') : t('tasks.newTitle')}
      // Mit Chat rechts daneben braucht der Dialog mehr Platz
      size={task ? 'xl' : 'lg'}
      footer={
        <>
          {task && !readOnly && (
            <Button variant="ghost" icon={Trash2} onClick={() => void remove()}>
              {t('common.delete')}
            </Button>
          )}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {!readOnly && (
            <Button variant="primary" loading={save.isPending} disabled={!title.trim() || datesInvalid} onClick={() => save.mutate()}>
              {task ? t('common.save') : t('tasks.create')}
            </Button>
          )}
        </>
      }
    >
      <div className={cx('task-dialog', task && 'with-chat')}>
      <form
        className="task-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && !readOnly && !datesInvalid) save.mutate();
        }}
      >
        <Input className="task-title-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('tasks.titlePlaceholder')} autoFocus disabled={readOnly} />
        <div className="task-form-grid">
          <Field label={t('tasks.assignee')}>
            <AssigneePicker value={assignee} onChange={setAssignee} />
          </Field>
          <Field label={t('tasks.bucket')}>
            <Select value={column} onChange={(e) => setColumn(e.target.value)} disabled={readOnly}>
              {board.buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tasks.start')}>
            <Input type="date" value={startDate} max={dueDate || undefined} onChange={(e) => setStartDate(e.target.value)} disabled={readOnly} />
          </Field>
          <Field label={t('tasks.due')} error={datesInvalid ? t('tasks.dateOrder') : undefined}>
            <Input type="date" value={dueDate} min={startDate || undefined} aria-invalid={datesInvalid || undefined} onChange={(e) => setDueDate(e.target.value)} disabled={readOnly} />
          </Field>
          <Field label={t('tasks.priority')}>
            <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} disabled={readOnly}>
              {(['low', 'normal', 'high', 'urgent'] as const).map((p) => (
                <option key={p} value={p}>
                  {t(`tasks.priorities.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('tasks.repeat')} help={repeat && !dueDate ? t('tasks.repeatNeedsDue') : undefined}>
            <Select value={repeat} onChange={(e) => setRepeat(e.target.value)} disabled={readOnly}>
              <option value="">{t('tasks.repeatNone')}</option>
              <option value="daily:1">{t('tasks.repeatDaily')}</option>
              <option value="weekly:1">{t('tasks.repeatWeekly')}</option>
              <option value="weekly:2">{t('tasks.repeatBiweekly')}</option>
              <option value="monthly:1">{t('tasks.repeatMonthly')}</option>
              <option value="monthly:3">{t('tasks.repeatQuarterly')}</option>
              <option value="yearly:1">{t('tasks.repeatYearly')}</option>
            </Select>
          </Field>
          <Field label={t('tasks.status')}>
            <Select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} disabled={readOnly}>
              {(['open', 'doing', 'done'] as const).map((st) => (
                <option key={st} value={st}>
                  {t(`tasks.statuses.${st}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={`${t('tasks.progress')}: ${progressFromChecklist ? checklistProgress : progress} %`}>
          <input
            type="range"
            min={0}
            max={100}
            step={10}
            value={progressFromChecklist ? checklistProgress : progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            disabled={readOnly || progressFromChecklist}
            className="range"
          />
        </Field>
        {/* Eigenes Element statt im Feld: „Field“ verknüpft die Beschriftung nur mit einem einzelnen Bedienelement */}
        <Switch
          checked={progressFromChecklist}
          onChange={setProgressFromChecklist}
          disabled={readOnly}
          label={t('tasks.progressFromChecklist')}
          description={checklist.length ? t('tasks.progressFromChecklistDone', { done: checklistDone, total: checklist.length }) : t('tasks.progressFromChecklistEmpty')}
        />
        <Field label={t('tasks.notes')}>
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('tasks.notesPlaceholder')} disabled={readOnly} />
        </Field>
        <Field label={t('tasks.checklist')}>
          <ul className="task-checklist">
            {checklist.map((item, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setChecklist(checklist.map((c, x) => (x === i ? { ...c, done: !c.done } : c)))}
                  aria-label={item.done ? t('tasks.uncheck') : t('tasks.check')}
                  disabled={readOnly}
                >
                  {item.done ? <CheckSquare size={16} /> : <Square size={16} />}
                </button>
                <span className={cx('grow', item.done && 'muted strike')}>{item.text}</span>
                {!readOnly && <IconButton icon={X} label={t('common.remove')} onClick={() => setChecklist(checklist.filter((_, x) => x !== i))} />}
              </li>
            ))}
          </ul>
          {!readOnly && (
            <div className="row gap-xs">
              <Input
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                placeholder={t('tasks.checklistPlaceholder')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (newItem.trim()) setChecklist([...checklist, { text: newItem.trim(), done: false }]);
                    setNewItem('');
                  }
                }}
              />
              <IconButton
                icon={Plus}
                label={t('common.add')}
                onClick={() => {
                  if (newItem.trim()) setChecklist([...checklist, { text: newItem.trim(), done: false }]);
                  setNewItem('');
                }}
              />
            </div>
          )}
        </Field>
        <Field label={t('tasks.dependencies')}>
          <DependencyEditor
            board={board}
            task={task ?? null}
            tasks={boardData.data?.tasks ?? []}
            value={predecessors}
            onChange={setPredecessors}
            readOnly={readOnly}
            hasDates={!!(startDate || dueDate)}
          />
        </Field>
        <div className="task-form-grid">
          <Field label={t('tasks.labels')}>
            <TagInput value={labels} onChange={setLabels} placeholder={t('tasks.labelsPlaceholder')} suggestions={labelSuggestions} />
          </Field>
          <Field label={t('tasks.page')}>
            <PagePicker value={page} onChange={(p) => setPage(p ? { id: p.id, title: p.title } : null)} spaceKey={board.spaceKey} placeholder={t('tasks.pagePlaceholder')} />
          </Field>
        </div>
        {task?.page && (
          <p className="small muted">
            <Link2 size={12} /> <Link to={task.page.url}>{task.page.title}</Link>
          </p>
        )}
      </form>
      {/* Außerhalb des Formulars (Senden im Chat darf nicht die Aufgabe speichern), rechts daneben */}
      {task && <TaskChat board={board} task={task} />}
      </div>
    </Modal>
  );
}

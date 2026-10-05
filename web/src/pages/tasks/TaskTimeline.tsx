import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarRange, GitBranch, Repeat } from 'lucide-react';
import { api } from '../../api/client';
import type { Board, Task } from '../../api/types';
import { localeTag, useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Avatar, Tabs, cx } from '../../components/ui';
import { TimelineDependencies } from './TaskDependencies';

type Zoom = 'week' | 'month' | 'quarter';
const DAY_WIDTH: Record<Zoom, number> = { week: 34, month: 13, quarter: 5 };
const LABEL_WIDTH = 250;

function parseDay(day: string): number {
  return Date.parse(`${day.slice(0, 10)}T00:00:00.000Z`) / 86400_000;
}

function formatDay(index: number): string {
  return new Date(index * 86400_000).toISOString().slice(0, 10);
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** ISO-Kalenderwoche */
function isoWeek(index: number): number {
  const d = new Date(index * 86400_000);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86400_000 + 1) / 7);
}

interface Drag {
  id: number;
  mode: 'move' | 'start' | 'end';
  originX: number;
  delta: number;
}

/**
 * Zeitachse (Gantt-light): Aufgaben mit Beginn und Fälligkeit als Balken, nach Spalten
 * gruppiert. Balken lassen sich verschieben und an den Enden verlängern.
 */
export function TaskTimeline({ board, tasks, onOpen }: { board: Board; tasks: Task[]; onOpen: (task: Task) => void }) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [zoom, setZoom] = useState<Zoom>(() => {
    try {
      const stored = localStorage.getItem('knowstead.tasks.zoom');
      return stored === 'month' || stored === 'quarter' ? stored : 'week';
    } catch {
      return 'week';
    }
  });
  const [drag, setDragState] = useState<Drag | null>(null);
  // Ref gegen veraltete Werte, weil Zeiger-Ereignisse vom Griff zum Balken durchgereicht werden
  const dragRef = useRef<Drag | null>(null);
  const setDrag = (next: Drag | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const scroller = useRef<HTMLDivElement>(null);
  const [showDeps, setShowDeps] = useState(() => {
    try {
      return localStorage.getItem('knowstead.tasks.dependencies') !== 'off';
    } catch {
      return true;
    }
  });
  const dayWidth = DAY_WIDTH[zoom];
  const today = parseDay(localToday());

  useEffect(() => {
    try {
      localStorage.setItem('knowstead.tasks.zoom', zoom);
      localStorage.setItem('knowstead.tasks.dependencies', showDeps ? 'on' : 'off');
    } catch {
      /* ignorieren */
    }
  }, [zoom, showDeps]);

  const hasDependencies = tasks.some((x) => x.predecessors.length > 0);
  const conflicts = tasks.reduce((n, x) => n + x.predecessors.filter((p) => p.violated).length, 0);

  const dated = tasks.filter((x) => x.startDate || x.dueDate);
  const undated = tasks.filter((x) => !x.startDate && !x.dueDate);

  // Sichtbarer Zeitraum: mindestens eine Woche zurück und sechs Wochen voraus, am Montag beginnend.
  const range = useMemo(() => {
    let min = today - 7;
    let max = today + (zoom === 'quarter' ? 180 : zoom === 'month' ? 90 : 42);
    for (const x of dated) {
      for (const d of [x.startDate, x.dueDate]) {
        if (!d) continue;
        min = Math.min(min, parseDay(d) - 3);
        max = Math.max(max, parseDay(d) + 7);
      }
    }
    const weekday = (new Date(min * 86400_000).getUTCDay() + 6) % 7;
    min -= weekday;
    return { start: min, days: max - min + 1 };
  }, [dated, today, zoom]);

  const groups = board.buckets
    .map((bucket) => ({
      bucket,
      items: dated
        .filter((x) => x.bucket === bucket.id)
        .sort((a, b) => (a.startDate ?? a.dueDate ?? '').localeCompare(b.startDate ?? b.dueDate ?? '')),
    }))
    .filter((g) => g.items.length);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, (today - range.start - 5) * dayWidth);
    // Nur beim Wechsel des Maßstabs zu „heute“ springen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const span = (task: Task, preview?: Drag | null) => {
    let start = task.startDate ? parseDay(task.startDate) : parseDay(task.dueDate!);
    let end = task.dueDate ? parseDay(task.dueDate) : start;
    if (end < start) [start, end] = [end, start];
    if (preview && preview.id === task.id) {
      if (preview.mode === 'move') {
        start += preview.delta;
        end += preview.delta;
      } else if (preview.mode === 'start') start = Math.min(start + preview.delta, end);
      else end = Math.max(end + preview.delta, start);
    }
    return { start, end, milestone: !task.startDate && !!task.dueDate };
  };

  const commit = async (task: Task, d: Drag) => {
    const { start, end, milestone } = span(task, d);
    // Beim Verschieben bleiben Meilensteine (nur Fälligkeit) und Aufgaben nur mit Beginn, was sie sind
    const body: { startDate?: string; dueDate?: string } =
      d.mode === 'move' && milestone
        ? { dueDate: formatDay(end) }
        : d.mode === 'move' && !task.dueDate
          ? { startDate: formatDay(start) }
          : { startDate: formatDay(start), dueDate: formatDay(end) };
    try {
      const saved = await api.patch<Task>(`/api/v1/tasks/${task.id}`, body);
      // Automatische Planung: Vor einer Vorgängerin abgelegt, rückt die Aufgabe dahinter – das nicht stillschweigend tun
      if ((body.startDate && saved.startDate !== body.startDate) || (body.dueDate && saved.dueDate !== body.dueDate)) {
        toast.info(t('tasks.alignedToPredecessors'));
      }
      void qc.invalidateQueries({ queryKey: ['board', board.id] });
      void qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (err) {
      toast.error(err);
    }
  };

  const onPointerDown = (e: React.PointerEvent, task: Task, mode: Drag['mode']) => {
    if (!board.canEdit || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDrag({ id: task.id, mode, originX: e.clientX, delta: 0 });
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const current = dragRef.current;
    if (!current) return;
    e.stopPropagation();
    const delta = Math.round((e.clientX - current.originX) / dayWidth);
    if (delta !== current.delta) setDrag({ ...current, delta });
  };
  const onPointerUp = (e: React.PointerEvent, task: Task) => {
    const current = dragRef.current;
    if (!current) return;
    e.stopPropagation();
    setDrag(null);
    if (current.delta === 0) {
      if (current.mode === 'move') onOpen(task);
      return;
    }
    void commit(task, current);
  };

  // Kopfzeilen: Monate und Tage bzw. Kalenderwochen
  const days = Array.from({ length: range.days }, (_, i) => range.start + i);
  const months: { label: string; from: number; count: number }[] = [];
  for (const d of days) {
    const date = new Date(d * 86400_000);
    const label = date.toLocaleDateString(localeTag(locale), { month: zoom === 'quarter' ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' });
    const last = months[months.length - 1];
    if (last && last.label === label) last.count++;
    else months.push({ label, from: d, count: 1 });
  }
  const width = range.days * dayWidth;

  return (
    <div className="timeline-wrap">
      <div className="timeline-toolbar">
        <CalendarRange size={15} className="muted" />
        <span className="small muted">{t('tasks.timelineHint')}</span>
        <span className="spacer" />
        {conflicts > 0 && <span className="small danger-text">{conflicts === 1 ? t('tasks.dependencyConflict') : t('tasks.dependencyConflicts', { n: conflicts })}</span>}
        {hasDependencies && (
          <button type="button" className={cx('btn btn-sm', showDeps ? 'btn-secondary' : 'btn-ghost')} aria-pressed={showDeps} onClick={() => setShowDeps(!showDeps)}>
            <GitBranch size={14} /> {t('tasks.showDependencies')}
          </button>
        )}
        <Tabs
          value={zoom}
          onChange={setZoom}
          items={[
            { value: 'week', label: t('tasks.zoomWeek') },
            { value: 'month', label: t('tasks.zoomMonth') },
            { value: 'quarter', label: t('tasks.zoomQuarter') },
          ]}
        />
      </div>
      {!dated.length ? (
        <div className="timeline-empty small muted">{t('tasks.timelineEmpty')}</div>
      ) : (
        <div className="timeline" ref={scroller}>
          <div className="timeline-inner" style={{ width: LABEL_WIDTH + width }}>
            <div className="timeline-head" style={{ gridTemplateColumns: `${LABEL_WIDTH}px ${width}px` }}>
              <div className="timeline-corner" />
              <div className="timeline-scale">
                <div className="timeline-months">
                  {months.map((m) => (
                    <span key={m.from} style={{ left: (m.from - range.start) * dayWidth, width: m.count * dayWidth }}>
                      {m.count * dayWidth > 60 ? m.label : ''}
                    </span>
                  ))}
                </div>
                <div className="timeline-days">
                  {days.map((d) => {
                    const date = new Date(d * 86400_000);
                    const weekday = (date.getUTCDay() + 6) % 7;
                    if (zoom !== 'week' && weekday !== 0) return null;
                    return (
                      <span
                        key={d}
                        className={cx(d === today && 'today', weekday >= 5 && 'weekend')}
                        style={{ left: (d - range.start) * dayWidth, width: zoom === 'week' ? dayWidth : dayWidth * 7 }}
                      >
                        {zoom === 'week' ? date.getUTCDate() : zoom === 'month' ? t('tasks.weekShort', { n: isoWeek(d) }) : isoWeek(d) % 2 ? isoWeek(d) : ''}
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="timeline-body" style={{ gridTemplateColumns: `${LABEL_WIDTH}px ${width}px` }}>
              {showDeps && hasDependencies && (
                <TimelineDependencies tasks={dated} version={`${zoom}:${range.start}:${drag?.id}:${drag?.delta}:${tasks.map((x) => `${x.id}${x.startDate}${x.dueDate}${x.bucket}`).join()}`} />
              )}
              <div className="timeline-grid-bg" style={{ left: LABEL_WIDTH, width }}>
                {zoom !== 'quarter' &&
                  days
                    .filter((d) => (new Date(d * 86400_000).getUTCDay() + 6) % 7 >= 5)
                    .map((d) => <span key={d} className="timeline-weekend" style={{ left: (d - range.start) * dayWidth, width: dayWidth }} />)}
                <span className="timeline-today" style={{ left: (today - range.start) * dayWidth + dayWidth / 2 }} title={t('tasks.groups.today')} />
              </div>
              {groups.map((g) => (
                <div key={g.bucket.id} className="timeline-group" style={{ ['--bucket-color' as string]: g.bucket.color ?? 'var(--accent)' }}>
                  <div className="timeline-group-title">
                    <span className="bucket-dot" /> {g.bucket.name}
                  </div>
                  <div />
                  {g.items.map((task) => {
                    const { start, end, milestone } = span(task, drag);
                    const left = (start - range.start) * dayWidth;
                    const barWidth = (end - start + 1) * dayWidth;
                    return (
                      <div key={task.id} className="timeline-row">
                        <button type="button" className={cx('timeline-label', task.status === 'done' && 'done')} onClick={() => onOpen(task)} title={task.title}>
                          <span className="truncate">{task.title}</span>
                          {task.recurrence && <Repeat size={12} className="muted" />}
                          {task.assignee && <Avatar user={task.assignee} size={18} title={task.assignee.displayName} />}
                        </button>
                        <div className="timeline-track">
                          {milestone ? (
                            <span
                              data-bar-id={task.id}
                              className={cx('timeline-milestone', task.status === 'done' && 'done', task.overdue && 'overdue')}
                              style={{ left: left + dayWidth / 2 }}
                              title={`${task.title} · ${formatDay(end)}`}
                              onPointerDown={(e) => onPointerDown(e, task, 'move')}
                              onPointerMove={onPointerMove}
                              onPointerUp={(e) => onPointerUp(e, task)}
                            />
                          ) : (
                            <span
                              data-bar-id={task.id}
                              className={cx('timeline-bar', task.status === 'done' && 'done', task.overdue && 'overdue', drag?.id === task.id && 'dragging', board.canEdit && 'editable')}
                              style={{ left, width: Math.max(barWidth, 6) }}
                              title={`${task.title} · ${formatDay(start)} – ${formatDay(end)}`}
                              onPointerDown={(e) => onPointerDown(e, task, 'move')}
                              onPointerMove={onPointerMove}
                              onPointerUp={(e) => onPointerUp(e, task)}
                            >
                              {board.canEdit && (
                                <span
                                  className="timeline-handle start"
                                  onPointerDown={(e) => onPointerDown(e, task, 'start')}
                                  onPointerMove={onPointerMove}
                                  onPointerUp={(e) => onPointerUp(e, task)}
                                />
                              )}
                              <span className="timeline-bar-progress" style={{ width: `${task.status === 'done' ? 100 : task.progress}%` }} />
                              {barWidth > 70 && <span className="timeline-bar-label">{task.title}</span>}
                              {board.canEdit && (
                                <span
                                  className="timeline-handle end"
                                  onPointerDown={(e) => onPointerDown(e, task, 'end')}
                                  onPointerMove={onPointerMove}
                                  onPointerUp={(e) => onPointerUp(e, task)}
                                />
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {undated.length > 0 && (
        <div className="timeline-undated">
          <div className="small muted">{t('tasks.withoutDate', { n: undated.length })}</div>
          <div className="timeline-undated-list">
            {undated.map((task) => {
              // Abhängigkeiten ohne Termin: Der Pfeil fehlt zwangsläufig – das Zeichen sagt, warum
              const linked = task.predecessors.length + task.successors.length > 0;
              return (
                <button
                  key={task.id}
                  type="button"
                  className="chip"
                  onClick={() => onOpen(task)}
                  title={linked ? t('tasks.dependencyNeedsDate') : undefined}
                >
                  {linked && <GitBranch size={12} className="muted" />}
                  {task.title}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

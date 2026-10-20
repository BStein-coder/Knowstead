import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Task, TaskPriority } from '../../api/types';
import { localeTag, useI18n } from '../../i18n';
import { Avatar, Badge, Button, IconButton, cx } from '../../components/ui';
import { useCountUp } from '../../lib/motion';
import { useFlash } from '../../lib/flip';
import { TaskCheck } from './TaskCheck';

/* ------------------------------ Datumsrechnung (Ortszeit, Woche beginnt am Montag) ------------------------------ */

const pad = (n: number) => String(n).padStart(2, '0');
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => new Date(`${s}T00:00:00`);
const addDays = (d: Date, n: number) => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};
const startOfWeek = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

const PRIORITY_ORDER: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };

/** Offene zuerst, dann nach Priorität, dann nach Titel – so stehen die dringenden Aufgaben oben im Feld. */
function byImportance(a: Task, b: Task): number {
  const done = Number(a.status === 'done') - Number(b.status === 'done');
  return done || PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.title.localeCompare(b.title);
}

/** Sichtbarer Zeitraum eines Kalenders – die Seite „Kalender“ lädt genau diesen. */
export function calendarRange(mode: 'month' | 'week', cursor: Date): { from: string; to: string } {
  if (mode === 'week') {
    const first = startOfWeek(cursor);
    return { from: ymd(first), to: ymd(addDays(first, 6)) };
  }
  const first = startOfWeek(startOfMonth(cursor));
  const last = addDays(startOfWeek(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)), 6);
  return { from: ymd(first), to: ymd(last) };
}

interface Props {
  tasks: Task[];
  /** Offene, überfällige Aufgaben für „Heute“ – ohne Angabe die überfälligen unter `tasks` */
  overdue?: Task[];
  onOpen: (task: Task) => void;
  /** Aufgabe erledigen/wieder öffnen; ohne Angabe fehlt der Haken */
  onToggle?: (task: Task) => void;
  /** Plan- und Bereichsname in der Liste zeigen (bereichsübergreifend) */
  showPlan?: boolean;
  /** Zusätzliche Bedienelemente rechts in der Leiste (z. B. „Meine/Alle“) */
  controls?: ReactNode;
  /** Meldet den sichtbaren Zeitraum, sobald er sich ändert (Monat/Woche, Blättern) */
  onRange?: (range: { from: string; to: string }) => void;
}

/**
 * Kalender der Fälligkeiten: Monat oder Woche, daneben die Liste des gewählten Tages (zunächst heute, mit allem,
 * was überfällig ist). Die Aufgaben stehen an ihrem Fälligkeitstag; ohne Fälligkeit erscheinen sie nicht.
 */
export function TaskCalendar({ tasks, overdue, onOpen, onToggle, showPlan, controls, onRange }: Props) {
  const { t, locale } = useI18n();
  const tag = localeTag(locale);
  const todayStr = ymd(new Date());
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(todayStr);
  // Blätterrichtung steuert, von wo das Raster hereingleitet
  const [direction, setDirection] = useState<'next' | 'prev' | 'none'>('none');

  const range = useMemo(() => calendarRange(mode, cursor), [mode, cursor]);
  useEffect(() => {
    onRange?.(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- nur bei geändertem Zeitraum melden, nicht bei neuer Funktion
  }, [range.from, range.to]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.dueDate) continue;
      const list = map.get(task.dueDate) ?? [];
      list.push(task);
      map.set(task.dueDate, list);
    }
    for (const list of map.values()) list.sort(byImportance);
    return map;
  }, [tasks]);
  const undated = useMemo(() => tasks.filter((x) => !x.dueDate && x.status !== 'done').length, [tasks]);

  const days = useMemo(() => {
    const first = parse(range.from);
    const count = mode === 'week' ? 7 : Math.round((parse(range.to).getTime() - first.getTime()) / 86400000) + 1;
    return Array.from({ length: count }, (_, i) => addDays(first, i));
  }, [range, mode]);
  const weeks = useMemo(() => Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)), [days]);

  const step = (dir: 1 | -1) => {
    setDirection(dir === 1 ? 'next' : 'prev');
    setCursor((c) => (mode === 'week' ? addDays(c, 7 * dir) : new Date(c.getFullYear(), c.getMonth() + dir, 1)));
  };
  const goToday = () => {
    setDirection('none');
    setCursor(new Date());
    setSelected(todayStr);
  };

  const label =
    mode === 'month'
      ? cursor.toLocaleDateString(tag, { month: 'long', year: 'numeric' })
      : `${parse(range.from).toLocaleDateString(tag, { day: 'numeric', month: 'short' })} – ${parse(range.to).toLocaleDateString(tag, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  const weekdayNames = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(parse('2024-01-01'), i).toLocaleDateString(tag, { weekday: 'short' })), [tag]);

  const countText = (n: number) => (n === 0 ? t('planner.calendar.countNone') : n === 1 ? t('planner.calendar.countOne') : t('planner.calendar.countMany', { n }));

  const selectedTasks = byDay.get(selected) ?? [];
  const lateTasks = useMemo(
    () => (selected === todayStr ? (overdue ?? tasks.filter((x) => x.status !== 'done' && !!x.dueDate && x.dueDate < todayStr)).slice().sort(byImportance) : []),
    [selected, todayStr, overdue, tasks],
  );
  const selectedDate = parse(selected);
  const gridKey = `${mode}-${range.from}`;

  const row = (task: Task, index: number) => {
    return (
      <li key={task.id} className={cx('cal-item', task.status === 'done' && 'done')} data-priority={task.priority} style={{ ['--i' as string]: index }}>
        {onToggle && <TaskCheck done={task.status === 'done'} size={20} label={`${task.status === 'done' ? t('tasks.reopen') : t('tasks.complete')}: ${task.title}`} onToggle={() => onToggle(task)} />}
        <button type="button" className="cal-item-main" onClick={() => onOpen(task)}>
          <span className="cal-item-title">{task.title}</span>
          <span className="cal-item-meta">
            {showPlan ? `${task.spaceName} · ${task.boardName}` : task.dueDate && task.dueDate < todayStr && task.status !== 'done' ? parse(task.dueDate).toLocaleDateString(tag, { day: 'numeric', month: 'short' }) : (task.assignee?.displayName ?? '')}
          </span>
        </button>
        {task.assignee && <Avatar user={task.assignee} size={22} title={task.assignee.displayName} />}
      </li>
    );
  };

  const chip = (task: Task, index: number) => (
    <button
      key={task.id}
      type="button"
      className={cx('cal-chip', task.status === 'done' && 'done', task.overdue && 'overdue')}
      data-priority={task.priority}
      style={{ ['--i' as string]: index }}
      onClick={() => onOpen(task)}
      title={task.title}
    >
      <span className="cal-chip-dot" aria-hidden="true" />
      <span className="cal-chip-text">{task.title}</span>
    </button>
  );

  return (
    <div className="cal">
      <div className="cal-bar">
        <div className="cal-nav">
          <IconButton icon={ChevronLeft} label={t('planner.calendar.previous')} onClick={() => step(-1)} />
          <Button size="sm" onClick={goToday}>
            {t('planner.calendar.today')}
          </Button>
          <IconButton icon={ChevronRight} label={t('planner.calendar.next')} onClick={() => step(1)} />
        </div>
        <h2 className="cal-title" aria-live="polite">
          {label}
        </h2>
        <span className="spacer" />
        {controls}
        <div className="cal-modes" role="group" aria-label={t('planner.calendar.grid')}>
          {(['month', 'week'] as const).map((m) => (
            <button key={m} type="button" className={cx('cal-mode', mode === m && 'active')} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {t(`planner.calendar.${m}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="cal-body">
        <div className="cal-main">
          <table className={cx('cal-grid', mode)}>
            <thead>
              <tr>
                {weekdayNames.map((name) => (
                  <th key={name} scope="col">
                    {name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody key={gridKey} className={cx('cal-slide', direction !== 'none' && direction)}>
              {weeks.map((week) => (
                <tr key={ymd(week[0])}>
                  {week.map((day, column) => {
                    const key = ymd(day);
                    const list = byDay.get(key) ?? [];
                    const outside = mode === 'month' && day.getMonth() !== cursor.getMonth();
                    const shown = mode === 'week' ? list : list.slice(0, 3);
                    return (
                      <td key={key} className={cx('cal-cell', outside && 'outside', key === todayStr && 'today', key === selected && 'selected', list.length > 0 && 'busy')}>
                        <button
                          type="button"
                          className="cal-num"
                          aria-label={t('planner.calendar.dayLabel', { date: day.toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'long' }), count: countText(list.length) })}
                          aria-pressed={key === selected}
                          onClick={() => setSelected(key)}
                        >
                          {day.getDate()}
                        </button>
                        <div className="cal-chips">
                          {shown.map((task, i) => chip(task, column + i))}
                          {mode === 'month' && list.length > shown.length && (
                            <button type="button" className="cal-more" onClick={() => setSelected(key)}>
                              {t('planner.calendar.more', { n: list.length - shown.length })}
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {undated > 0 && <p className="cal-note muted small">{t('planner.calendar.withoutDate', { n: undated })}</p>}
        </div>

        <aside className="cal-panel" aria-label={selectedDate.toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'long' })}>
          <div className="cal-panel-head">
            <div>
              <h3 className="cal-panel-title">{selected === todayStr ? t('planner.calendar.today') : selectedDate.toLocaleDateString(tag, { weekday: 'long' })}</h3>
              <div className="muted small">
                {selectedDate.toLocaleDateString(tag, { day: 'numeric', month: 'long', year: 'numeric' })} · {countText(selectedTasks.length)}
              </div>
            </div>
          </div>
          {lateTasks.length > 0 && (
            <section className="cal-panel-group">
              <h4 className="cal-panel-sub danger">
                {t('planner.calendar.panelOverdue')} <PanelCount n={lateTasks.length} tone="red" />
              </h4>
              <ul className="cal-list">{lateTasks.map((task, i) => row(task, i))}</ul>
            </section>
          )}
          <section className="cal-panel-group">
            {lateTasks.length > 0 && selectedTasks.length > 0 && (
              <h4 className="cal-panel-sub">
                {t('planner.calendar.panelDue')} <PanelCount n={selectedTasks.length} tone="gray" />
              </h4>
            )}
            {selectedTasks.length ? <ul className="cal-list">{selectedTasks.map((task, i) => row(task, i))}</ul> : lateTasks.length === 0 && <p className="muted small">{t('planner.calendar.panelEmpty')}</p>}
          </section>
        </aside>
      </div>
    </div>
  );
}

/** Zähler an der Überschrift der Liste: zählt hoch und leuchtet kurz auf, wenn er sich ändert. */
function PanelCount({ n, tone }: { n: number; tone: 'red' | 'gray' }) {
  const shown = useCountUp(n, 500) ?? n;
  const flash = useFlash(n);
  return (
    <Badge color={tone} className={flash}>
      {shown}
    </Badge>
  );
}

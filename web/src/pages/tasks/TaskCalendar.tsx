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
/** Tage von `b` bis `a` (beides `YYYY-MM-DD`; unabhängig von Zeitzone und Sommerzeit) */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000);

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

/* ------------------------------ Zeiträume als Balken ------------------------------ */

/** Zeitraum einer Aufgabe: Beginn bis Fälligkeit; fehlt eines von beiden, ist es der eine Tag. Ohne beides: kein Termin. */
interface Span {
  task: Task;
  start: string;
  end: string;
}

function spanOf(task: Task): Span | null {
  const { startDate, dueDate } = task;
  if (!startDate && !dueDate) return null;
  const a = startDate ?? dueDate!;
  const b = dueDate ?? startDate!;
  return a <= b ? { task, start: a, end: b } : { task, start: b, end: a };
}

/** Der Teil eines Zeitraums, der in einer Wochenzeile liegt: von Spalte `from` bis `to` (0 = Montag) auf einer Bahn. */
interface Segment {
  span: Span;
  lane: number;
  from: number;
  to: number;
  /** Der Zeitraum beginnt in dieser Woche (sonst läuft er aus der Vorwoche herein) bzw. endet in ihr (sonst weiter) */
  startsHere: boolean;
  endsHere: boolean;
}

/**
 * Verteilt die Zeiträume einer Woche auf Bahnen, so dass sich keine zwei überlappen: Wer früher beginnt und länger
 * läuft, bekommt die obere Bahn. In einer Bahn steht jede Aufgabe an allen ihren Tagen auf gleicher Höhe.
 */
function layoutWeek(weekStart: string, weekEnd: string, spans: Span[]): Segment[] {
  const inWeek = spans
    .filter((s) => s.start <= weekEnd && s.end >= weekStart)
    .map((span) => ({ span, from: Math.max(0, daysBetween(span.start, weekStart)), to: Math.min(6, daysBetween(span.end, weekStart)), startsHere: span.start >= weekStart, endsHere: span.end <= weekEnd }));
  inWeek.sort((a, b) => a.from - b.from || b.to - a.to || byImportance(a.span.task, b.span.task));
  const laneEnds: number[] = [];
  return inWeek.map((segment) => {
    let lane = laneEnds.findIndex((end) => end < segment.from);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(segment.to);
    } else laneEnds[lane] = segment.to;
    return { ...segment, lane };
  });
}

/** Im Monat zeigt ein Tag höchstens so viele Bahnen; der Rest steht hinter „+n weitere“. */
const MONTH_LANES = 3;

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
 * Kalender der Termine: Monat oder Woche, daneben die Liste des gewählten Tages (zunächst heute, mit allem, was
 * überfällig ist). Eine Aufgabe steht über ihren ganzen Zeitraum – als durchgehender Balken von ihrem Beginn bis zur
 * Fälligkeit; hat sie nur einen von beiden, steht sie an diesem Tag. Ohne Beginn und Fälligkeit erscheint sie nicht.
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

  const spans = useMemo(() => tasks.flatMap((task) => spanOf(task) ?? []), [tasks]);
  const undated = useMemo(() => tasks.filter((x) => !x.startDate && !x.dueDate && x.status !== 'done').length, [tasks]);

  const days = useMemo(() => {
    const first = parse(range.from);
    const count = mode === 'week' ? 7 : daysBetween(range.to, range.from) + 1;
    return Array.from({ length: count }, (_, i) => addDays(first, i));
  }, [range, mode]);
  const weeks = useMemo(() => Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)), [days]);
  const layouts = useMemo(() => weeks.map((week) => layoutWeek(ymd(week[0]), ymd(week[6]), spans)), [weeks, spans]);

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
  const short = (date: string) => parse(date).toLocaleDateString(tag, { day: 'numeric', month: 'short' });

  const countText = (n: number) => (n === 0 ? t('planner.calendar.countNone') : n === 1 ? t('planner.calendar.countOne') : t('planner.calendar.countMany', { n }));

  // Liste des gewählten Tages: was an diesem Tag fällig ist, was an ihm läuft, und (heute) was überfällig ist
  const activeOnSelected = useMemo(() => spans.filter((s) => s.start <= selected && selected <= s.end).map((s) => s.task).sort(byImportance), [spans, selected]);
  const dueSelected = activeOnSelected.filter((x) => x.dueDate === selected);
  const runningSelected = activeOnSelected.filter((x) => x.dueDate !== selected);
  const lateTasks = useMemo(
    () => (selected === todayStr ? (overdue ?? tasks.filter((x) => x.status !== 'done' && !!x.dueDate && x.dueDate < todayStr)).slice().sort(byImportance) : []),
    [selected, todayStr, overdue, tasks],
  );
  const selectedDate = parse(selected);
  const gridKey = `${mode}-${range.from}`;

  /** Zusatz unter dem Titel in der Liste: Beginn und Ende, wo sie nicht ohnehin der gewählte Tag sind */
  const spanNote = (task: Task): string => {
    if (!task.dueDate) return t('planner.calendar.starts');
    if (task.dueDate <= selected) return '';
    const until = short(task.dueDate);
    return task.startDate === selected ? t('planner.calendar.startsUntil', { date: until }) : t('planner.calendar.runsUntil', { date: until });
  };

  const row = (task: Task, index: number) => {
    const meta = [spanNote(task), showPlan ? `${task.spaceName} · ${task.boardName}` : task.dueDate && task.dueDate < todayStr && task.status !== 'done' ? short(task.dueDate) : (task.assignee?.displayName ?? '')].filter(Boolean).join(' · ');
    return (
      <li key={task.id} className={cx('cal-item', task.status === 'done' && 'done')} data-priority={task.priority} style={{ ['--i' as string]: index }}>
        {onToggle && <TaskCheck done={task.status === 'done'} size={20} label={`${task.status === 'done' ? t('tasks.reopen') : t('tasks.complete')}: ${task.title}`} onToggle={() => onToggle(task)} />}
        <button type="button" className="cal-item-main" onClick={() => onOpen(task)}>
          <span className="cal-item-title">{task.title}</span>
          <span className="cal-item-meta">{meta}</span>
        </button>
        {task.assignee && <Avatar user={task.assignee} size={22} title={task.assignee.displayName} />}
      </li>
    );
  };

  /** Balken eines Zeitraums, gezeichnet in der Zelle, in der er in der Wochenzeile beginnt – er reicht über seine Tage */
  const bar = (segment: Segment, index: number) => {
    const { task, start, end } = segment.span;
    const multi = start !== end;
    const text = multi ? `${task.title} · ${short(start)} – ${short(end)}` : task.title;
    return (
      <button
        key={task.id}
        type="button"
        className={cx('cal-chip', 'lead', task.status === 'done' && 'done', task.overdue && 'overdue', !segment.startsHere && 'from-before', !segment.endsHere && 'to-after')}
        data-priority={task.priority}
        style={{ ['--i' as string]: index, ['--span' as string]: segment.to - segment.from + 1, ['--inset-l' as string]: segment.startsHere ? '2px' : '0px', ['--inset-r' as string]: segment.endsHere ? '2px' : '0px' }}
        onClick={() => onOpen(task)}
        title={text}
        aria-label={text}
      >
        <span className="cal-chip-dot" aria-hidden="true" />
        <span className="cal-chip-text">{task.title}</span>
      </button>
    );
  };

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
              {weeks.map((week, weekIndex) => (
                <tr key={ymd(week[0])}>
                  {week.map((day, column) => {
                    const key = ymd(day);
                    const covering = layouts[weekIndex].filter((s) => s.from <= column && column <= s.to);
                    const visible = mode === 'week' ? covering : covering.filter((s) => s.lane < MONTH_LANES);
                    const hidden = covering.length - visible.length;
                    const lanes = visible.reduce((n, s) => Math.max(n, s.lane + 1), 0);
                    const outside = mode === 'month' && day.getMonth() !== cursor.getMonth();
                    return (
                      <td key={key} className={cx('cal-cell', outside && 'outside', key === todayStr && 'today', key === selected && 'selected', covering.length > 0 && 'busy')}>
                        <button
                          type="button"
                          className="cal-num"
                          aria-label={t('planner.calendar.dayLabel', { date: day.toLocaleDateString(tag, { weekday: 'long', day: 'numeric', month: 'long' }), count: countText(covering.length) })}
                          aria-pressed={key === selected}
                          onClick={() => setSelected(key)}
                        >
                          {day.getDate()}
                        </button>
                        <div className="cal-chips">
                          {Array.from({ length: lanes }, (_, lane) => {
                            const segment = visible.find((s) => s.lane === lane);
                            // Der Balken beginnt in seiner ersten Zelle und liegt über den folgenden; dort bleibt die Bahn frei
                            return segment && segment.from === column ? bar(segment, column + lane) : <span key={`gap-${lane}`} className="cal-gap" aria-hidden="true" />;
                          })}
                          {hidden > 0 && (
                            <button type="button" className="cal-more" onClick={() => setSelected(key)}>
                              {t('planner.calendar.more', { n: hidden })}
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
                {selectedDate.toLocaleDateString(tag, { day: 'numeric', month: 'long', year: 'numeric' })} · {countText(activeOnSelected.length)}
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
          {dueSelected.length > 0 && (
            <section className="cal-panel-group">
              {(lateTasks.length > 0 || runningSelected.length > 0) && (
                <h4 className="cal-panel-sub">
                  {t('planner.calendar.panelDue')} <PanelCount n={dueSelected.length} tone="gray" />
                </h4>
              )}
              <ul className="cal-list">{dueSelected.map((task, i) => row(task, i))}</ul>
            </section>
          )}
          {runningSelected.length > 0 && (
            <section className="cal-panel-group">
              {(lateTasks.length > 0 || dueSelected.length > 0) && (
                <h4 className="cal-panel-sub">
                  {t('planner.calendar.panelRunning')} <PanelCount n={runningSelected.length} tone="gray" />
                </h4>
              )}
              <ul className="cal-list">{runningSelected.map((task, i) => row(task, i))}</ul>
            </section>
          )}
          {lateTasks.length === 0 && activeOnSelected.length === 0 && <p className="muted small">{t('planner.calendar.panelEmpty')}</p>}
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

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { AlertTriangle, ArrowRight, GitBranch, Hourglass, X } from 'lucide-react';
import type { Board, DependencyType, Task, TaskDependencyInput, TaskStatus } from '../../api/types';
import { useI18n } from '../../i18n';
import { Badge, IconButton, Input, Select, cx } from '../../components/ui';

const TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];

/** Alle Aufgaben, die (über beliebig viele Stufen) auf `taskId` warten – sie dürfen keine Vorgängerin werden. */
function transitiveSuccessors(taskId: number, tasks: Task[]): Set<number> {
  const byId = new Map(tasks.map((x) => [x.id, x]));
  const result = new Set<number>();
  const queue = [taskId];
  while (queue.length) {
    const current = byId.get(queue.shift()!);
    for (const s of current?.successors ?? []) {
      if (result.has(s.taskId)) continue;
      result.add(s.taskId);
      queue.push(s.taskId);
    }
  }
  return result;
}

/**
 * Versatz in Tagen. Der Text wird getrennt vom Zahlenwert gehalten: Ein Zahlenfeld meldet während der Eingabe
 * von „-2“ zunächst einen leeren Wert – als Zahl gespeichert, würde daraus „0“ und am Ende „+2“.
 */
function LagInput({ value, onChange, disabled, label }: { value: number; onChange: (next: number) => void; disabled: boolean; label: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => {
    // Änderungen von außen übernehmen, eine laufende Eingabe mit gleichem Wert aber stehen lassen
    setText((current) => (current.trim() !== '' && Number(current) === value ? current : String(value)));
  }, [value]);
  return (
    <Input
      className="input-sm"
      type="number"
      min={-365}
      max={365}
      step={1}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(parsed)) onChange(Math.max(-365, Math.min(365, Math.round(parsed))));
      }}
      onBlur={() => setText(String(value))}
      disabled={disabled}
      aria-label={label}
      title={label}
    />
  );
}

/** Vorgängerinnen im Aufgabendialog bearbeiten; Nachfolgerinnen werden nur angezeigt. */
export function DependencyEditor({
  board,
  task,
  tasks,
  value,
  onChange,
  readOnly,
  hasDates,
}: {
  board: Board;
  task: Task | null;
  tasks: Task[];
  value: TaskDependencyInput[];
  onChange: (next: TaskDependencyInput[]) => void;
  readOnly: boolean;
  /** Beginn oder Fälligkeit gesetzt? Ohne Termin gibt es auf der Zeitachse weder Balken noch Pfeil. */
  hasDates: boolean;
}) {
  const { t } = useI18n();
  // Vorgängerinnen dürfen in anderen Plänen liegen; die Liste zeigt den gewählten Plan
  const [pickerBoard, setPickerBoard] = useState(board.id);
  const boards = useQuery({
    queryKey: ['boards-all'],
    queryFn: () => api.get<{ items: Board[] }>('/api/v1/boards'),
    enabled: !readOnly,
  });
  const otherBoard = useQuery({
    queryKey: ['board', pickerBoard],
    queryFn: () => api.get<{ board: Board; tasks: Task[] }>(`/api/v1/boards/${pickerBoard}`),
    enabled: !readOnly && pickerBoard !== board.id,
  });
  const pickerTasks = useMemo(() => (pickerBoard === board.id ? tasks : (otherBoard.data?.tasks ?? [])), [pickerBoard, board.id, tasks, otherBoard.data]);

  /** Titel und Plan aller beteiligten Aufgaben – auch aus fremden Plänen (Angaben kommen vom Server). */
  const known = useMemo(() => {
    const map = new Map<number, { title: string; boardName: string; status?: TaskStatus }>();
    for (const x of tasks) map.set(x.id, { title: x.title, boardName: board.name, status: x.status });
    for (const p of task?.predecessors ?? []) map.set(p.taskId, { title: p.title, boardName: p.boardName, status: p.status });
    for (const x of pickerTasks) map.set(x.id, { title: x.title, boardName: otherBoard.data?.board.name ?? board.name, status: x.status });
    return map;
  }, [tasks, task, pickerTasks, board.name, otherBoard.data]);

  const excluded = useMemo(() => (task ? transitiveSuccessors(task.id, tasks) : new Set<number>()), [task, tasks]);
  const candidates = pickerTasks.filter((x) => x.id !== task?.id && !(pickerBoard === board.id && excluded.has(x.id)) && !value.some((v) => v.taskId === x.id));
  const violated = new Set((task?.predecessors ?? []).filter((p) => p.violated).map((p) => p.taskId));

  const update = (index: number, patch: Partial<TaskDependencyInput>) => onChange(value.map((v, i) => (i === index ? { ...v, ...patch } : v)));

  return (
    <div className="task-deps">
      {value.length > 0 && (
        <ul className="task-deps-list">
          {value.map((dep, i) => {
            const other = known.get(dep.taskId);
            const foreign = other && other.boardName && other.boardName !== board.name;
            return (
              <li key={dep.taskId}>
                <span className={cx('task-deps-title', other?.status === 'done' && 'muted strike')} title={foreign ? `${other.boardName}: ${other.title}` : other?.title}>
                  {violated.has(dep.taskId) && <AlertTriangle size={13} className="danger-text" aria-label={t('tasks.dependencyViolated')} />}
                  {other?.title ?? `#${dep.taskId}`}
                  {foreign && <span className="small muted"> · {other.boardName}</span>}
                </span>
                <Select className="input-sm" value={dep.type} onChange={(e) => update(i, { type: e.target.value as DependencyType })} disabled={readOnly} aria-label={t('tasks.dependencyType')}>
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`tasks.dependencyTypes.${type}`)}
                    </option>
                  ))}
                </Select>
                <span className="task-deps-lag">
                  <LagInput value={dep.lagDays} onChange={(lagDays) => update(i, { lagDays })} disabled={readOnly} label={t('tasks.lagDays')} />
                  <span className="small muted" aria-hidden="true">
                    {t('tasks.lagUnit')}
                  </span>
                </span>
                {!readOnly && <IconButton icon={X} label={t('common.remove')} onClick={() => onChange(value.filter((_, x) => x !== i))} />}
              </li>
            );
          })}
        </ul>
      )}
      {!readOnly && (
        <div className="row gap-xs">
          {(boards.data?.items.length ?? 0) > 1 && (
            <Select value={String(pickerBoard)} onChange={(e) => setPickerBoard(Number(e.target.value))} aria-label={t('tasks.predecessorBoard')}>
              {(boards.data?.items ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.id === board.id ? b.name : `${b.spaceName} · ${b.name}`}
                </option>
              ))}
            </Select>
          )}
          {/* Die Auswahl fügt sofort hinzu: Ein zusätzlicher Knopf wurde übersehen – die Abhängigkeit war
              dann scheinbar eingetragen, beim Speichern aber nicht dabei. */}
          <Select
            value=""
            disabled={!candidates.length}
            onChange={(e) => {
              const taskId = Number(e.target.value);
              if (taskId) onChange([...value, { taskId, type: 'FS', lagDays: 0 }]);
            }}
            aria-label={t('tasks.addPredecessor')}
          >
            <option value="">{otherBoard.isFetching ? t('common.loading') : t('tasks.choosePredecessor')}</option>
            {candidates.map((x) => (
              <option key={x.id} value={x.id}>
                {x.title}
              </option>
            ))}
          </Select>
        </div>
      )}
      <p className="small muted">{t('tasks.dependencyHelp')}</p>
      {value.length > 0 && !hasDates && (
        <p className="small warning-text row gap-xs">
          <AlertTriangle size={13} /> {t('tasks.dependencyNeedsDate')}
        </p>
      )}
      {task && task.successors.length > 0 && (
        <div className="task-deps-successors small">
          <span className="muted">{t('tasks.successors')}:</span>
          {task.successors.map((s) => (
            <span key={s.taskId} className="chip" title={s.boardName && s.boardName !== board.name ? `${s.boardName}: ${s.title}` : undefined}>
              <ArrowRight size={11} /> {s.title}
              {s.boardName && s.boardName !== board.name && <span className="muted"> · {s.boardName}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Kennzeichen auf der Karte, dass die Aufgabe überhaupt verknüpft ist – „Wartet“ allein zeigt nur die
 * wartende Seite, die Vorgängerin sah bisher aus wie eine Aufgabe ohne Abhängigkeiten.
 */
export function DependencyBadge({ task }: { task: Task }) {
  const count = task.predecessors.length + task.successors.length;
  if (!count) return null;
  const names = [...task.predecessors.map((p) => `← ${p.title}`), ...task.successors.map((s) => `→ ${s.title}`)];
  return (
    <Badge color="gray" title={names.join('\n')}>
      <GitBranch size={11} /> {count}
    </Badge>
  );
}

/** Kleines Kennzeichen auf Karten und in Listen: Aufgabe wartet noch auf eine Vorgängerin. */
export function BlockedBadge({ task }: { task: Task }) {
  const { t } = useI18n();
  if (!task.blocked || task.status === 'done') return null;
  const waiting = task.predecessors.filter((p) => p.status !== 'done').map((p) => p.title);
  return (
    <Badge color="yellow" title={t('tasks.blockedBy', { title: waiting.join(', ') })}>
      <Hourglass size={11} /> {t('tasks.blocked')}
    </Badge>
  );
}

interface Box {
  left: number;
  right: number;
  mid: number;
  /** Ober- und Unterkante der Zeile: Rückwärtspfeile laufen zwischen den Zeilen statt durch fremde Balken */
  top: number;
  bottom: number;
}

/**
 * Pfeile der Abhängigkeiten über der Zeitachse. Die Balken werden nach dem Rendern vermessen – so
 * passen die Pfeile auch beim Ziehen, Zoomen und bei unterschiedlich hohen Gruppen.
 */
export function TimelineDependencies({ tasks, version }: { tasks: Task[]; version: string }) {
  const { t } = useI18n();
  const svg = useRef<SVGSVGElement>(null);
  const [boxes, setBoxes] = useState<{ map: Map<number, Box>; width: number; height: number }>({ map: new Map(), width: 0, height: 0 });

  useLayoutEffect(() => {
    // Das eigene Elternelement statt einer Ref des Aufrufers: Die ist beim ersten Layout-Effekt eines Kindes noch
    // nicht gesetzt – die Pfeile erschienen sonst erst nach dem ersten Ziehen oder Zoomen.
    const root = svg.current?.parentElement;
    if (!root) return;
    const measure = () => {
      const base = root.getBoundingClientRect();
      const map = new Map<number, Box>();
      root.querySelectorAll<HTMLElement>('[data-bar-id]').forEach((el) => {
        const r = el.getBoundingClientRect();
        const row = (el.parentElement ?? el).getBoundingClientRect();
        map.set(Number(el.dataset.barId), {
          left: r.left - base.left,
          right: r.right - base.left,
          mid: r.top - base.top + r.height / 2,
          top: row.top - base.top,
          bottom: row.bottom - base.top,
        });
      });
      setBoxes({ map, width: root.scrollWidth, height: root.scrollHeight });
    };
    measure();
    // Später geladene Schriften oder eine andere Fensterbreite verändern die Zeilen – dann neu vermessen
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [version]);

  const links = tasks.flatMap((task) =>
    task.predecessors.map((p) => ({ from: boxes.map.get(p.taskId), to: boxes.map.get(task.id), type: p.type, violated: p.violated, key: `${p.taskId}-${task.id}` })),
  );

  return (
    <svg ref={svg} className="timeline-deps" width={boxes.width} height={boxes.height} aria-hidden="true">
      <defs>
        <marker id="dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--text-faint)" />
        </marker>
        <marker id="dep-arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L8,4 L0,8 z" fill="var(--danger)" />
        </marker>
      </defs>
      {links.map((link) => {
        if (!link.from || !link.to) return null;
        // FS/FF starten am Ende der Vorgängerin, SS/SF am Anfang; FS/SS enden am Anfang der Nachfolgerin
        const x1 = link.type === 'FS' || link.type === 'FF' ? link.from.right : link.from.left;
        const x2 = link.type === 'FS' || link.type === 'SS' ? link.to.left : link.to.right;
        const y1 = link.from.mid;
        const y2 = link.to.mid;
        const outX = link.type === 'FS' || link.type === 'FF' ? x1 + 8 : x1 - 8;
        const inX = link.type === 'FS' || link.type === 'SS' ? x2 - 8 : x2 + 8;
        // Umweg auf der Grenze zur nächsten Zeile – die Mitte zwischen zwei Zeilen läge genau auf dem Balken dazwischen
        const laneY = y2 >= y1 ? link.from.bottom : link.from.top;
        const path =
          (link.type === 'FS' && inX >= outX) || (link.type === 'SS' && inX >= outX - 16)
            ? `M${x1},${y1} H${Math.min(outX, inX)} V${y2} H${x2}`
            : `M${x1},${y1} H${outX} V${laneY} H${inX} V${y2} H${x2}`;
        return (
          <path key={link.key} d={path} className={cx('timeline-dep', link.violated && 'violated')} markerEnd={link.violated ? 'url(#dep-arrow-bad)' : 'url(#dep-arrow)'}>
            {link.violated && <title>{t('tasks.dependencyViolated')}</title>}
          </path>
        );
      })}
    </svg>
  );
}

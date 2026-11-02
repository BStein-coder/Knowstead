import { useRef, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import { useI18n } from '../i18n';

/** Grenzen und Vorgabe der Breite der Seitenleiste (Pixel) – die Vorgabe steht auch in tokens.css (`--sidebar-w`). */
export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 284;

/** Höchstens 40 % des Fensters, damit der Inhalt Platz behält. */
export function sidebarMax(): number {
  return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.floor(window.innerWidth * 0.4)));
}

export function clampSidebarWidth(width: number): number {
  return Math.round(Math.min(Math.max(width, SIDEBAR_MIN), sidebarMax()));
}

interface Props {
  /** Rahmen der Anwendung: Dort steht `--sidebar-user-w`, aus der das Stylesheet die Breite ableitet. */
  appRef: RefObject<HTMLDivElement | null>;
  /** Eingestellte Breite; `null` = Vorgabe */
  width: number | null;
  /** Neue Breite festhalten (`null` = zurück zur Vorgabe) */
  onCommit: (width: number | null) => void;
}

/**
 * Griff am rechten Rand der Seitenleiste: Ziehen ändert die Breite, die Pfeiltasten tun es auch (Umschalt = große
 * Schritte, Pos1/Ende = schmalste/breiteste), ein Doppelklick stellt die Vorgabe wieder her. Beim Ziehen wird nur die
 * CSS-Variable gesetzt – die Anwendung rendert dabei nicht neu; festgehalten wird die Breite erst beim Loslassen.
 */
export function SidebarResizer({ appRef, width, onCommit }: Props) {
  const { t } = useI18n();
  const frame = useRef(0);
  const current = width ?? SIDEBAR_DEFAULT;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const app = appRef.current;
    if (event.button !== 0 || !app) return;
    event.preventDefault();
    const grip = event.currentTarget;
    grip.setPointerCapture(event.pointerId);
    // Die Leiste beginnt nach dem Abstand zum Fensterrand
    const gap = parseFloat(getComputedStyle(app).getPropertyValue('--shell-gap')) || 0;
    let latest = current;
    document.body.classList.add('sidebar-resizing');

    const move = (e: globalThis.PointerEvent) => {
      latest = clampSidebarWidth(e.clientX - gap);
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => app.style.setProperty('--sidebar-user-w', `${latest}px`));
    };
    const finish = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', finish);
      grip.removeEventListener('pointercancel', finish);
      cancelAnimationFrame(frame.current);
      document.body.classList.remove('sidebar-resizing');
      app.style.setProperty('--sidebar-user-w', `${latest}px`);
      onCommit(latest);
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = current + step;
    else if (event.key === 'ArrowLeft') next = current - step;
    else if (event.key === 'Home') next = SIDEBAR_MIN;
    else if (event.key === 'End') next = sidebarMax();
    if (next === null) return;
    event.preventDefault();
    onCommit(clampSidebarWidth(next));
  };

  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t('app.resizeSidebar')}
      aria-controls="sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={sidebarMax()}
      aria-valuenow={current}
      tabIndex={0}
      title={t('app.resizeSidebarHint')}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={() => onCommit(null)}
    />
  );
}

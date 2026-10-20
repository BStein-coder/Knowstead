import { useEffect, useRef, useState } from 'react';
import { cx } from '../../components/ui';
import { motionReduced } from '../../lib/motion';

/**
 * Runder Haken zum Erledigen einer Aufgabe. Beim Umschalten füllt sich der Kreis, der Haken zeichnet sich nach,
 * ein Ring schwingt aus – alles nur `transform` und `opacity` (task-check in planner.css). Wer die Aufgabe schon
 * erledigt vorfindet, sieht den Haken ohne Fahrt.
 */
export function TaskCheck({ done, label, onToggle, disabled, size = 22, className }: { done: boolean; label: string; onToggle: () => void; disabled?: boolean; size?: number; className?: string }) {
  // „pop“ liegt nur kurz an: Die Klasse startet die Animation bei jedem Umschalten neu
  const [pop, setPop] = useState(false);
  const previous = useRef(done);
  useEffect(() => {
    if (previous.current === done) return;
    previous.current = done;
    if (motionReduced()) return;
    setPop(true);
    const id = window.setTimeout(() => setPop(false), 620);
    return () => window.clearTimeout(id);
  }, [done]);

  return (
    <button
      type="button"
      className={cx('task-check', done && 'is-done', pop && 'is-pop', className)}
      style={{ width: size, height: size }}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        // Die Karte oder Zeile darunter öffnet die Aufgabe – der Haken soll das nicht auslösen
        e.stopPropagation();
        onToggle();
      }}
      // Enter auf dem Haken erledigt, öffnet aber nicht zusätzlich die Karte
      onKeyDown={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6.5 12.6l3.7 3.7 7.3-7.6" />
      </svg>
    </button>
  );
}

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { motionReduced } from './motion';

/**
 * Platz im Layout, ohne `transform` (offsetLeft/offsetTop kennen keine Verschiebung): Einblend- und Gleitbewegungen
 * laufender Animationen verfälschen die Messung damit nicht, und das Scrollen spielt keine Rolle.
 */
function layoutOffset(el: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let node: HTMLElement | null = el; node; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}

/**
 * Gleiten statt Springen (FLIP): Ändert sich die Reihenfolge oder die Spalte von Karten und Zeilen, bleiben sie nicht
 * abrupt am neuen Platz stehen, sondern gleiten vom alten dorthin. Der Container nennt seine Elemente mit
 * `data-flip="<Schlüssel>"`; nach jedem Rendern (`deps`) vergleicht der Hook die Plätze mit denen des letzten Mals.
 *
 * Gemessen wird der Platz im Layout relativ zum Container (siehe layoutOffset), nicht im Fenster. Animiert wird nur
 * `transform`; bei reduzierter Bewegung springen die Elemente wie zuvor. Neu hinzugekommene Elemente bekommen vom
 * Stylesheet ihren eigenen Auftritt.
 */
export function useFlip(ref: RefObject<HTMLElement | null>, deps: readonly unknown[]): void {
  const last = useRef<Map<string, { x: number; y: number }>>(new Map());
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) {
      last.current = new Map();
      return;
    }
    const items = [...root.querySelectorAll<HTMLElement>('[data-flip]')];
    // Eine noch laufende Fahrt beenden, damit nicht zwei übereinander laufen
    for (const el of items) for (const a of el.getAnimations()) if (a.id === 'flip') a.cancel();
    const reduced = motionReduced();
    const now = new Map<string, { x: number; y: number }>();
    const origin = layoutOffset(root);
    for (const el of items) {
      const key = el.dataset.flip;
      if (!key) continue;
      const at = layoutOffset(el);
      const pos = { x: at.x - origin.x, y: at.y - origin.y };
      now.set(key, pos);
      const before = last.current.get(key);
      if (!before || reduced) continue;
      const dx = before.x - pos.x;
      const dy = before.y - pos.y;
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2) continue;
      const animation = el.animate([{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: 'translate3d(0, 0, 0)' }], {
        duration: 360,
        easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      });
      animation.id = 'flip';
    }
    last.current = now;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- die Abhängigkeiten gibt die aufrufende Stelle vor
  }, deps);
}

/**
 * Kurzes Aufleuchten, wenn sich ein Wert ändert (Zähler, Kennzahlen): liefert die Klasse `is-flash`, solange der Ring
 * läuft. Beim ersten Rendern und bei reduzierter Bewegung bleibt es still.
 */
export function useFlash(value: unknown): string {
  const [on, setOn] = useState(false);
  const previous = useRef(value);
  useEffect(() => {
    if (Object.is(previous.current, value)) return;
    previous.current = value;
    if (motionReduced()) return;
    setOn(true);
    const id = window.setTimeout(() => setOn(false), 950);
    return () => window.clearTimeout(id);
  }, [value]);
  return on ? 'is-flash' : '';
}

import type { CSSProperties, ReactNode } from 'react';
import { useReveal } from '../lib/motion';

/**
 * Blendet seinen Inhalt ein, sobald er in den sichtbaren Bereich kommt. `index` staffelt mehrere
 * Elemente, die gleichzeitig erscheinen. Bei reduzierter Bewegung ist der Inhalt sofort da.
 */
export function Reveal({ children, index = 0, className }: { children: ReactNode; index?: number; className?: string }) {
  const ref = useReveal<HTMLDivElement>();
  return (
    <div ref={ref} data-reveal="" className={className} style={{ '--i': index } as CSSProperties}>
      {children}
    </div>
  );
}

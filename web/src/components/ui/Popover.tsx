import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end' | 'right-start' | 'left-start';

interface PopoverProps {
  anchor: HTMLElement | DOMRect | null;
  open: boolean;
  onClose: () => void;
  placement?: Placement;
  offset?: number;
  matchWidth?: boolean;
  className?: string;
  children: ReactNode;
  /** Klicks auf diese Elemente schließen das Popover nicht. */
  ignore?: (HTMLElement | null)[];
  role?: string;
}

/** Schwebendes Element (Portal, feste Position, klappt bei Platzmangel um). */
export function Popover({ anchor, open, onClose, placement = 'bottom-start', offset = 6, matchWidth, className, children, ignore, role }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', top: -9999, left: -9999 });

  const compute = useCallback(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top: number;
    let left: number;
    if (placement.startsWith('right')) {
      left = r.right + offset;
      top = r.top;
      if (left + w > vw - 8) left = r.left - w - offset;
    } else if (placement.startsWith('left')) {
      left = r.left - w - offset;
      top = r.top;
      if (left < 8) left = r.right + offset;
    } else {
      left = placement.endsWith('end') ? r.right - w : r.left;
      if (placement.startsWith('top')) {
        top = r.top - h - offset;
        if (top < 8) top = r.bottom + offset;
      } else {
        top = r.bottom + offset;
        if (top + h > vh - 8 && r.top - h - offset > 8) top = r.top - h - offset;
      }
    }
    left = Math.max(8, Math.min(left, vw - w - 8));
    top = Math.max(8, Math.min(top, vh - Math.min(h, vh - 16) - 8));
    setStyle({
      position: 'fixed',
      top,
      left,
      minWidth: matchWidth ? r.width : undefined,
      maxHeight: vh - 16,
    });
  }, [anchor, placement, offset, matchWidth]);

  useLayoutEffect(() => {
    if (!open) return;
    compute();
    const raf = requestAnimationFrame(compute);
    return () => cancelAnimationFrame(raf);
  }, [open, compute, children]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchor instanceof HTMLElement && anchor.contains(target)) return;
      if (ignore?.some((el) => el?.contains(target))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const onScroll = () => compute();
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, anchor, onClose, compute, ignore]);

  if (!open) return null;
  return createPortal(
    <div ref={ref} className={`popover ${className ?? ''}`} style={style} role={role}>
      {children}
    </div>,
    document.body,
  );
}

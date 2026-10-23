import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Bewegung und Effekte der Oberfläche: die Einstellung „voll / reduziert“, zeigergeführte Neigung und
 * Lichtkegel für Kacheln, Einblenden beim Scrollen und hochzählende Zahlen.
 *
 * Alles hier ist Zusatz: Ohne JavaScript, mit „Bewegung reduzieren“ im Betriebssystem oder mit der
 * Einstellung „reduziert“ in Knowstead bleibt die Oberfläche vollständig – nur eben ruhig. Animiert werden
 * ausschließlich `transform` und `opacity`, damit der Browser die Arbeit der Grafikkarte überlassen kann.
 */
export type MotionMode = 'full' | 'reduced';

const KEY = 'knowstead.motion';
const EVENT = 'knowstead:motion';
let media: MediaQueryList | null = null;

function osReduced(): boolean {
  media ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  return media.matches;
}

/** Auf diesem Gerät gespeicherte Wahl – `null`, solange niemand etwas gewählt hat. */
export function storedMotion(): MotionMode | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'full' || v === 'reduced' ? v : null;
  } catch {
    return null;
  }
}

/** Einstellung in Knowstead (ohne die des Betriebssystems). */
export function currentMotion(): MotionMode {
  return document.documentElement.dataset.motion === 'reduced' ? 'reduced' : 'full';
}

/** Bewegung reduziert – durch das Betriebssystem oder durch die Einstellung in Knowstead. */
export function motionReduced(): boolean {
  return currentMotion() === 'reduced' || osReduced();
}

/**
 * Setzt `data-motion` auf <html>; die Stylesheets schalten daran alle Animationen ab.
 * `remember` speichert die Wahl auf diesem Gerät (sonst gilt sie nur als Vorgabe).
 */
export function applyMotion(mode: MotionMode, remember = false): void {
  if (remember) {
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* Speicher gesperrt: Wahl gilt bis zum Neuladen */
    }
  }
  const root = document.documentElement;
  root.dataset.motion = mode;
  // „motion-ok“ erlaubt Effekte, die Inhalte zunächst verbergen (Einblenden beim Scrollen)
  root.classList.toggle('motion-ok', !motionReduced());
  window.dispatchEvent(new CustomEvent(EVENT));
}

function subscribe(onChange: () => void): () => void {
  media ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  window.addEventListener(EVENT, onChange);
  media.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    media?.removeEventListener('change', onChange);
  };
}

/** Reagiert auf Änderungen der Einstellung (Knowstead und Betriebssystem). */
export function useMotionReduced(): boolean {
  return useSyncExternalStore(subscribe, motionReduced, () => false);
}

/** Einstellung in Knowstead als Zustand – für Schalter in Menü und Profil. */
export function useMotionMode(): MotionMode {
  return useSyncExternalStore(subscribe, currentMotion, () => 'full');
}

/* ------------------------------ Neigung und Lichtkegel ------------------------------ */

let tiltReady = false;

/**
 * Ein einziger Zeiger-Listener für die ganze Anwendung: Elemente mit `data-tilt` neigen sich zum Zeiger
 * (Wert = größter Winkel in Grad), Elemente mit `data-spot` bekommen nur den Lichtkegel. Die Position
 * landet als CSS-Variable am Element – das Aussehen bestimmt allein das Stylesheet.
 */
function initPointerEffects(): void {
  if (tiltReady) return;
  tiltReady = true;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
  let current: HTMLElement | null = null;
  let last: PointerEvent | null = null;
  let frame = 0;

  const release = (el: HTMLElement) => {
    el.style.removeProperty('--rx');
    el.style.removeProperty('--ry');
    el.removeAttribute('data-pointer');
  };

  const apply = () => {
    frame = 0;
    const e = last;
    if (!e) return;
    const target = e.target instanceof Element ? (e.target.closest('[data-tilt], [data-spot]') as HTMLElement | null) : null;
    if (current && current !== target) release(current);
    current = target;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    target.style.setProperty('--mx', `${(x * 100).toFixed(1)}%`);
    target.style.setProperty('--my', `${(y * 100).toFixed(1)}%`);
    target.setAttribute('data-pointer', '');
    const max = Number(target.dataset.tilt);
    if (Number.isFinite(max) && max > 0) {
      target.style.setProperty('--ry', `${((x - 0.5) * 2 * max).toFixed(2)}deg`);
      target.style.setProperty('--rx', `${((0.5 - y) * 2 * max).toFixed(2)}deg`);
    }
  };

  document.addEventListener(
    'pointermove',
    (e) => {
      // „Frost“ verzichtet auf Neigung und Lichtkegel – jede Zeigerbewegung würde sonst Layout und Zeichnen anstoßen
      if (e.pointerType === 'touch' || !fine.matches || motionReduced() || document.documentElement.dataset.appearance === 'frost') {
        if (current) {
          release(current);
          current = null;
        }
        return;
      }
      last = e;
      if (!frame) frame = requestAnimationFrame(apply);
    },
    { passive: true },
  );
  const leave = () => {
    last = null;
    if (current) {
      release(current);
      current = null;
    }
  };
  document.documentElement.addEventListener('pointerleave', leave);
  window.addEventListener('blur', leave);
}

/* ------------------------------ Einblenden beim Scrollen ------------------------------ */

const revealObservers = new Map<Element | null, IntersectionObserver>();

/**
 * Ein Beobachter je Scroll-Container. Der Hauptbereich der Anwendung scrollt selbst; gegen das Fenster
 * gemessen würde er alles abschneiden, was über ihm liegt – und der nach oben erweiterte Rand bliebe wirkungslos.
 */
function observerFor(root: Element | null): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  let io = revealObservers.get(root);
  if (io) return io;
  io = new IntersectionObserver(
    (entries, self) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        // Als Attribut, nicht als Klasse: React schreibt `className` bei jedem Wechsel neu, fremde Attribute nicht
        (entry.target as HTMLElement).dataset.revealed = '';
        self.unobserve(entry.target);
      }
    },
    // Der Bereich reicht nach oben weit hinaus: Was man überspringt (Sprung ans Seitenende, wiederhergestellte
    // Scrollposition), gilt als gesehen und bleibt nicht unsichtbar zurück.
    { root, rootMargin: '100000px 0px -4% 0px', threshold: 0.04 },
  );
  revealObservers.set(root, io);
  return io;
}

/**
 * Blendet ein Element ein, sobald es in den sichtbaren Bereich kommt (Stylesheet: `[data-reveal]`).
 * Verborgen wird nur, solange <html> die Klasse `motion-ok` trägt – sonst ist der Inhalt sofort da.
 */
export function useReveal<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = observerFor(el.closest('.main'));
    if (!io) {
      el.dataset.revealed = '';
      return;
    }
    io.observe(el);
    return () => io.unobserve(el);
  }, []);
  return ref;
}

/* ------------------------------ Hochzählende Zahlen ------------------------------ */

/** Zählt weich auf den Zielwert – bei reduzierter Bewegung steht er sofort da. */
export function useCountUp(target: number | undefined, duration = 800): number | undefined {
  const [value, setValue] = useState(target);
  const shown = useRef(0);
  useEffect(() => {
    if (target === undefined) {
      setValue(undefined);
      return;
    }
    const from = shown.current;
    if (motionReduced() || from === target) {
      shown.current = target;
      setValue(target);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      const next = Math.round(from + (target - from) * eased);
      shown.current = next;
      setValue(next);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);
  return value;
}

/* ------------------------------ Start ------------------------------ */

/** Einmal beim Start: gespeicherte Wahl anwenden, auf das Betriebssystem hören, Zeigereffekte einrichten. */
export function initMotion(): void {
  applyMotion(storedMotion() ?? 'full');
  media ??= window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', () => applyMotion(currentMotion()));
  initPointerEffects();
}

/**
 * Layout-Messung im Browser: findet Bedienelemente und Überschriften, die sich überlappen, von fremden
 * Elementen verdeckt werden, über den Fensterrand ragen oder deren Text abgeschnitten ist – außerdem
 * seitliches Scrollen der ganzen Seite.
 *
 * Die Funktion läuft per `page.evaluate` im Browser und darf deshalb nichts von außen verwenden.
 * Absichtliche Ebenen (Dialog über Seite, Menü über Inhalt) und Inhalte, die ein scrollender Bereich
 * gerade abschneidet, zählen nicht als Fehler.
 */
export interface LayoutFindings {
  overlaps: { a: string; b: string; area: number; onTop: string }[];
  covered: { element: string; by: string }[];
  offscreen: { element: string; right: number; left: number }[];
  clipped: { element: string; width: number; content: number }[];
  /** Pixel, um die sich die ganze Seite seitlich scrollen lässt (0 = gar nicht) */
  horizontalScroll: number;
}

export function measureLayout(): LayoutFindings {
  const OVERLAY = '[role="dialog"], [role="menu"], [role="listbox"], .modal, .modal-backdrop, .popover, .dropdown-menu, .toast, .tooltip, .command-palette, .emoji-picker';
  const SELECTOR =
    'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="tab"], [role="menuitem"], h1, h2, h3, h4, label, kbd, svg.lucide-search, .badge, .task-card, .chip, .tag, img, .topbar, .bulk-bar, .board-toolbar, .page-header-actions, .page-header-title, .page-header-subtitle, .sidebar, .card-header, .breadcrumbs, .tabs, .list-item, th';
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  type Box = { left: number; top: number; right: number; bottom: number; width: number; height: number };

  const describe = (e: Element): string => {
    const cls = [...e.classList].slice(0, 2).join('.');
    const text = (e.getAttribute('aria-label') || e.textContent || e.getAttribute('alt') || '').trim().replace(/\s+/g, ' ').slice(0, 34);
    const r = e.getBoundingClientRect();
    return `${e.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ' „' + text + '“' : ''} @${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}`;
  };
  const clips = (cs: CSSStyleDeclaration) => cs.overflowX !== 'visible' || cs.overflowY !== 'visible';
  // Liegt das Element außerhalb der sichtbaren Fläche eines scrollenden Vorfahren? (Inhalt, der erst nach dem
  // Scrollen erscheint, liegt hinter festen Fußzeilen – das ist keine Überlappung.)
  const clippedAway = (e: Element, r: DOMRect): boolean => {
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      if (!clips(getComputedStyle(a))) continue;
      const b = a.getBoundingClientRect();
      if (r.right <= b.left + 1 || r.left >= b.right - 1 || r.bottom <= b.top + 1 || r.top >= b.bottom - 1) return true;
    }
    return false;
  };
  // Lässt sich das Element durch seitliches Scrollen eines Vorfahren ganz zeigen (breite Tabelle, Zeitstrahl)?
  const horizontallyScrollable = (e: Element): boolean => {
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(a).overflowX) && a.scrollWidth > a.clientWidth + 1) return true;
    }
    return false;
  };
  const visible = (e: Element): boolean => {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    if (e.closest('[aria-hidden="true"]')) return false;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    // Ganz außerhalb des Fensters (eingeklappte Seitenleiste auf dem Handy) ist Absicht
    if (r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) return false;
    return !clippedAway(e, r);
  };
  const overlayOf = (e: Element) => e.closest(OVERLAY);
  // Sichtbarer Ausschnitt: Was ein scrollender Vorfahre abschneidet, zählt nicht mit
  const clipBox = (e: Element): Box => {
    const r = e.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) {
      if (!clips(getComputedStyle(a))) continue;
      const b = a.getBoundingClientRect();
      left = Math.max(left, b.left);
      top = Math.max(top, b.top);
      right = Math.min(right, b.right);
      bottom = Math.min(bottom, b.bottom);
    }
    return { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  };

  const all = [...document.querySelectorAll(SELECTOR)].filter(visible).filter((e) => {
    const c = clipBox(e);
    const r = e.getBoundingClientRect();
    // Nur zu einem kleinen Teil zu sehen (Rand eines Scrollbereichs) – das ist Scrollen, kein Fehler
    return c.width * c.height >= 0.5 * r.width * r.height;
  });
  const boxes = all.map(clipBox);

  const overlaps: LayoutFindings['overlaps'] = [];
  const seen = new Set<string>();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      if (a.contains(b) || b.contains(a)) continue;
      const r1 = boxes[i];
      const r2 = boxes[j];
      const ix = Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left);
      const iy = Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top);
      if (ix <= 1 || iy <= 1) continue;
      const area = ix * iy;
      if (area < 16 || area < Math.min(r1.width * r1.height, r2.width * r2.height) * 0.08) continue;
      // Ebenen mit Absicht nicht melden – außer beide liegen in derselben Ebene
      const oa = overlayOf(a);
      const ob = overlayOf(b);
      if ((oa || ob) && oa !== ob) continue;
      const top = document.elementFromPoint(Math.max(r1.left, r2.left) + ix / 2, Math.max(r1.top, r2.top) + iy / 2);
      const key = `${describe(a)}|${describe(b)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const onTop = top && (a === top || a.contains(top)) ? 'a' : top && (b === top || b.contains(top)) ? 'b' : top ? describe(top) : '?';
      overlaps.push({ a: describe(a), b: describe(b), area: Math.round(area), onTop });
    }
  }

  // Verdeckt: Die Mitte eines Bedienelements gehört einem fremden Element – ein Klick dorthin ginge ins Leere
  const covered: LayoutFindings['covered'] = [];
  for (const e of all) {
    if (!e.matches('button, a[href], input, select, textarea, [role="button"], [role="tab"]')) continue;
    if (getComputedStyle(e).pointerEvents === 'none') continue;
    const r = e.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    if (!top || top === e || e.contains(top) || top.contains(e)) continue;
    if (overlayOf(top) && !overlayOf(e)) continue; // offener Dialog oder offenes Menü
    covered.push({ element: describe(e), by: describe(top) });
  }

  const offscreen: LayoutFindings['offscreen'] = [];
  for (let i = 0; i < all.length; i++) {
    const r = boxes[i];
    if (!((r.right > vw + 1 && r.left < vw) || (r.left < -1 && r.right > 0))) continue;
    if (all[i].matches('.sidebar') || horizontallyScrollable(all[i])) continue;
    offscreen.push({ element: describe(all[i]), right: Math.round(r.right - vw), left: Math.round(r.left) });
  }

  // Abgeschnittener Text in Bedienelementen und Überschriften (Auslassungspunkte sind Absicht)
  const clipped: LayoutFindings['clipped'] = [];
  for (const e of all) {
    if (!e.matches('button, a[href], label, h1, h2, h3, .badge, th, .chip, .tag')) continue;
    const cs = getComputedStyle(e);
    if (cs.overflowX === 'visible' || cs.textOverflow === 'ellipsis') continue;
    if (e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 3) clipped.push({ element: describe(e), width: e.clientWidth, content: e.scrollWidth });
  }

  const root = document.documentElement;
  return { overlaps, covered, offscreen, clipped, horizontalScroll: root.scrollWidth > root.clientWidth + 1 ? root.scrollWidth - root.clientWidth : 0 };
}

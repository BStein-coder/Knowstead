const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' };

export function slugify(input: string): string {
  return (
    input
      .replace(/[äöüÄÖÜß]/g, (c) => UMLAUTS[c] ?? c)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'seite'
  );
}

export function pageUrl(spaceKey: string, id: number, title: string): string {
  return `/s/${encodeURIComponent(spaceKey)}/p/${id}/${slugify(title)}`;
}

export function readingTime(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T & { cancel: () => void; flush: () => void } {
  let timer: number | undefined;
  let lastArgs: Parameters<T> | null = null;
  const wrapped = ((...args: Parameters<T>) => {
    lastArgs = args;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      lastArgs = null;
      fn(...args);
    }, ms);
  }) as T & { cancel: () => void; flush: () => void };
  wrapped.cancel = () => {
    window.clearTimeout(timer);
    lastArgs = null;
  };
  wrapped.flush = () => {
    if (lastArgs) {
      window.clearTimeout(timer);
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    }
  };
  return wrapped;
}

export function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

/** Beschriftung der Steuerungstaste: ⌘ auf dem Mac, sonst „Strg“ bzw. „Ctrl“ je nach Sprache */
export function modKey(locale: 'de' | 'en' = 'de'): string {
  if (isMac()) return '⌘';
  return locale === 'en' ? 'Ctrl' : 'Strg';
}

export function getByPath(obj: unknown, path: string): unknown {
  if (!path.trim()) return obj;
  let cur: unknown = obj;
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    const m = part.match(/^(\w+)\[(\d+)\]$/);
    if (m) {
      cur = (cur as Record<string, unknown>)[m[1]];
      cur = Array.isArray(cur) ? cur[Number(m[2])] : undefined;
    } else if (/^\d+$/.test(part) && Array.isArray(cur)) cur = cur[Number(part)];
    else cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function renderTemplate(template: string, data: unknown): string {
  return template.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_m, path: string) => {
    const v = getByPath(data, path);
    return v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  });
}

export const EMOJI_CHOICES = [
  '📘', '📗', '📕', '📙', '📓', '📔', '📒', '📚', '📖', '📝', '🗒️', '📄', '📃', '📑', '🗂️', '📁', '📂', '🗃️',
  '🚀', '🎯', '💡', '🔧', '🛠️', '⚙️', '🔌', '🧩', '🧪', '🔬', '📊', '📈', '📉', '🗓️', '⏱️', '🔔',
  '✅', '☑️', '⚠️', '❗', '❓', 'ℹ️', '🔒', '🔑', '🛡️', '🌐', '🏠', '🏢', '👥', '👤', '🤝', '💬',
  '🎨', '🖥️', '💻', '📱', '🧑‍💻', '🐞', '🔥', '⭐', '🌟', '🏆', '🎉', '📦', '🧭', '🗺️', '🔄', '♻️',
];

export const COLOR_CHOICES = ['#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#0891b2', '#475569'];

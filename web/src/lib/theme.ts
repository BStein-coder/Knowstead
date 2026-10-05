export type ThemeMode = 'light' | 'dark' | 'system';

const KEY = 'knowstead.theme';
let media: MediaQueryList | null = null;

function resolve(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return mode;
}

export function currentTheme(): 'light' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function storedTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark' || v === 'system') return v;
  } catch {
    /* ignorieren */
  }
  return 'system';
}

/** Setzt data-theme auf <html>; „system“ folgt der Betriebssystemeinstellung. */
export function applyTheme(mode?: ThemeMode | null): void {
  const m = mode ?? storedTheme();
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* ignorieren */
  }
  document.documentElement.dataset.theme = resolve(m);
  media?.removeEventListener('change', onMediaChange);
  if (m === 'system') {
    media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', onMediaChange);
  }
  window.dispatchEvent(new CustomEvent('knowstead:theme'));
}

function onMediaChange() {
  document.documentElement.dataset.theme = resolve('system');
  window.dispatchEvent(new CustomEvent('knowstead:theme'));
}

/** Akzentfarbe aus den Systemeinstellungen übernehmen. */
export function applyAccent(color: string): void {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return;
  document.documentElement.style.setProperty('--accent', color);
}

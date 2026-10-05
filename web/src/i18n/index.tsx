import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import de, { type Dictionary } from './de';
import en from './en';
import { setApiLocale } from '../api/client';

export type Locale = 'de' | 'en';
export type TFn = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

const dictionaries: Record<Locale, Dictionary> = { de, en };
const STORAGE_KEY = 'knowstead.locale';

function lookup(dict: unknown, key: string): string | undefined {
  let cur: unknown = dict;
  for (const part of key.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function createT(locale: Locale): TFn {
  return (key, vars) => {
    let str = lookup(dictionaries[locale], key) ?? lookup(de, key);
    if (str === undefined) {
      if (import.meta.env.DEV) console.warn(`[i18n] Fehlender Schlüssel: ${key}`);
      return key;
    }
    if (vars) {
      str = str.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
    }
    return str;
  };
}

export interface Formatters {
  date: (iso: string | null | undefined) => string;
  dateTime: (iso: string | null | undefined) => string;
  time: (iso: string | null | undefined) => string;
  relative: (iso: string | null | undefined) => string;
  bytes: (n: number) => string;
  number: (n: number) => string;
}

function makeFormatters(locale: Locale, t: TFn): Formatters {
  const tag = locale === 'de' ? 'de-DE' : 'en-GB';
  const dateFmt = new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const dateTimeFmt = new Intl.DateTimeFormat(tag, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const timeFmt = new Intl.DateTimeFormat(tag, { hour: '2-digit', minute: '2-digit' });
  const rtf = new Intl.RelativeTimeFormat(tag, { numeric: 'auto' });
  const numFmt = new Intl.NumberFormat(tag);
  const parse = (iso: string | null | undefined) => (iso ? new Date(iso) : null);
  return {
    date: (iso) => {
      const d = parse(iso);
      return d ? dateFmt.format(d) : '–';
    },
    dateTime: (iso) => {
      const d = parse(iso);
      return d ? dateTimeFmt.format(d) : '–';
    },
    time: (iso) => {
      const d = parse(iso);
      return d ? timeFmt.format(d) : '–';
    },
    relative: (iso) => {
      const d = parse(iso);
      if (!d) return t('common.never');
      const diff = (d.getTime() - Date.now()) / 1000;
      const abs = Math.abs(diff);
      if (abs < 45) return t('common.justNow');
      if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
      if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
      if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
      if (abs < 86400 * 30) return rtf.format(Math.round(diff / (86400 * 7)), 'week');
      return dateFmt.format(d);
    },
    bytes: (n) => {
      if (n < 1024) return `${n} B`;
      const units = ['KB', 'MB', 'GB', 'TB'];
      let v = n / 1024;
      let i = 0;
      while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i++;
      }
      return `${numFmt.format(Math.round(v * 10) / 10)} ${units[i]}`;
    },
    number: (n) => numFmt.format(n),
  };
}

interface I18nValue {
  locale: Locale;
  t: TFn;
  fmt: Formatters;
  setLocale: (locale: Locale, persist?: boolean) => void;
}

const I18nContext = createContext<I18nValue | null>(null);

export function storedLocale(): Locale | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    /* ignorieren */
  }
  return null;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [locale, setLocaleState] = useState<Locale>(() => {
    // Ohne gespeicherte Wahl entscheidet der Server (Profil, Standardsprache der Installation) –
    // sonst kämen die ersten Antworten einer englischen Installation auf Deutsch.
    const stored = storedLocale();
    if (stored) {
      setApiLocale(stored);
      document.documentElement.lang = stored;
    }
    return stored ?? 'de';
  });
  const current = useRef(locale);
  /** `persist = false` übernimmt z. B. die Standardsprache der Installation, ohne sie als Wahl zu speichern. */
  const setLocale = useCallback((next: Locale, persist = true) => {
    setApiLocale(next);
    setLocaleState(next);
    if (current.current !== next) {
      current.current = next;
      // Vom Server übersetzte Daten (Aktivität, Kataloge, Meldungen) in der neuen Sprache neu laden
      void queryClient.invalidateQueries();
    }
    if (persist) {
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignorieren */
      }
    }
    document.documentElement.lang = next;
  }, [queryClient]);
  const value = useMemo(() => {
    const t = createT(locale);
    return { locale, t, fmt: makeFormatters(locale, t), setLocale };
  }, [locale, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('I18nProvider fehlt');
  return ctx;
}

export function useT(): TFn {
  return useI18n().t;
}

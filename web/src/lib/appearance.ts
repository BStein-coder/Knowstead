import { useSyncExternalStore } from 'react';

/**
 * Aussehen der Oberfläche – unabhängig vom Farbschema (hell/dunkel, theme.ts) und von der Akzentfarbe.
 *
 *  - `classic`: das bisherige, sachliche Aussehen (Vorgabe)
 *  - `glass`:   große Rundungen, tiefes Glas mit Lichtkanten, Pillen und leuchtende Schaltflächen
 *  - `paper`:   warmes Papier, flache Karten mit feinen Rändern, Tinte statt Akzentfarbe für Hauptaktionen
 *
 * Gesetzt wird `data-appearance` auf <html>; alles Weitere steht in styles/appearance.css. Die Wahl liegt im
 * Konto (`preferences.appearance`, gilt auf allen Geräten) und zusätzlich auf diesem Gerät – so stimmt die erste
 * Darstellung schon vor der Anmeldung.
 */
export type Appearance = 'classic' | 'glass' | 'paper';

export const APPEARANCES: readonly Appearance[] = ['classic', 'glass', 'paper'];

const KEY = 'knowstead.appearance';
const EVENT = 'knowstead:appearance';

export function isAppearance(value: unknown): value is Appearance {
  return typeof value === 'string' && (APPEARANCES as readonly string[]).includes(value);
}

/** Auf diesem Gerät gespeicherte Wahl – `null`, solange niemand etwas gewählt hat. */
export function storedAppearance(): Appearance | null {
  try {
    const v = localStorage.getItem(KEY);
    return isAppearance(v) ? v : null;
  } catch {
    return null;
  }
}

export function currentAppearance(): Appearance {
  const v = document.documentElement.dataset.appearance;
  return isAppearance(v) ? v : 'classic';
}

/** Setzt `data-appearance` auf <html>. `remember` merkt die Wahl auf diesem Gerät. */
export function applyAppearance(value: Appearance, remember = true): void {
  if (remember) {
    try {
      localStorage.setItem(KEY, value);
    } catch {
      /* Speicher gesperrt: Wahl gilt bis zum Neuladen */
    }
  }
  document.documentElement.dataset.appearance = value;
  window.dispatchEvent(new CustomEvent(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** Aktuelles Aussehen als Zustand – für Menü und Profil. */
export function useAppearance(): Appearance {
  return useSyncExternalStore(subscribe, currentAppearance, () => 'classic');
}

/** Einmal beim Start, vor dem ersten Rendern. */
export function initAppearance(): void {
  applyAppearance(storedAppearance() ?? 'classic', false);
}

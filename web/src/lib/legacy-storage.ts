/**
 * Einstellungen im Browser aus der Zeit, als Knowstead noch „Doku“ hieß: Farbschema, Sprache, Seitenleiste,
 * aufgeklappte Zweige im Seitenbaum, Ansicht des Aufgabenplans. Sie lagen unter Schlüsseln mit `doku.` – beim
 * ersten Start nach dem Update ziehen sie einmalig unter `knowstead.` um, damit niemand neu einstellen muss.
 *
 * Dieses Modul wird in main.tsx als Erstes geladen: bevor Farbschema, Sprache und Bewegung den Speicher lesen.
 */
function move(storage: Storage): void {
  const old: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith('doku.')) old.push(key);
  }
  for (const key of old) {
    const target = `knowstead.${key.slice('doku.'.length)}`;
    const value = storage.getItem(key);
    if (value !== null && storage.getItem(target) === null) storage.setItem(target, value);
    storage.removeItem(key);
  }
}

try {
  move(localStorage);
  move(sessionStorage);
} catch {
  /* Speicher gesperrt (privater Modus, Richtlinie): Dann gelten die Vorgaben */
}

export {};

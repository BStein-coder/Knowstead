/**
 * Bremse für Fehlversuche bei der Anmeldung – je Konto **und Absender**.
 *
 * Eine Sperre des ganzen Kontos nach wenigen Fehlversuchen lässt sich missbrauchen: Wer einen Benutzernamen kennt,
 * sperrt die Person mit ein paar falschen Kennwörtern aus. Deshalb zählt jeder Absender für sich; gesperrt wird nur
 * er. (Das ganze Konto sperrt `AuthService.login` erst bei sehr vielen Fehlversuchen aus vielen Richtungen.)
 *
 * Gezählt wird im Arbeitsspeicher: keine Adressen in der Datenbank, und nach einem Neustart beginnt die Zählung neu.
 * Der Schlüssel ist das Konto – oder, wenn es den Namen nicht gibt, der eingegebene Name: So verrät eine Sperre nicht,
 * ob ein Konto existiert.
 */

/** IPv6-Adressen eines Anschlusses teilen sich die ersten 64 Bit – sonst hätte ein Absender 2^64 Versuche. */
export function sourceOf(ip: string | null | undefined): string {
  let address = (ip ?? '').trim().toLowerCase();
  if (!address) return 'unbekannt';
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped) return mapped[1];
  if (!address.includes(':')) return address;
  address = address.split('%')[0];
  const [head, tail = ''] = address.split('::');
  const groups = head ? head.split(':') : [];
  if (address.includes('::')) {
    const rest = tail ? tail.split(':') : [];
    while (groups.length + rest.length < 8) groups.push('0');
    groups.push(...rest);
  }
  return `${groups
    .slice(0, 4)
    .map((g) => g.replace(/^0+(?=.)/, ''))
    .join(':')}::/64`;
}

interface Entry {
  failures: number;
  lockedUntil: number;
  touched: number;
}

/** Mehr Einträge hält die Bremse nicht vor – ältere fallen heraus (Schutz vor einer Flut erfundener Namen). */
const MAX_ENTRIES = 20_000;

export class LoginThrottle {
  private readonly entries = new Map<string, Entry>();
  private readonly now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Schlüssel eines Versuchs: Konto (oder eingegebener Name) und Absender. */
  static key(userId: number | undefined, login: string, ip: string | null | undefined): string {
    return `${userId ? `#${userId}` : `~${login.trim().toLowerCase().slice(0, 120)}`}|${sourceOf(ip)}`;
  }

  /** Verbleibende Sperrzeit in Millisekunden (0 = nicht gesperrt). */
  lockedFor(key: string): number {
    const entry = this.entries.get(key);
    return entry && entry.lockedUntil > this.now() ? entry.lockedUntil - this.now() : 0;
  }

  /** Fehlversuch zählen; `true`, wenn der Absender damit für dieses Konto gesperrt ist. */
  fail(key: string, maxAttempts: number, lockMs: number): boolean {
    const now = this.now();
    const previous = this.entries.get(key);
    // Fehlversuche verjähren nach der Sperrdauer: Wer sich über Wochen ab und zu vertippt, wird nie gesperrt
    const entry = previous && now - previous.touched < lockMs ? previous : { failures: 0, lockedUntil: 0, touched: now };
    entry.failures++;
    entry.touched = now;
    const locked = entry.failures >= maxAttempts;
    if (locked) {
      entry.failures = 0;
      entry.lockedUntil = now + lockMs;
    }
    // Ans Ende der Reihenfolge: Das Älteste steht in einer Map vorn
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (this.entries.size > MAX_ENTRIES) this.prune(lockMs);
    return locked;
  }

  /** Nach erfolgreicher Anmeldung: nur dieser Absender beginnt neu – die Zählung anderer bleibt. */
  clear(key: string): void {
    this.entries.delete(key);
  }

  /** Alle Sperren eines Kontos aufheben (Administration, neues Kennwort). */
  clearUser(userId: number): void {
    const prefix = `#${userId}|`;
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  /** Für die Benutzerverwaltung: Von wie vielen Absendern aus ist das Konto gerade gesperrt, und bis wann längstens? */
  lockedSources(userId: number): { count: number; until: string | null } {
    const prefix = `#${userId}|`;
    const now = this.now();
    let count = 0;
    let until = 0;
    for (const [key, entry] of this.entries) {
      if (entry.lockedUntil <= now || !key.startsWith(prefix)) continue;
      count++;
      until = Math.max(until, entry.lockedUntil);
    }
    return { count, until: count ? new Date(until).toISOString() : null };
  }

  get size(): number {
    return this.entries.size;
  }

  private prune(lockMs: number): void {
    const now = this.now();
    for (const [key, entry] of this.entries) if (entry.lockedUntil <= now && now - entry.touched >= lockMs) this.entries.delete(key);
    // Reicht das nicht, fällt das älteste Zehntel heraus
    let surplus = this.entries.size - Math.floor(MAX_ENTRIES * 0.9);
    for (const key of this.entries.keys()) {
      if (surplus-- <= 0) break;
      this.entries.delete(key);
    }
  }
}

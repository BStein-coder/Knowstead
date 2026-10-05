/**
 * Filter-Hooks für Erweiterungen. Ein Filter erhält einen Wert und gibt ihn
 * (ggf. verändert) zurück. Filter werden nach Priorität (aufsteigend)
 * ausgeführt. Wirft ein Filter einen `HttpError`, wird die Aktion abgebrochen.
 *
 * Eingebaute Hook-Namen:
 *  - `page.beforeSave`  Wert: { title, content, contentType }, Kontext: { page, user }
 *  - `page.render`      Wert: HTML-String für die Anzeige, Kontext: { page, user }
 *  - `page.export`      Wert: HTML-String für Exporte, Kontext: { page, format }
 *  - `search.results`   Wert: Trefferliste, Kontext: { query, user }
 */
export type FilterFn<T = unknown, C = unknown> = (value: T, context: C) => T | Promise<T>;

interface FilterEntry {
  fn: FilterFn<any, any>;
  priority: number;
  owner?: string;
}

export const KNOWN_HOOKS = ['page.beforeSave', 'page.render', 'page.export', 'search.results'] as const;

export class HookRegistry {
  private readonly filters = new Map<string, FilterEntry[]>();

  addFilter<T, C = unknown>(name: string, fn: FilterFn<T, C>, options: { priority?: number; owner?: string } = {}): () => void {
    const entry: FilterEntry = { fn, priority: options.priority ?? 10, owner: options.owner };
    const list = this.filters.get(name) ?? [];
    list.push(entry);
    list.sort((a, b) => a.priority - b.priority);
    this.filters.set(name, list);
    return () => {
      const current = this.filters.get(name);
      if (!current) return;
      const idx = current.indexOf(entry);
      if (idx >= 0) current.splice(idx, 1);
    };
  }

  has(name: string): boolean {
    return (this.filters.get(name)?.length ?? 0) > 0;
  }

  async apply<T, C = unknown>(name: string, value: T, context: C): Promise<T> {
    const list = this.filters.get(name);
    if (!list?.length) return value;
    let current = value;
    for (const entry of [...list]) {
      current = (await entry.fn(current, context)) as T;
    }
    return current;
  }

  removeByOwner(owner: string): void {
    for (const [name, list] of this.filters) {
      this.filters.set(
        name,
        list.filter((e) => e.owner !== owner),
      );
    }
  }
}

/**
 * Plugin „Beispiel-Erweiterung“ – Browserteil.
 *
 * Ein Client-Plugin ist ein ganz normales ES-Modul, das `activate(api)`
 * exportiert. Es läuft im selben Fenster wie die Oberfläche, bekommt aber nur
 * die dokumentierte API – siehe docs/PLUGINS.md.
 *
 * Hinweis: Diese Datei wird unverändert an den Browser ausgeliefert, also
 * bitte reines JavaScript (kein TypeScript, kein Build-Schritt) verwenden.
 */

/** Beschriftungen je Sprache der Oberfläche (`api.locale`). */
const TEXTS = {
  de: {
    tag: (n) => `${n} Tag${n === 1 ? '' : 'e'}`,
    hours: (n) => `${n} Std.`,
    minutes: (n) => `${n} Min.`,
    readingTime: (words, minutes) => `${words} Wörter · ${minutes} Min. Lesezeit`,
    countWords: 'Wörter zählen',
    countResult: (words, s) => `${words} Wörter, ${s.headings} Überschriften, ${s.links} interne Links – Version ${s.version}.`,
    countOnly: (words) => `${words} Wörter auf dieser Seite.`,
    countdownDescription: 'Zeigt die verbleibende Zeit bis zu einem Datum',
    targetDate: 'Zieldatum',
    labelParam: 'Beschriftung',
    remaining: 'Noch',
    since: 'seit',
    noDate: 'Countdown: bitte ein Zieldatum einstellen (Zahnrad oben rechts).',
    panelTitle: 'Seitenstatistik (Beispiel-Plugin)',
    loading: 'Wird geladen …',
    rows: ['Wörter', 'Zeichen', 'Überschriften', 'Interne Links', 'Version', 'Top-Autoren'],
    unavailable: 'Statistik nicht verfügbar',
  },
  en: {
    tag: (n) => `${n} day${n === 1 ? '' : 's'}`,
    hours: (n) => `${n} h`,
    minutes: (n) => `${n} min`,
    readingTime: (words, minutes) => `${words} words · ${minutes} min read`,
    countWords: 'Count words',
    countResult: (words, s) => `${words} words, ${s.headings} headings, ${s.links} internal links – version ${s.version}.`,
    countOnly: (words) => `${words} words on this page.`,
    countdownDescription: 'Shows the remaining time until a date',
    targetDate: 'Target date',
    labelParam: 'Label',
    remaining: 'Remaining',
    since: 'since',
    noDate: 'Countdown: please set a target date (gear icon at the top right).',
    panelTitle: 'Page statistics (example plugin)',
    loading: 'Loading …',
    rows: ['Words', 'Characters', 'Headings', 'Internal links', 'Version', 'Top authors'],
    unavailable: 'Statistics not available',
  },
};

/** Wörter zählen – dieselbe Logik wie auf dem Server. */
function countWords(text) {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

function formatRemaining(target, L) {
  const ms = target.getTime() - Date.now();
  const past = ms < 0;
  const total = Math.abs(ms);
  const days = Math.floor(total / 86400000);
  const hours = Math.floor((total % 86400000) / 3600000);
  const minutes = Math.floor((total % 3600000) / 60000);
  const parts = [];
  if (days) parts.push(L.tag(days));
  if (days < 30) parts.push(L.hours(hours));
  if (!days) parts.push(L.minutes(minutes));
  return { text: parts.join(' '), past };
}

export function activate(api) {
  const wpm = Number(api.settings.wpm) || 220;
  // Sprache kann sich zur Laufzeit ändern – daher bei jeder Ausgabe neu nachschlagen
  const L = () => TEXTS[api.locale] || TEXTS.de;
  const number = (n) => n.toLocaleString(api.locale === 'en' ? 'en-GB' : 'de-DE');
  // Standardbeschriftung „Noch“ in englischer Oberfläche übersetzen, eigene Texte bleiben
  const defaultLabel = () => (!api.settings.countdownDefaultLabel || api.settings.countdownDefaultLabel === 'Noch' ? L().remaining : api.settings.countdownDefaultLabel);

  /* Seitenkopf: eigene Lesezeit-Angabe neben den eingebauten Angaben. */
  api.registerPageMeta({
    id: 'reading-time',
    render: (ctx) => {
      const words = countWords(ctx.text);
      if (!words) return null;
      return `🧩 ${L().readingTime(number(words), Math.max(1, Math.round(words / wpm)))}`;
    },
  });

  /* Seitenaktion im Menü „…“. */
  api.registerPageAction({
    id: 'word-count',
    label: L().countWords,
    icon: 'Σ',
    onClick: async (ctx) => {
      const words = countWords(ctx.text);
      try {
        const stats = await api.fetch(`stats/${ctx.page.id}`);
        api.toast(L().countResult(number(words), stats), 'info');
      } catch {
        api.toast(L().countOnly(number(words)), 'info');
      }
    },
  });

  /* Editor-Makro: erscheint im Slash-Menü unter „Plugins“. */
  api.registerMacro({
    name: 'countdown',
    label: 'Countdown',
    description: L().countdownDescription,
    params: [
      { key: 'date', label: L().targetDate, type: 'date' },
      { key: 'label', label: L().labelParam, type: 'text', default: defaultLabel() },
    ],
    render: (el, params) => {
      const target = params.date ? new Date(String(params.date)) : null;
      el.className = 'plugin-countdown';
      el.style.cssText = 'display:flex;align-items:center;gap:.6em;font-weight:600';
      if (!target || Number.isNaN(target.getTime())) {
        el.textContent = L().noDate;
        el.style.fontWeight = '400';
        return;
      }
      const paint = () => {
        const { text, past } = formatRemaining(target, L());
        const date = target.toLocaleDateString(api.locale === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: 'long', year: 'numeric' });
        el.innerHTML = '';
        const badge = document.createElement('span');
        badge.textContent = past ? `${L().since} ${text}` : `${params.label || defaultLabel()} ${text}`;
        badge.style.cssText = `padding:.25em .6em;border-radius:999px;color:#fff;background:${past ? '#dc2626' : '#2563eb'}`;
        const when = document.createElement('span');
        when.textContent = date;
        when.style.cssText = 'font-weight:400;color:var(--text-muted)';
        el.append(badge, when);
      };
      paint();
      const timer = setInterval(paint, 30000);
      return () => clearInterval(timer);
    },
  });

  /* Panel unterhalb des Seiteninhalts. */
  if (api.settings.showPanel !== false) {
    api.registerPagePanel({
      id: 'stats',
      title: L().panelTitle,
      render: (el, ctx) => {
        let cancelled = false;
        el.textContent = L().loading;
        api
          .fetch(`stats/${ctx.page.id}`)
          .then((stats) => {
            if (cancelled) return;
            const [words, characters, headings, links, version, authors] = L().rows;
            const rows = [
              [words, number(stats.words)],
              [characters, number(stats.characters)],
              [headings, stats.headings],
              [links, stats.links],
              [version, stats.version],
              [authors, stats.contributors.map((c) => `${c.name} (${c.edits})`).join(', ') || '–'],
            ];
            el.innerHTML = '';
            const table = document.createElement('table');
            table.className = 'table';
            // Werte immer als Text setzen – nie per innerHTML (sonst XSS über Namen/Titel).
            for (const [key, value] of rows) {
              const tr = document.createElement('tr');
              const th = document.createElement('th');
              th.textContent = key;
              th.style.cssText = 'text-align:left;width:12rem';
              const td = document.createElement('td');
              td.textContent = String(value);
              tr.append(th, td);
              table.append(tr);
            }
            el.append(table);
          })
          .catch((err) => {
            if (!cancelled) el.textContent = `${L().unavailable}: ${err.message || err}`;
          });
        return () => {
          cancelled = true;
        };
      },
    });
  }
}

export default activate;

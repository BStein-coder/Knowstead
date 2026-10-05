/**
 * KI-Anbindung.
 *
 * Knowstead spricht mehrere Anbieter an und hält die Zugangsdaten ausschließlich auf
 * dem Server: Anthropic (Messages-API), OpenAI bzw. Azure OpenAI und jede
 * OpenAI-kompatible Schnittstelle (z. B. vLLM, LM Studio) sowie Ollama für den
 * Betrieb ohne Internet. Deshalb werden die Anfragen direkt per `fetch`
 * aufgebaut statt über ein anbieterspezifisches SDK.
 *
 * Grundsätze:
 *  - Standardmäßig ausgeschaltet; ein Administrator muss sie bewusst aktivieren.
 *  - Nur Benutzer mit dem Recht `ai.use` dürfen Anfragen stellen.
 *  - Jede Anfrage wird protokolliert (Aktion, Modell, Token, Dauer) – das ist
 *    zugleich das Tageslimit und die Grundlage für die Kostenkontrolle.
 *  - Inhalte werden gekürzt übertragen; Seiten werden vorher auf Klartext reduziert.
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { AiSettings } from '../../core/settings.ts';
import { nowIso } from '../../db/database.ts';
import { decryptSecret } from '../../core/crypto.ts';
import { HttpError, badRequest, forbidden } from '../../core/errors.ts';

export const AI_ACTIONS = {
  summarize: 'Zusammenfassen',
  improve: 'Sprachlich verbessern',
  shorten: 'Kürzen',
  translate: 'Übersetzen',
  tags: 'Stichwörter vorschlagen',
  title: 'Titel vorschlagen',
  outline: 'Gliederung erstellen',
  ask: 'Frage zur Seite',
  tasks: 'Aufgaben ableiten',
} as const;

export type AiAction = keyof typeof AI_ACTIONS;

export interface AiRequest {
  action: AiAction;
  /** Ausgangstext (Auswahl im Editor); ohne Angabe wird die Seite verwendet. */
  text?: string;
  pageId?: number;
  /** Zielsprache für „translate“. */
  language?: string;
  /** Frage für „ask“. */
  question?: string;
  /** Zusätzliche Anweisung der Benutzerin bzw. des Benutzers. */
  instruction?: string;
}

export interface AiResult {
  action: AiAction;
  text: string;
  model: string;
  provider: string;
  /** Vorschlagsliste bei „tags“/„tasks“ – aus dem Text gelesen. */
  items?: string[];
  usage: { inputTokens: number; outputTokens: number; durationMs: number };
  remaining: number | null;
}

const MAX_INPUT_CHARS = 24_000;
const TIMEOUT_MS = 60_000;

/** Systemanweisung je Aktion – bewusst knapp und auf Deutsch. */
function systemPrompt(action: AiAction, siteName: string): string {
  const base = `Du unterstützt Autorinnen und Autoren im Wissensmanagementsystem „${siteName}“. Antworte auf Deutsch, sachlich und ohne Vorrede.`;
  switch (action) {
    case 'summarize':
      return `${base} Fasse den Text in höchstens fünf Stichpunkten zusammen. Nutze einfache Markdown-Listen, keine Überschriften.`;
    case 'improve':
      return `${base} Verbessere Rechtschreibung, Grammatik und Verständlichkeit, ohne Inhalte, Zahlen oder Fachbegriffe zu verändern. Behalte Formatierung und Absätze bei. Gib nur den überarbeiteten Text zurück.`;
    case 'shorten':
      return `${base} Kürze den Text auf das Wesentliche (etwa die Hälfte), ohne Aussagen zu verlieren. Gib nur den gekürzten Text zurück.`;
    case 'translate':
      return `${base} Übersetze den Text. Behalte Formatierung, Fachbegriffe und Eigennamen bei. Gib nur die Übersetzung zurück.`;
    case 'tags':
      return `${base} Schlage bis zu acht kurze Stichwörter (ein bis zwei Wörter, klein geschrieben) für den Text vor. Antworte ausschließlich mit einer Liste, ein Stichwort je Zeile, ohne Aufzählungszeichen.`;
    case 'title':
      return `${base} Schlage fünf prägnante Seitentitel vor. Antworte ausschließlich mit einer Liste, ein Titel je Zeile, ohne Nummerierung.`;
    case 'outline':
      return `${base} Erstelle eine sinnvolle Gliederung als Markdown-Überschriften (## und ###) mit je einem erklärenden Satz darunter.`;
    case 'ask':
      return `${base} Beantworte die Frage ausschließlich anhand des bereitgestellten Seiteninhalts. Fehlt die Information, sage das deutlich. Nenne am Ende die Abschnitte, auf die du dich stützt.`;
    case 'tasks':
      return `${base} Leite konkrete Aufgaben aus dem Text ab. Antworte ausschließlich mit einer Liste, eine Aufgabe je Zeile im Format „Aufgabe – Verantwortlich – Frist“ (unbekannte Angaben weglassen).`;
    default:
      return base;
  }
}

function userPrompt(input: AiRequest, content: string): string {
  const extra = input.instruction?.trim() ? `\n\nZusätzliche Anweisung: ${input.instruction.trim()}` : '';
  if (input.action === 'ask') return `Frage: ${input.question?.trim() ?? ''}\n\nSeiteninhalt:\n"""\n${content}\n"""${extra}`;
  if (input.action === 'translate') return `Zielsprache: ${input.language?.trim() || 'Englisch'}\n\nText:\n"""\n${content}\n"""${extra}`;
  return `Text:\n"""\n${content}\n"""${extra}`;
}

interface Completion {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export class AiService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  settings(): AiSettings {
    return this.s.settings.get('ai');
  }

  private apiKey(): string {
    return decryptSecret(this.s.config.secret, this.settings().apiKey) ?? '';
  }

  /** Eingerichtet? (Ollama braucht keinen Schlüssel.) */
  isConfigured(): boolean {
    const ai = this.settings();
    if (!ai.enabled || !ai.model.trim()) return false;
    if (ai.provider === 'ollama') return !!ai.baseUrl.trim();
    if (ai.provider === 'azure' || ai.provider === 'custom') return !!ai.baseUrl.trim() && !!ai.apiKey;
    return !!ai.apiKey;
  }

  /** Darf dieser Benutzer die KI verwenden? */
  canUse(auth: AuthContext): boolean {
    return this.isConfigured() && this.s.perms.hasGlobal(auth, 'ai.use');
  }

  /** Verbrauch des heutigen Tages für einen Benutzer. */
  usedToday(userId: number): number {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    return this.s.db.value<number>('SELECT COUNT(*) FROM ai_usage WHERE user_id = ? AND ok = 1 AND created_at >= ?', userId, since.toISOString()) ?? 0;
  }

  status(auth: AuthContext) {
    const ai = this.settings();
    const available = this.canUse(auth);
    const used = auth.user ? this.usedToday(auth.user.id) : 0;
    return {
      enabled: ai.enabled,
      available,
      // Anbieter und Modell nur für Angemeldete – Gäste können die KI ohnehin nicht nutzen
      provider: auth.user ? ai.provider : '',
      model: auth.user ? ai.model : '',
      actions: available ? ai.actions.filter((a): a is AiAction => a in AI_ACTIONS) : [],
      dailyLimit: ai.dailyLimit,
      usedToday: used,
      remaining: ai.dailyLimit > 0 ? Math.max(0, ai.dailyLimit - used) : null,
    };
  }

  /* ------------------------------- Ausführung ------------------------------- */

  async run(auth: AuthContext, input: AiRequest): Promise<AiResult> {
    const user = this.s.perms.requireUser(auth);
    const ai = this.settings();
    if (!ai.enabled) throw badRequest('Die KI-Anbindung ist nicht aktiviert');
    if (!this.isConfigured()) throw badRequest('Die KI-Anbindung ist unvollständig eingerichtet');
    if (!this.s.perms.hasGlobal(auth, 'ai.use')) throw forbidden('Dir fehlt das Recht „KI-Funktionen nutzen“');
    if (!(input.action in AI_ACTIONS)) throw badRequest('Unbekannte KI-Aktion');
    if (!ai.actions.includes(input.action)) throw badRequest('Diese KI-Funktion ist nicht freigeschaltet');
    if (ai.dailyLimit > 0 && this.usedToday(user.id) >= ai.dailyLimit) {
      throw new HttpError(429, 'ai_limit', `Dein Tageslimit von ${ai.dailyLimit} KI-Anfragen ist erreicht.`);
    }

    // Inhalt bestimmen: ausgewählter Text oder Seiteninhalt (Klartext, gekürzt).
    // Eine angegebene Seite wird immer geprüft – auch wenn nur markierter Text mitkommt.
    let pageText = '';
    if (input.pageId) {
      const { page } = this.s.pages.requireViewable(auth, input.pageId);
      pageText = `${page.title}\n\n${page.content_text ?? ''}`.trim();
    }
    let content = (input.text ?? '').trim() || pageText;
    if (!content) throw badRequest('Es gibt keinen Text für diese Anfrage');
    if (input.action === 'ask' && !input.question?.trim()) throw badRequest('Bitte eine Frage angeben');
    const truncated = content.length > MAX_INPUT_CHARS;
    if (truncated) content = `${content.slice(0, MAX_INPUT_CHARS)}\n…(gekürzt)`;

    const started = Date.now();
    let completion: Completion;
    try {
      completion = await this.complete(
        [systemPrompt(input.action, this.s.settings.get('siteName')), ai.systemPrompt.trim()].filter(Boolean).join('\n\n'),
        userPrompt(input, content),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.record(user.id, input, ai, 0, 0, Date.now() - started, false, message);
      throw err instanceof HttpError ? err : new HttpError(502, 'ai_error', `Die KI-Anfrage ist fehlgeschlagen: ${message}`);
    }
    const durationMs = Date.now() - started;
    this.record(user.id, input, ai, completion.inputTokens, completion.outputTokens, durationMs, true, null);
    this.s.emit(auth, {
      type: 'ai.used',
      pageId: input.pageId ?? null,
      target: { type: 'ai', id: input.action, label: AI_ACTIONS[input.action] },
      data: { model: ai.model, provider: ai.provider, tokens: completion.inputTokens + completion.outputTokens },
    });

    const text = completion.text.trim();
    const items = input.action === 'tags' || input.action === 'tasks' || input.action === 'title' ? listItems(text) : undefined;
    const used = this.usedToday(user.id);
    return {
      action: input.action,
      text,
      items,
      model: ai.model,
      provider: ai.provider,
      usage: { inputTokens: completion.inputTokens, outputTokens: completion.outputTokens, durationMs },
      remaining: ai.dailyLimit > 0 ? Math.max(0, ai.dailyLimit - used) : null,
    };
  }

  private record(
    userId: number,
    input: AiRequest,
    ai: AiSettings,
    inputTokens: number,
    outputTokens: number,
    durationMs: number,
    ok: boolean,
    error: string | null,
  ): void {
    this.s.db.run(
      `INSERT INTO ai_usage (user_id, action, provider, model, page_id, input_tokens, output_tokens, duration_ms, ok, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      userId,
      input.action,
      ai.provider,
      ai.model,
      input.pageId ?? null,
      inputTokens,
      outputTokens,
      durationMs,
      ok ? 1 : 0,
      error?.slice(0, 500) ?? null,
      nowIso(),
    );
  }

  /* ------------------------------- Anbieter ------------------------------- */

  private async complete(system: string, prompt: string): Promise<Completion> {
    const ai = this.settings();
    const key = this.apiKey();
    const signal = AbortSignal.timeout(TIMEOUT_MS);

    if (ai.provider === 'anthropic') {
      // Messages-API: https://docs.anthropic.com/en/api/messages
      const base = (ai.baseUrl.trim() || 'https://api.anthropic.com').replace(/\/+$/, '');
      const res = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        // Aktuelle Claude-Modelle lehnen `temperature` ab – deshalb nie mitsenden.
        body: JSON.stringify({
          model: ai.model,
          max_tokens: ai.maxTokens,
          system,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal,
        redirect: 'manual',
      });
      const data = (await parse(res)) as {
        content?: { type: string; text?: string }[];
        stop_reason?: string;
        stop_details?: { category?: string };
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      if (data.stop_reason === 'refusal') {
        throw new HttpError(422, 'ai_refusal', 'Das Modell hat die Anfrage abgelehnt.');
      }
      const text = (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join('\n');
      return { text, inputTokens: data.usage?.input_tokens ?? 0, outputTokens: data.usage?.output_tokens ?? 0 };
    }

    if (ai.provider === 'ollama') {
      const base = (ai.baseUrl.trim() || 'http://localhost:11434').replace(/\/+$/, '');
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          model: ai.model,
          stream: false,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
          options: ai.sendTemperature ? { temperature: ai.temperature } : undefined,
        }),
        signal,
        redirect: 'manual',
      });
      const data = (await parse(res)) as { message?: { content?: string }; prompt_eval_count?: number; eval_count?: number };
      return { text: data.message?.content ?? '', inputTokens: data.prompt_eval_count ?? 0, outputTokens: data.eval_count ?? 0 };
    }

    // OpenAI, Azure OpenAI und jede OpenAI-kompatible Schnittstelle
    const isAzure = ai.provider === 'azure';
    const base = (ai.baseUrl.trim() || 'https://api.openai.com').replace(/\/+$/, '');
    const url = isAzure ? `${base}/chat/completions?api-version=2024-10-21` : `${base}/v1/chat/completions`;
    const body: Record<string, unknown> = {
      model: ai.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_completion_tokens: ai.maxTokens,
    };
    if (ai.sendTemperature) body.temperature = ai.temperature;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(isAzure ? { 'api-key': key } : { authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify(body),
      signal,
      redirect: 'manual',
    });
    const data = (await parse(res)) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }

  /* ----------------------------- Administration ----------------------------- */

  /** Verbindungstest mit einer kurzen Beispielanfrage. */
  async test(auth: AuthContext): Promise<{ ok: boolean; message: string; sample?: string; model: string }> {
    this.s.perms.requireGlobal(auth, 'admin');
    const ai = this.settings();
    if (!this.isConfigured()) return { ok: false, message: 'Bitte zuerst Anbieter, Modell und Zugangsdaten eintragen.', model: ai.model };
    const started = Date.now();
    try {
      const result = await this.complete(
        'Du bist ein Testlauf. Antworte mit genau einem kurzen Satz.',
        'Bestätige in einem Satz auf Deutsch, dass die Verbindung funktioniert.',
      );
      return {
        ok: true,
        message: `Antwort in ${Date.now() - started} ms (${result.inputTokens + result.outputTokens} Token).`,
        sample: result.text.trim(),
        model: ai.model,
      };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err), model: ai.model };
    }
  }

  /** Kennzahlen für die Administration. */
  stats(auth: AuthContext) {
    this.s.perms.requireGlobal(auth, 'admin');
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const totals = this.s.db.get<{ requests: number; input: number; output: number; failed: number }>(
      `SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output,
              COALESCE(SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END), 0) AS failed
         FROM ai_usage WHERE created_at >= ?`,
      since,
    );
    const perAction = this.s.db.all<{ action: string; n: number }>(
      'SELECT action, COUNT(*) AS n FROM ai_usage WHERE created_at >= ? GROUP BY action ORDER BY n DESC',
      since,
    );
    const perUser = this.s.db.all<{ name: string; n: number }>(
      `SELECT COALESCE(u.display_name, 'Unbekannt') AS name, COUNT(*) AS n
         FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.created_at >= ? GROUP BY a.user_id ORDER BY n DESC LIMIT 10`,
      since,
    );
    const recent = this.s.db.all<{ action: string; model: string; created_at: string; ok: number; error: string | null; name: string | null }>(
      `SELECT a.action, a.model, a.created_at, a.ok, a.error, u.display_name AS name
         FROM ai_usage a LEFT JOIN users u ON u.id = a.user_id
        ORDER BY a.id DESC LIMIT 20`,
    );
    return { since, totals, perAction, perUser, recent };
  }
}

/** Antwort lesen und Fehler mit brauchbarer Meldung werfen. */
async function parse(res: Response): Promise<unknown> {
  const body = await res.text();
  if (res.status >= 300 && res.status < 400) throw new Error('Der Anbieter antwortet mit einer Weiterleitung – bitte die Basis-URL prüfen.');
  let data: unknown = null;
  try {
    data = JSON.parse(body);
  } catch {
    /* keine JSON-Antwort – Meldung unten aus dem Status */
  }
  if (!res.ok) {
    const detail =
      (data as { error?: { message?: string } | string })?.error && typeof (data as { error?: { message?: string } }).error === 'object'
        ? ((data as { error: { message?: string } }).error.message ?? '')
        : typeof (data as { error?: string })?.error === 'string'
          ? ((data as { error: string }).error ?? '')
          : body.slice(0, 300);
    throw new Error(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return data ?? {};
}

/** Zeilenliste aus einer Modellantwort (Stichwörter, Titel, Aufgaben). */
function listItems(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((line) => line.length > 0 && line.length <= 200)
    .slice(0, 12);
}

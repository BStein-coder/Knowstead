/** Schlanker Fetch-Wrapper für die Knowstead-REST-API. */

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

/** Sprache der Oberfläche – der Server liefert Fehlermeldungen und Kataloge passend dazu. */
let apiLocale: string | null = null;
export function setApiLocale(locale: string): void {
  apiLocale = locale;
}

/** Ohne bekannte Sprache keine Kopfzeile – dann wählt der Server (Profil, Standardsprache der Installation). */
function localeHeader(): Record<string, string> {
  return apiLocale ? { 'X-Knowstead-Locale': apiLocale } : {};
}

function buildUrl(path: string, query?: Query): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    params.set(k, String(v));
  }
  const qs = params.toString();
  return qs ? `${path}${path.includes('?') ? '&' : '?'}${qs}` : path;
}

async function parseError(res: Response): Promise<ApiError> {
  let code = 'error';
  let message = `${apiLocale === 'en' ? 'Error' : 'Fehler'} ${res.status}`;
  let details: unknown;
  try {
    const data = await res.json();
    if (data?.error) {
      code = data.error.code ?? code;
      message = data.error.message ?? message;
      details = data.error.details;
    } else if (data?.message) message = data.message;
  } catch {
    /* keine JSON-Antwort */
  }
  if (res.status === 0 || res.status === 502 || res.status === 503) message = apiLocale === 'en' ? 'The server cannot be reached' : 'Der Server ist nicht erreichbar';
  return new ApiError(res.status, code, message, details);
}

export async function request<T>(method: string, path: string, options: { body?: unknown; query?: Query; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { 'X-Knowstead-Client': 'web', ...localeHeader(), Accept: 'application/json' };
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) body = options.body;
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), { method, headers, body, credentials: 'same-origin', signal: options.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', apiLocale === 'en' ? 'No connection to the server' : 'Keine Verbindung zum Server');
  }
  if (!res.ok) {
    const error = await parseError(res);
    if (res.status === 401) window.dispatchEvent(new CustomEvent('knowstead:unauthorized'));
    throw error;
  }
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string, query?: Query, signal?: AbortSignal) => request<T>('GET', path, { query, signal }),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, { body: body ?? {} }),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, { body: body ?? {} }),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, { body: body ?? {} }),
  del: <T>(path: string, query?: Query) => request<T>('DELETE', path, { query }),
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { body: form }),
};

/** Datei-Upload mit Fortschrittsanzeige (XHR). */
export function uploadWithProgress<T>(path: string, form: FormData, onProgress?: (percent: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    xhr.setRequestHeader('X-Knowstead-Client', 'web');
    for (const [name, value] of Object.entries(localeHeader())) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      let data: any = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* ignorieren */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(xhr.status, data?.error?.code ?? 'error', data?.error?.message ?? `${apiLocale === 'en' ? 'Upload failed' : 'Upload fehlgeschlagen'} (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, 'network', apiLocale === 'en' ? 'Upload failed' : 'Upload fehlgeschlagen'));
    xhr.send(form);
  });
}

/**
 * Datei per fetch holen und speichern – mit Fehlermeldung statt leerer Download-Seite
 * (für länger laufende Exporte und POST-Anfragen).
 */
export async function saveFile(method: 'GET' | 'POST', path: string, options: { body?: unknown; query?: Query; signal?: AbortSignal } = {}): Promise<string> {
  const headers: Record<string, string> = { 'X-Knowstead-Client': 'web', ...localeHeader() };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, 'network', apiLocale === 'en' ? 'No connection to the server' : 'Keine Verbindung zum Server');
  }
  if (!res.ok) throw await parseError(res);
  const disposition = res.headers.get('content-disposition') ?? '';
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const filename = encoded ? decodeURIComponent(encoded) : (disposition.match(/filename="([^"]+)"/i)?.[1] ?? 'download');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return filename;
}

/** Download über einen temporären Link (nutzt Cookie-Authentifizierung). */
export function download(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

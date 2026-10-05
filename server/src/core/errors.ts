/**
 * Fachliche Fehler mit HTTP-Status. Der globale Error-Handler wandelt sie in
 * `{ error: { code, message, details } }` um.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Anmeldung erforderlich') => new HttpError(401, 'unauthorized', message);
export const forbidden = (message = 'Dafür fehlt dir die Berechtigung') => new HttpError(403, 'forbidden', message);
export const notFound = (message = 'Nicht gefunden') => new HttpError(404, 'not_found', message);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'conflict', message, details);
export const tooLarge = (message: string) => new HttpError(413, 'too_large', message);
export const unprocessable = (message: string, details?: unknown) => new HttpError(422, 'unprocessable', message, details);

export function assert(condition: unknown, error: HttpError): asserts condition {
  if (!condition) throw error;
}

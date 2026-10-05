import { isRouteErrorResponse, useRouteError } from 'react-router';
import { useI18n } from '../i18n';

/** Nach einem Update fehlen ältere Programmteile – dann hilft Neuladen. */
export function isOutdatedBundleError(message: string): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch dynamically/i.test(message);
}

/**
 * Fehleransicht des Routers: ersetzt den Standard-Absturzbildschirm („Unexpected Application Error“)
 * durch eine verständliche Meldung mit Neuladen – die Navigation bleibt erhalten, wenn der Fehler in
 * einer Unterseite auftritt.
 */
export function RouteError() {
  const error = useRouteError();
  const { t } = useI18n();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error ?? '');
  const outdated = isOutdatedBundleError(message);
  return (
    <div className="not-found" role="alert" data-error-view>
      <h1>{outdated ? t('errors.updatedTitle') : t('errors.crashTitle')}</h1>
      <p className="muted mt-1">{outdated ? t('errors.updatedText') : t('errors.crashText')}</p>
      {!outdated && message && <pre className="route-error-message">{message}</pre>}
      <div className="row gap-sm mt-2 route-error-actions">
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          {t('errors.reload')}
        </button>
        <a href="/" className="btn">
          {t('errors.toHome')}
        </a>
      </div>
    </div>
  );
}

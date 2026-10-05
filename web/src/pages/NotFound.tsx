import { Link } from 'react-router';
import { useI18n } from '../i18n';
import { Scene3D } from '../components/Scene3D';

export function NotFound() {
  const { t } = useI18n();
  return (
    <div className="not-found-stage">
      <Scene3D variant="lost" />
      <div>
        {/* Die Zahl ist Schmuck – die Überschrift sagt dasselbe in Worten */}
        <div className="not-found-code" aria-hidden="true">
          404
        </div>
        <h1>{t('errors.notFoundTitle')}</h1>
        <p className="muted mt-1">{t('errors.notFoundText')}</p>
        <Link to="/" className="btn btn-primary mt-2">
          {t('errors.toHome')}
        </Link>
      </div>
    </div>
  );
}

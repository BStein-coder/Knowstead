import { useNavigate } from 'react-router';
import { useSpaces } from '../api/hooks';
import { useI18n } from '../i18n';
import { EmptyState, Loading, Modal } from './ui';

/** Auswahl des Zielbereichs für „Neue Seite“ außerhalb eines Bereichs. */
export function ChooseSpaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data, isLoading } = useSpaces({}, open);
  const spaces = (data ?? []).filter((s) => s.can.create);
  return (
    <Modal open={open} onClose={onClose} title={t('app.newPage')} size="sm">
      <p className="muted mb-2">{t('newPage.location')}</p>
      {isLoading && <Loading />}
      {!isLoading && spaces.length === 0 && <EmptyState compact title={t('spaces.empty')} />}
      <div className="list">
        {spaces.map((s) => (
          <button
            key={s.key}
            type="button"
            className="list-item"
            onClick={() => {
              onClose();
              navigate(`/s/${encodeURIComponent(s.key)}/new`);
            }}
          >
            <span className="space-icon" style={{ width: 30, height: 30, fontSize: 16 }}>
              {s.icon ?? '📘'}
            </span>
            <span className="list-item-body">
              <div className="list-item-title">{s.name}</div>
              <div className="list-item-meta">{s.kind === 'personal' ? t('spaces.personal') : s.key}</div>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarPlus, RefreshCw, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Alert, Button, CopyField, Field, Modal, Time } from '../../components/ui';

/**
 * Kalender-Abo: persönlicher Link für Outlook, Apple-Kalender, Google oder Thunderbird.
 * Der Link ist geheim und nur einmal im Klartext sichtbar; ein neuer Link ersetzt den alten.
 */
export function CalendarDialog({ boardId, boardName, onClose }: { boardId?: number; boardName?: string; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ['calendar-feed'], queryFn: () => api.get<{ active: boolean; createdAt: string | null; lastUsedAt: string | null }>('/api/v1/me/calendar') });
  const [link, setLink] = useState<{ url: string; webcal: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (status.data?.active && !(await dialogs.confirm({ title: t('tasks.calendarRenew'), message: t('tasks.calendarRenewText'), confirmLabel: t('tasks.calendarRenew') }))) return;
    setBusy(true);
    try {
      setLink(await api.post<{ url: string; webcal: string }>('/api/v1/me/calendar', {}));
      void qc.invalidateQueries({ queryKey: ['calendar-feed'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const revoke = async () => {
    if (!(await dialogs.confirm({ title: t('tasks.calendarRevoke'), message: t('tasks.calendarRevokeText'), danger: true, confirmLabel: t('tasks.calendarRevoke') }))) return;
    try {
      await api.del('/api/v1/me/calendar');
      setLink(null);
      toast.success(t('tasks.calendarRevoked'));
      void qc.invalidateQueries({ queryKey: ['calendar-feed'] });
    } catch (err) {
      toast.error(err);
    }
  };

  const withBoard = (url: string) => (boardId ? `${url}?board=${boardId}` : url);

  return (
    <Modal open onClose={onClose} icon={CalendarPlus} title={t('tasks.calendarTitle')} size="md" footer={<Button onClick={onClose}>{t('common.close')}</Button>}>
      <p className="muted mb-2">{t('tasks.calendarIntro')}</p>
      {link ? (
        <div className="col gap-sm">
          <Field label={t('tasks.calendarMine')} help={t('tasks.calendarMineHelp')}>
            <CopyField value={link.url} onCopied={() => toast.success(t('common.copied'))} />
          </Field>
          {boardId && (
            <Field label={t('tasks.calendarBoard', { name: boardName ?? '' })} help={t('tasks.calendarBoardHelp')}>
              <CopyField value={withBoard(link.url)} onCopied={() => toast.success(t('common.copied'))} />
            </Field>
          )}
          <div className="row gap-sm">
            <a className="btn btn-primary" href={withBoard(link.webcal)}>
              <CalendarPlus size={15} /> {t('tasks.calendarOpen')}
            </a>
          </div>
          <Alert variant="warning">{t('tasks.calendarSecret')}</Alert>
        </div>
      ) : status.data?.active ? (
        <Alert variant="info" title={t('tasks.calendarActive')}>
          {t('tasks.calendarActiveText')}{' '}
          {status.data.lastUsedAt ? (
            <>
              {t('tasks.calendarLastUsed')} <Time value={status.data.lastUsedAt} />.
            </>
          ) : (
            t('tasks.calendarNeverUsed')
          )}
        </Alert>
      ) : null}
      <div className="row gap-sm mt-2">
        <Button variant={link ? 'secondary' : 'primary'} icon={status.data?.active ? RefreshCw : CalendarPlus} loading={busy} onClick={() => void create()}>
          {status.data?.active ? t('tasks.calendarRenew') : t('tasks.calendarCreate')}
        </Button>
        {status.data?.active && (
          <Button variant="ghost" icon={Trash2} onClick={() => void revoke()}>
            {t('tasks.calendarRevoke')}
          </Button>
        )}
      </div>
      <details className="calendar-howto mt-2">
        <summary>{t('tasks.calendarHowto')}</summary>
        <ul className="small">
          <li>{t('tasks.calendarOutlook')}</li>
          <li>{t('tasks.calendarGoogle')}</li>
          <li>{t('tasks.calendarApple')}</li>
        </ul>
      </details>
    </Modal>
  );
}

import { useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { AlarmClock, BadgeCheck, CalendarClock, ShieldCheck, UserRound } from 'lucide-react';
import { api } from '../../api/client';
import type { Page, ReviewCycle, UserRef } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Avatar, Button, Field, Modal, Select, Time } from '../../components/ui';
import { AssigneePicker } from '../tasks/TaskComponents';

export const REVIEW_INTERVALS = [1, 3, 6, 12, 24, 36];

export function intervalLabel(t: (key: string, vars?: Record<string, string | number>) => string, months: number): string {
  if (!months) return t('reviewCycle.none');
  return months === 1 ? t('reviewCycle.month1') : t('reviewCycle.months', { n: months });
}

function useVerify(page: Page, onChanged: () => void) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const verify = async () => {
    setBusy(true);
    try {
      await api.post<ReviewCycle>(`/api/v1/pages/${page.id}/verify`, {});
      toast.success(t('reviewCycle.verified'));
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['content-reviews'] });
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };
  return { verify, busy };
}

/** Kurzinfo im Seitenkopf: geprüft / bald fällig / überfällig. */
export function ReviewCycleChip({ page, onOpen }: { page: Page; onOpen: () => void }) {
  const { t, fmt } = useI18n();
  const rc = page.reviewCycle;
  if (!rc || rc.state === 'none') {
    return rc?.owner ? (
      <button type="button" className="page-meta-item link-like" onClick={onOpen} title={t('reviewCycle.owner')}>
        <UserRound size={13} /> {rc.owner.displayName}
      </button>
    ) : null;
  }
  const icon = rc.state === 'overdue' ? <AlarmClock size={13} /> : rc.state === 'due' ? <CalendarClock size={13} /> : <BadgeCheck size={13} />;
  const label =
    rc.state === 'overdue'
      ? t('reviewCycle.chipOverdue', { date: fmt.date(rc.dueAt) })
      : rc.state === 'due'
        ? t('reviewCycle.chipDue', { date: fmt.date(rc.dueAt) })
        : rc.verifiedAt
          ? t('reviewCycle.chipOk', { date: fmt.date(rc.verifiedAt) })
          : t('reviewCycle.chipNext', { date: fmt.date(rc.dueAt) });
  return (
    <button type="button" className={`page-meta-item review-chip review-chip-${rc.state}`} onClick={onOpen} title={t('reviewCycle.menu')}>
      {icon} {label}
      {rc.owner && <span className="review-chip-owner">· {rc.owner.displayName}</span>}
    </button>
  );
}

/** Hinweis über dem Inhalt, wenn die Wiedervorlage fällig ist – nur für alle, die bestätigen dürfen. */
export function ReviewCycleBanner({ page, onChanged, onOpen }: { page: Page; onChanged: () => void; onOpen: () => void }) {
  const { t, fmt } = useI18n();
  const { verify, busy } = useVerify(page, onChanged);
  const rc = page.reviewCycle;
  if (!rc || !rc.canVerify || (rc.state !== 'overdue' && rc.state !== 'due')) return null;
  return (
    <div className="review-banner review-cycle-banner" data-status={rc.state === 'overdue' ? 'rejected' : 'pending'}>
      {rc.state === 'overdue' ? <AlarmClock size={16} /> : <CalendarClock size={16} />}
      <strong>{rc.state === 'overdue' ? t('reviewCycle.bannerOverdue') : t('reviewCycle.bannerDue')}</strong>
      <span className="muted">
        {t(rc.state === 'overdue' ? 'reviewCycle.bannerOverdueText' : 'reviewCycle.bannerDueText', { date: fmt.date(rc.dueAt) })}
      </span>
      <span className="spacer" />
      <Button size="sm" variant="ghost" onClick={onOpen}>
        {t('reviewCycle.settings')}
      </Button>
      <Button size="sm" variant="primary" icon={ShieldCheck} loading={busy} onClick={() => void verify()}>
        {t('reviewCycle.verify')}
      </Button>
    </div>
  );
}

/** Verantwortliche Person und Prüfintervall festlegen, Seite bestätigen. */
export function ReviewCycleDialog({ page, open, onClose, onChanged }: { page: Page; open: boolean; onClose: () => void; onChanged: () => void }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const rc = page.reviewCycle;
  const [owner, setOwner] = useState<UserRef | null>(rc.owner);
  const [interval, setInterval] = useState<string>(rc.pageIntervalMonths === null ? 'inherit' : String(rc.pageIntervalMonths));
  const [saving, setSaving] = useState(false);
  const { verify, busy } = useVerify(page, () => {
    onChanged();
    onClose();
  });

  const save = async () => {
    setSaving(true);
    try {
      await api.put<ReviewCycle>(`/api/v1/pages/${page.id}/review-cycle`, {
        ownerId: owner?.id ?? null,
        intervalMonths: interval === 'inherit' ? null : Number(interval),
      });
      toast.success(t('common.changesSaved'));
      void qc.invalidateQueries({ queryKey: ['content-reviews'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={ShieldCheck}
      title={t('reviewCycle.menu')}
      size="md"
      footer={
        <>
          {rc.canVerify && rc.intervalMonths > 0 && (
            <Button icon={BadgeCheck} loading={busy} onClick={() => void verify()}>
              {t('reviewCycle.verify')}
            </Button>
          )}
          <span className="spacer" />
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          {rc.canConfigure && (
            <Button variant="primary" loading={saving} onClick={() => void save()}>
              {t('common.save')}
            </Button>
          )}
        </>
      }
    >
      <div className="review-cycle-status">
        <div>
          <div className="small muted">{t('reviewCycle.lastVerified')}</div>
          <div>
            {rc.verifiedAt ? (
              <>
                {fmt.date(rc.verifiedAt)}
                {rc.verifiedBy && (
                  <span className="muted">
                    {' '}
                    · <Avatar user={rc.verifiedBy} size={16} /> {rc.verifiedBy.displayName}
                  </span>
                )}
              </>
            ) : (
              <span className="muted">{t('reviewCycle.never')}</span>
            )}
          </div>
        </div>
        <div>
          <div className="small muted">{t('reviewCycle.nextReview')}</div>
          <div className={rc.state === 'overdue' ? 'danger-text' : ''}>{rc.dueAt ? <Time value={rc.dueAt} mode="date" /> : <span className="muted">{t('reviewCycle.none')}</span>}</div>
        </div>
      </div>

      <Field label={t('reviewCycle.owner')} help={owner ? t('reviewCycle.ownerHelp') : t('reviewCycle.noOwner', { name: rc.responsible?.displayName ?? '—' })}>
        {rc.canConfigure ? (
          <AssigneePicker value={owner} onChange={setOwner} />
        ) : (
          <div>{owner ? owner.displayName : '—'}</div>
        )}
      </Field>
      <Field label={t('reviewCycle.interval')} help={t('reviewCycle.help')}>
        <Select value={interval} disabled={!rc.canConfigure} onChange={(e) => setInterval(e.target.value)}>
          <option value="inherit">{t('reviewCycle.inherit', { label: intervalLabel(t, rc.spaceIntervalMonths) })}</option>
          <option value="0">{t('reviewCycle.none')}</option>
          {REVIEW_INTERVALS.map((m) => (
            <option key={m} value={m}>
              {intervalLabel(t, m)}
            </option>
          ))}
        </Select>
      </Field>
      <p className="small muted">
        <Link to="/content-reviews">{t('reviewCycle.toOverview')}</Link>
      </p>
    </Modal>
  );
}

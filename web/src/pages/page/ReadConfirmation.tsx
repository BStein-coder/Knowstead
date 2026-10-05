import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, BookCheck, CheckCircle2, Download, FileSignature, Trash2, Users, X } from 'lucide-react';
import { api } from '../../api/client';
import type { Page, ReadAudienceEntry, ReadEvidence, ReadRequirementInfo, ReadState } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Avatar, Badge, Button, EmptyState, Field, IconButton, Input, Loading, Modal, Select, Switch, Tabs, Textarea, Time } from '../../components/ui';
import { SubjectPicker } from '../../components/Pickers';

const STATUS_COLOR = { confirmed: 'green', open: 'blue', overdue: 'red', former: 'gray' } as const;

/** Hinweis auf der Seite: Bitte „gelesen und verstanden“ bestätigen – oder bereits bestätigt. */
export function ReadConfirmationBanner({ page, onChanged }: { page: Page; onChanged: () => void }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const state = page.readConfirmation;
  if (!state) return null;

  if (state.status === 'confirmed') {
    return (
      <div className="read-confirmed small">
        <CheckCircle2 size={14} /> {t('reads.confirmedOn', { date: fmt.dateTime(state.confirmedAt!), version: state.confirmedVersion ?? '' })}
      </div>
    );
  }

  const confirm = async () => {
    const ok = await dialogs.confirm({ title: t('reads.confirmTitle'), message: state.statement, confirmLabel: t('reads.confirmButton') });
    if (!ok) return;
    setBusy(true);
    try {
      await api.post<ReadState>(`/api/v1/pages/${page.id}/read-confirmations`, {});
      toast.success(t('reads.confirmedToast'));
      void qc.invalidateQueries({ queryKey: ['me'] });
      void qc.invalidateQueries({ queryKey: ['read-requirements'] });
      onChanged();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="review-banner read-banner" data-status={state.status === 'overdue' ? 'rejected' : 'pending'} role="region" aria-label={t('reads.title')}>
      <FileSignature size={16} />
      <div className="grow">
        <strong>{state.status === 'overdue' ? t('reads.bannerOverdue', { date: fmt.date(state.dueAt) }) : t('reads.bannerOpen', { date: fmt.date(state.dueAt) })}</strong>
        <div className="small muted">{state.statement}</div>
      </div>
      <Button size="sm" variant="primary" icon={BookCheck} loading={busy} onClick={() => void confirm()}>
        {t('reads.confirmButton')}
      </Button>
    </div>
  );
}

/** Lesebestätigung anfordern, Einstellungen ändern und den Nachweis ansehen (Bereichsverwaltung). */
export function ReadRequirementDialog({ page, onClose, onChanged }: { page: Page; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const info = useQuery({ queryKey: ['read-requirement', page.id], queryFn: () => api.get<ReadRequirementInfo>(`/api/v1/pages/${page.id}/read-requirement`) });
  const requirement = info.data?.requirement ?? null;

  if (info.isLoading) {
    return (
      <Modal open onClose={onClose} title={t('reads.title')} size="lg">
        <Loading />
      </Modal>
    );
  }
  return <ReadRequirementForm key={requirement?.cycleStartedAt ?? 'neu'} page={page} requirement={requirement} onClose={onClose} onChanged={() => {
    void info.refetch();
    void qc.invalidateQueries({ queryKey: ['read-requirements'] });
    void qc.invalidateQueries({ queryKey: ['me'] });
    onChanged();
  }} toast={toast} dialogs={dialogs} />;
}

function ReadRequirementForm({
  page,
  requirement,
  onClose,
  onChanged,
  toast,
  dialogs,
}: {
  page: Page;
  requirement: ReadRequirementInfo['requirement'];
  onClose: () => void;
  onChanged: () => void;
  toast: ReturnType<typeof useToast>;
  dialogs: ReturnType<typeof useDialogs>;
}) {
  const { t, fmt } = useI18n();
  const [tab, setTab] = useState<'settings' | 'evidence'>(requirement ? 'evidence' : 'settings');
  const [audience, setAudience] = useState<(ReadAudienceEntry & { label: string })[]>(requirement?.audience ?? []);
  const [statement, setStatement] = useState(requirement?.statement ?? t('reads.defaultStatement'));
  const [dueDays, setDueDays] = useState(requirement?.dueDays ?? 14);
  const [reconfirm, setReconfirm] = useState(requirement?.reconfirmOnChange ?? true);
  const [repeat, setRepeat] = useState(requirement?.repeatMonths ?? 0);
  const [saving, setSaving] = useState(false);
  const everyone = audience.some((a) => a.type === 'space');

  const save = async (restart = false) => {
    setSaving(true);
    try {
      await api.put(`/api/v1/pages/${page.id}/read-requirement`, {
        audience: audience.map((a) => ({ type: a.type, id: a.id })),
        statement,
        dueDays,
        reconfirmOnChange: reconfirm,
        repeatMonths: repeat,
        restart,
      });
      toast.success(requirement ? t('common.changesSaved') : t('reads.requested'));
      onChanged();
      setTab('evidence');
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await dialogs.confirm({ title: t('reads.removeTitle'), message: t('reads.removeText'), danger: true, confirmLabel: t('reads.remove') });
    if (!ok) return;
    try {
      await api.del(`/api/v1/pages/${page.id}/read-requirement`);
      toast.success(t('reads.removed'));
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      icon={FileSignature}
      title={t('reads.title')}
      size="lg"
      footer={
        tab === 'settings' ? (
          <>
            {requirement && (
              <Button variant="ghost" icon={Trash2} onClick={() => void remove()}>
                {t('reads.remove')}
              </Button>
            )}
            <span className="spacer" />
            {requirement && (
              <Button variant="ghost" loading={saving} onClick={() => void save(true)} title={t('reads.restartHint')}>
                {t('reads.restart')}
              </Button>
            )}
            <Button variant="primary" loading={saving} disabled={!audience.length} onClick={() => void save(false)}>
              {requirement ? t('common.save') : t('reads.request')}
            </Button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <Button variant="ghost" onClick={onClose}>
              {t('common.close')}
            </Button>
          </>
        )
      }
    >
      {requirement && (
        <Tabs
          value={tab}
          onChange={setTab}
          className="mb-2"
          items={[
            { value: 'evidence', label: t('reads.evidence') },
            { value: 'settings', label: t('reads.settings') },
          ]}
        />
      )}
      {tab === 'settings' ? (
        <div className="stack">
          <p className="small muted">{t('reads.intro')}</p>
          <Field label={t('reads.audience')} help={t('reads.audienceHelp')}>
            <div className="chip-list mb-1">
              {audience.map((a) => (
                <span key={`${a.type}:${a.id}`} className="chip">
                  {a.type === 'group' ? <Users size={12} /> : null} {a.type === 'space' ? t('reads.everyone') : a.label}
                  <IconButton icon={X} label={t('common.remove')} onClick={() => setAudience(audience.filter((x) => x !== a))} />
                </span>
              ))}
            </div>
            <div className="row gap-xs" style={{ flexWrap: 'wrap' }}>
              <div className="grow" style={{ minWidth: 220 }}>
                <SubjectPicker exclude={audience.filter((a) => a.type !== 'space').map((a) => ({ type: a.type as 'user' | 'group', id: a.id }))} onPick={(s) => setAudience([...audience, { type: s.type, id: s.id, label: s.label }])} placeholder={t('reads.addAudience')} />
              </div>
              {!everyone && (
                <Button size="sm" onClick={() => setAudience([...audience, { type: 'space', id: 0, label: page.space.name }])}>
                  {t('reads.addEveryone')}
                </Button>
              )}
            </div>
          </Field>
          <Field label={t('reads.statement')}>
            <Textarea rows={2} value={statement} maxLength={500} onChange={(e) => setStatement(e.target.value)} />
          </Field>
          <div className="task-form-grid">
            <Field label={t('reads.dueDays')}>
              <Input type="number" min={1} max={365} value={dueDays} onChange={(e) => setDueDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))} />
            </Field>
            <Field label={t('reads.repeat')}>
              <Select value={repeat} onChange={(e) => setRepeat(Number(e.target.value))}>
                <option value={0}>{t('reads.repeatNever')}</option>
                {[6, 12, 24, 36].map((m) => (
                  <option key={m} value={m}>
                    {t('reads.repeatMonths', { n: m })}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Switch checked={reconfirm} onChange={setReconfirm} label={t('reads.reconfirm')} description={t('reads.reconfirmHelp')} />
        </div>
      ) : (
        requirement && <Evidence page={page} requirement={requirement} toast={toast} fmt={fmt} />
      )}
    </Modal>
  );
}

function Evidence({ page, requirement, toast, fmt }: { page: Page; requirement: NonNullable<ReadRequirementInfo['requirement']>; toast: ReturnType<typeof useToast>; fmt: ReturnType<typeof useI18n>['fmt'] }) {
  const { t } = useI18n();
  const [reminding, setReminding] = useState(false);
  const evidence = useQuery({ queryKey: ['read-evidence', page.id, requirement.cycleStartedAt], queryFn: () => api.get<ReadEvidence>(`/api/v1/pages/${page.id}/read-confirmations`) });
  const c = requirement.counts;
  const percent = c.total ? Math.round((c.confirmed / c.total) * 100) : 0;

  const remind = async () => {
    setReminding(true);
    try {
      const res = await api.post<{ reminded: number }>(`/api/v1/pages/${page.id}/read-reminders`, {});
      toast.success(t('reads.reminded', { n: res.reminded }));
    } catch (err) {
      toast.error(err);
    } finally {
      setReminding(false);
    }
  };

  return (
    <div className="stack">
      <div className="read-progress">
        <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
          <strong>{t('reads.progress', { confirmed: c.confirmed, total: c.total })}</strong>
          {c.overdue > 0 && <Badge color="red">{t('reads.overdueCount', { n: c.overdue })}</Badge>}
          {c.noAccess > 0 && <Badge color="yellow">{t('reads.noAccessCount', { n: c.noAccess })}</Badge>}
          <span className="spacer" />
          <span className="small muted">{t('reads.dueOn', { date: fmt.date(requirement.dueAt) })}</span>
        </div>
        <div className="task-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('reads.progressLabel')}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <div className="small muted">
          {t('reads.cycleInfo', { version: requirement.requiredVersion, date: fmt.date(requirement.cycleStartedAt) })}
          {requirement.nextCycleAt && ` · ${t('reads.nextCycle', { date: fmt.date(requirement.nextCycleAt) })}`}
        </div>
      </div>
      <div className="row gap-xs">
        <Button size="sm" icon={BellRing} loading={reminding} disabled={!c.open && !c.overdue} onClick={() => void remind()}>
          {t('reads.remindNow')}
        </Button>
        <a className="btn btn-sm" href={`/api/v1/pages/${page.id}/read-confirmations?format=csv`}>
          <Download size={14} /> {t('reads.exportCsv')}
        </a>
      </div>
      {evidence.isLoading ? (
        <Loading />
      ) : !evidence.data?.rows.length ? (
        <EmptyState compact icon={Users} title={t('reads.noAudience')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('reads.person')}</th>
                <th>{t('common.status')}</th>
                <th>{t('reads.confirmedAt')}</th>
                <th className="num">{t('reads.version')}</th>
              </tr>
            </thead>
            <tbody>
              {evidence.data.rows.map((row, i) => (
                <tr key={`${row.user?.id ?? row.userName}-${i}`}>
                  <td>
                    <span className="row gap-xs">
                      {row.user && <Avatar user={row.user} size={20} />} {row.userName}
                    </span>
                  </td>
                  <td>
                    <Badge color={STATUS_COLOR[row.status]}>{t(`reads.status.${row.status}`)}</Badge>
                    {row.noAccess && (
                      <div className="small danger-text">{t('reads.noAccess')}</div>
                    )}
                  </td>
                  <td className="small">{row.confirmedAt ? <Time value={row.confirmedAt} mode="datetime" /> : '—'}</td>
                  <td className="num">{row.confirmedVersion ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

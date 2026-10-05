import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ClipboardCheck, Clock3, MessageSquare, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { api } from '../../api/client';
import type { ApprovalWorkflow, Page, Review, UserRef } from '../../api/types';
import { WorkflowProgress } from './WorkflowProgress';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Avatar, Badge, Button, Field, Modal, Select, Textarea, Time } from '../../components/ui';

/**
 * Anzeige und Steuerung der Redaktionsprüfung einer Seite:
 * Statusband über dem Inhalt plus Dialog zum Anfordern einer Prüfung.
 */
export function ReviewBanner({ page, onChanged }: { page: Page; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [note, setNote] = useState('');
  const review = page.review;

  const { data } = useQuery({
    queryKey: ['page-reviews', page.id],
    queryFn: () => api.get<{ items: Review[] }>(`/api/v1/pages/${page.id}/reviews`),
    enabled: review.status === 'pending' || review.status === 'rejected',
  });
  const open = (data?.items ?? []).find((r) => r.status === 'open');
  const last = (data?.items ?? [])[0];

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['page-reviews', page.id] });
    onChanged();
  };

  const decide = useMutation({
    mutationFn: ({ approve, decisionNote }: { approve: boolean; decisionNote: string }) =>
      api.post<Review>(`/api/v1/reviews/${open?.id}/decision`, { approve, note: decisionNote }),
    onSuccess: (r) => {
      toast.success(r.status === 'approved' ? t('review.approved') : t('review.rejected'));
      setRejectOpen(false);
      setNote('');
      refresh();
    },
    onError: (err) => toast.error(err),
  });

  const withdraw = useMutation({
    mutationFn: () => api.del(`/api/v1/reviews/${open?.id}`),
    onSuccess: () => {
      toast.success(t('review.withdrawn'));
      refresh();
    },
    onError: (err) => toast.error(err),
  });

  if (review.status === 'none') return null;
  // Bei mehrstufigen Abläufen entscheidet die Stufe – nicht das Moderationsrecht
  const canDecide = open ? open.canDecide : false;
  const onBehalfOf = open?.workflow?.onBehalfOf ?? null;

  return (
    <>
      <div className="review-banner" data-status={review.status}>
        {review.status === 'pending' ? <Clock3 size={16} /> : review.status === 'approved' ? <BadgeCheck size={16} /> : <X size={16} />}
        <strong>
          {review.status === 'pending' ? t('review.statusPending') : review.status === 'approved' ? t('review.statusApproved') : t('review.statusRejected')}
        </strong>
        {review.status === 'approved' && review.approvedBy && (
          <span className="muted">
            {t('review.decidedBy', { user: review.approvedBy.displayName })} · <Time value={review.approvedAt} />
            {review.approvedVersion !== null && review.approvedVersion < page.version && ` · ${t('review.outdated')}`}
          </span>
        )}
        {open && (
          <span className="muted row gap-xs">
            {open.requestedBy && <Avatar user={open.requestedBy} size={18} />}
            {t('review.requestedBy', { user: open.requestedBy?.displayName ?? '—' })} · <Time value={open.createdAt} />
          </span>
        )}
        {open?.note && (
          <span className="row gap-xs">
            <MessageSquare size={13} /> {open.note}
          </span>
        )}
        {review.status === 'rejected' && last?.decisionNote && <span>{last.decisionNote}</span>}
        <span className="spacer" />
        {open && canDecide && (
          <>
            <Button size="sm" variant="primary" icon={ThumbsUp} loading={decide.isPending} onClick={() => decide.mutate({ approve: true, decisionNote: '' })}>
              {onBehalfOf ? t('workflow.approveOnBehalf', { name: onBehalfOf.displayName }) : open.workflow ? t('workflow.approveStage', { stage: open.workflow.stages[open.workflow.currentStage]?.name ?? '' }) : t('review.approve')}
            </Button>
            <Button size="sm" icon={ThumbsDown} onClick={() => setRejectOpen(true)}>
              {t('review.reject')}
            </Button>
          </>
        )}
        {open && !canDecide && open.requestedBy?.id && (
          <Button size="sm" variant="ghost" loading={withdraw.isPending} onClick={() => withdraw.mutate()}>
            {t('review.withdraw')}
          </Button>
        )}
      </div>
      {open?.workflow && <WorkflowProgress review={open} />}

      <Modal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title={t('review.reject')}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={decide.isPending} onClick={() => decide.mutate({ approve: false, decisionNote: note })}>
              {t('review.reject')}
            </Button>
          </>
        }
      >
        <Field label={t('review.decisionNote')}>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </>
  );
}

/** Dialog „Prüfung anfordern“ (aus dem Seitenmenü). */
export function RequestReviewDialog({ page, open, onClose, onDone }: { page: Page; open: boolean; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [note, setNote] = useState('');
  const [reviewerId, setReviewerId] = useState('');

  const { data: workflow } = useQuery({
    queryKey: ['approval-workflow', page.space.key],
    queryFn: () => api.get<ApprovalWorkflow>(`/api/v1/spaces/${encodeURIComponent(page.space.key)}/approval-workflow`),
    enabled: open,
  });
  const staged = !!workflow?.enabled && workflow.stages.length > 0;
  const { data: members } = useQuery({
    queryKey: ['space-members', page.space.key],
    queryFn: () => api.get<{ user: UserRef; role: string }[]>(`/api/v1/spaces/${encodeURIComponent(page.space.key)}/members`),
    enabled: open && page.review.canDecide && !staged,
  });

  const request = useMutation({
    mutationFn: () => api.post<Review>(`/api/v1/pages/${page.id}/reviews`, { note, reviewerId: reviewerId ? Number(reviewerId) : null }),
    onSuccess: () => {
      toast.success(t('review.requested'));
      setNote('');
      onClose();
      onDone();
    },
    onError: (err) => toast.error(err),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={ClipboardCheck}
      title={t('review.requestTitle')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={request.isPending} onClick={() => request.mutate()}>
            {t('review.request')}
          </Button>
        </>
      }
    >
      {page.review.required && (
        <p className="small muted" style={{ marginTop: 0 }}>
          <Badge color="blue">{t('review.title')}</Badge> {t('review.required')}
        </p>
      )}
      {staged && (
        <p className="small">
          {t('workflow.requestHint')} <strong>{workflow!.stages.map((s) => s.name).join(' → ')}</strong>
        </p>
      )}
      {!staged && !!members?.length && (
        <Field label={t('review.reviewer')}>
          <Select value={reviewerId} onChange={(e) => setReviewerId(e.target.value)}>
            <option value="">{t('review.anyReviewer')}</option>
            {members
              .filter((m) => m.role === 'admin')
              .map((m) => (
                <option key={m.user.id} value={m.user.id}>
                  {m.user.displayName}
                </option>
              ))}
          </Select>
        </Field>
      )}
      <Field label={t('review.note')}>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

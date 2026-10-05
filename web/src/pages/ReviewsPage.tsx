import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ClipboardCheck, FileText, GitCompare, MessageSquare, ThumbsDown, ThumbsUp } from 'lucide-react';
import { api } from '../api/client';
import type { Review } from '../api/types';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';
import { Avatar, Badge, Button, EmptyState, ErrorView, Loading, PageHeader, Tabs, Textarea, Time } from '../components/ui';

/** Posteingang für Prüfaufträge: freigeben, zurückweisen, vergleichen. */
export default function ReviewsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<'mine' | 'all' | 'done'>('mine');
  const [noteFor, setNoteFor] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const { data, isLoading, error } = useQuery({
    queryKey: ['reviews', tab],
    queryFn: () =>
      api.get<{ items: Review[] }>('/api/v1/reviews', {
        mine: tab === 'mine' ? true : undefined,
        status: tab === 'done' ? 'approved' : 'open',
        limit: 100,
      }),
  });

  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: number; approve: boolean }) =>
      api.post<Review>(`/api/v1/reviews/${id}/decision`, { approve, note }),
    onSuccess: (review) => {
      toast.success(review.status === 'approved' ? t('review.approved') : t('review.rejected'));
      setNoteFor(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      void qc.invalidateQueries({ queryKey: ['page', review.pageId] });
    },
    onError: (err) => toast.error(err),
  });

  const items = data?.items ?? [];

  return (
    <div className="container">
      <PageHeader
        icon={ClipboardCheck}
        title={t('review.inbox')}
        subtitle={t('review.emptyHint')}
        actions={<Badge color={items.length ? 'blue' : 'gray'}>{items.length}</Badge>}
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'mine', label: t('review.mine') },
          { value: 'all', label: t('review.all') },
          { value: 'done', label: t('review.statusApproved') },
        ]}
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorView error={error} />
      ) : !items.length ? (
        <EmptyState icon={BadgeCheck} title={t('review.empty')} text={t('review.emptyHint')} />
      ) : (
        <div style={{ marginTop: '1rem' }}>
          {items.map((r) => (
            <article key={r.id} className="review-card">
              <div className="review-card-head">
                <FileText size={15} className="muted" />
                <Link to={r.page?.url ?? '#'} className="review-card-title">
                  {r.page?.icon} {r.page?.title ?? `#${r.pageId}`}
                </Link>
                <Badge color="gray">{r.page?.spaceName}</Badge>
                <Badge color={r.status === 'open' ? 'blue' : r.status === 'approved' ? 'green' : 'red'}>
                  {r.status === 'open' ? t('review.statusPending') : r.status === 'approved' ? t('review.statusApproved') : t('review.statusRejected')}
                </Badge>
                {r.currentVersion > r.version && <Badge color="yellow">{t('review.outdated')}</Badge>}
                <span className="spacer" />
                <span className="tiny faint">
                  <Time value={r.createdAt} />
                </span>
              </div>
              <div className="row gap-sm small muted">
                {r.requestedBy && <Avatar user={r.requestedBy} size={20} />}
                <span>{t('review.requestedBy', { user: r.requestedBy?.displayName ?? '—' })}</span>
                <span>·</span>
                <span>{t('review.version', { n: r.version })}</span>
                {r.reviewer && (
                  <>
                    <span>·</span>
                    <span>
                      {t('review.reviewer')}: {r.reviewer.displayName}
                    </span>
                  </>
                )}
              </div>
              {r.note && (
                <p className="small" style={{ margin: 0 }}>
                  <MessageSquare size={13} className="muted" /> {r.note}
                </p>
              )}
              {r.decisionNote && <p className="small muted" style={{ margin: 0 }}>{r.decisionNote}</p>}
              {r.status === 'open' && r.canDecide && (
                <>
                  {noteFor === r.id && (
                    <Textarea rows={2} placeholder={t('review.decisionNote')} value={note} onChange={(e) => setNote(e.target.value)} />
                  )}
                  <div className="row gap-sm">
                    <Button
                      size="sm"
                      variant="primary"
                      icon={ThumbsUp}
                      loading={decide.isPending}
                      onClick={() => decide.mutate({ id: r.id, approve: true })}
                    >
                      {t('review.approve')}
                    </Button>
                    <Button
                      size="sm"
                      icon={ThumbsDown}
                      onClick={() => (noteFor === r.id ? decide.mutate({ id: r.id, approve: false }) : (setNoteFor(r.id), setNote('')))}
                    >
                      {t('review.reject')}
                    </Button>
                    {r.page && r.version > 1 && (
                      <Link
                        className="btn btn-ghost btn-sm"
                        to={`/s/${encodeURIComponent(r.page.spaceKey)}/diff/${r.pageId}?from=${Math.max(1, r.version - 1)}&to=${r.version}`}
                      >
                        <GitCompare size={14} /> {t('changes.compare')}
                      </Link>
                    )}
                  </div>
                </>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

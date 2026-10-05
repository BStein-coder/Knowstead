import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, BadgeCheck, CalendarClock, ShieldCheck } from 'lucide-react';
import { api } from '../api/client';
import type { UserRef } from '../api/types';
import { useSpaces } from '../api/hooks';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';
import { Avatar, Badge, Button, EmptyState, Loading, PageHeader, Select, Tabs, Time } from '../components/ui';
import { intervalLabel } from './page/ReviewCycle';

interface Item {
  id: number;
  title: string;
  icon: string | null;
  url: string;
  space: { key: string; name: string; icon: string | null };
  owner: UserRef | null;
  responsible: UserRef | null;
  intervalMonths: number;
  verifiedAt: string | null;
  dueAt: string;
  state: 'ok' | 'due' | 'overdue';
  updatedAt: string;
}

type Filter = 'attention' | 'overdue' | 'due' | 'all';

/** Übersicht der Wiedervorlagen: was muss wann geprüft werden? */
export default function ContentReviewsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [state, setState] = useState<Filter>('attention');
  const [space, setSpace] = useState('');
  const { data: spaces } = useSpaces({});
  const { data, isLoading } = useQuery({
    queryKey: ['content-reviews', scope, state, space],
    queryFn: () => api.get<{ items: Item[]; counts: { overdue: number; due: number; ok: number } }>('/api/v1/content-reviews', { scope, state, space: space || undefined }),
  });
  const [busy, setBusy] = useState<number | null>(null);

  const verify = async (item: Item) => {
    setBusy(item.id);
    try {
      await api.post(`/api/v1/pages/${item.id}/verify`, {});
      toast.success(t('reviewCycle.verified'));
      void qc.invalidateQueries({ queryKey: ['content-reviews'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const counts = data?.counts ?? { overdue: 0, due: 0, ok: 0 };

  return (
    <div className="container">
      <PageHeader icon={ShieldCheck} title={t('reviewCycle.overviewTitle')} subtitle={t('reviewCycle.overviewSubtitle')} />
      <div className="row gap-sm mb-2" style={{ flexWrap: 'wrap' }}>
        <Tabs
          value={scope}
          onChange={setScope}
          items={[
            { value: 'mine', label: t('reviewCycle.scopeMine') },
            { value: 'all', label: t('reviewCycle.scopeAll') },
          ]}
        />
        <span className="spacer" />
        <Select value={space} onChange={(e) => setSpace(e.target.value)} style={{ width: 220 }} aria-label={t('common.space')}>
          <option value="">{t('changes.allSpaces')}</option>
          {(spaces ?? [])
            .filter((s) => s.kind === 'team')
            .map((s) => (
              <option key={s.key} value={s.key}>
                {s.icon} {s.name}
              </option>
            ))}
        </Select>
      </div>
      <div className="review-stats mb-2">
        {(
          [
            ['attention', t('reviewCycle.filterAttention'), counts.overdue + counts.due, 'blue'],
            ['overdue', t('reviewCycle.filterOverdue'), counts.overdue, 'red'],
            ['due', t('reviewCycle.filterDue'), counts.due, 'yellow'],
            ['all', t('reviewCycle.filterAll'), counts.overdue + counts.due + counts.ok, 'gray'],
          ] as const
        ).map(([value, label, n, color]) => (
          <button key={value} type="button" className={`review-stat ${state === value ? 'active' : ''}`} onClick={() => setState(value)}>
            <span>{label}</span>
            <Badge color={n ? color : 'gray'}>{n}</Badge>
          </button>
        ))}
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <EmptyState icon={BadgeCheck} title={t('reviewCycle.empty')} text={t('reviewCycle.emptyHint')} />
      ) : (
        <div className="table-wrap">
          <table className="table review-table">
            <thead>
              <tr>
                <th>{t('common.page')}</th>
                <th>{t('reviewCycle.owner')}</th>
                <th>{t('reviewCycle.interval')}</th>
                <th>{t('reviewCycle.lastVerified')}</th>
                <th>{t('reviewCycle.nextReview')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <Link to={item.url} className="strong">
                      {item.icon ?? '📄'} {item.title}
                    </Link>
                    <div className="small muted">
                      {item.space.icon} {item.space.name}
                    </div>
                  </td>
                  <td>
                    {item.owner ? (
                      <span className="row gap-xs">
                        <Avatar user={item.owner} size={20} /> {item.owner.displayName}
                      </span>
                    ) : (
                      <span className="small muted" title={t('reviewCycle.noOwnerShort')}>
                        {item.responsible ? `(${item.responsible.displayName})` : '—'}
                      </span>
                    )}
                  </td>
                  <td className="small">{intervalLabel(t, item.intervalMonths)}</td>
                  <td className="small">{item.verifiedAt ? <Time value={item.verifiedAt} mode="date" /> : <span className="muted">{t('reviewCycle.never')}</span>}</td>
                  <td className="nowrap">
                    <Badge color={item.state === 'overdue' ? 'red' : item.state === 'due' ? 'yellow' : 'green'}>
                      {item.state === 'overdue' ? <AlarmClock size={11} /> : item.state === 'due' ? <CalendarClock size={11} /> : <BadgeCheck size={11} />}{' '}
                      <Time value={item.dueAt} mode="date" />
                    </Badge>
                  </td>
                  <td className="actions-cell">
                    <Button size="sm" icon={ShieldCheck} loading={busy === item.id} onClick={() => void verify(item)}>
                      {t('reviewCycle.verifyShort')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

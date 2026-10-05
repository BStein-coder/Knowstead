import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { BookCheck, FileSignature } from 'lucide-react';
import { api } from '../api/client';
import type { ReadRequirementInfo, ReadState } from '../api/types';
import { useI18n } from '../i18n';
import { Badge, EmptyState, Loading, PageHeader, Tabs, Time } from '../components/ui';

interface MineItem {
  page: { id: number; title: string; url: string; spaceName: string };
  state: ReadState;
}

interface ManagedItem {
  page: { id: number; title: string; url: string; spaceName: string };
  requirement: NonNullable<ReadRequirementInfo['requirement']>;
}

/** Pflichtdokumente: eigene offene Bestätigungen und – für die Bereichsverwaltung – der Fortschritt. */
export default function ReadConfirmationsPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<'mine' | 'managed'>('mine');
  const mine = useQuery({ queryKey: ['read-requirements', 'mine'], queryFn: () => api.get<{ items: MineItem[] }>('/api/v1/me/read-requirements') });
  const managed = useQuery({ queryKey: ['read-requirements', 'managed'], queryFn: () => api.get<{ items: ManagedItem[] }>('/api/v1/read-requirements') });
  const canManage = (managed.data?.items.length ?? 0) > 0;

  return (
    <div className="container">
      <PageHeader icon={FileSignature} title={t('reads.pageTitle')} subtitle={t('reads.pageSubtitle')} />
      {canManage && (
        <Tabs
          value={tab}
          onChange={setTab}
          className="mb-2"
          items={[
            { value: 'mine', label: t('reads.tabMine') },
            { value: 'managed', label: t('reads.tabManaged') },
          ]}
        />
      )}
      {tab === 'mine' || !canManage ? (
        mine.isLoading ? (
          <Loading />
        ) : !mine.data?.items.length ? (
          <EmptyState icon={BookCheck} title={t('reads.emptyMine')} text={t('reads.emptyMineHint')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('common.page')}</th>
                  <th>{t('common.status')}</th>
                  <th>{t('reads.due')}</th>
                </tr>
              </thead>
              <tbody>
                {mine.data.items.map((item) => (
                  <tr key={item.page.id}>
                    <td>
                      <Link to={item.page.url} className="strong">
                        {item.page.title}
                      </Link>
                      <div className="small muted">{item.page.spaceName}</div>
                    </td>
                    <td>
                      <Badge color={item.state.status === 'confirmed' ? 'green' : item.state.status === 'overdue' ? 'red' : 'blue'}>{t(`reads.status.${item.state.status}`)}</Badge>
                      {item.state.confirmedAt && (
                        <div className="small muted">
                          <Time value={item.state.confirmedAt} mode="date" />
                        </div>
                      )}
                    </td>
                    <td className="small">{item.state.status === 'confirmed' ? '—' : <Time value={item.state.dueAt} mode="date" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : managed.isLoading ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.page')}</th>
                <th>{t('reads.progressShort')}</th>
                <th>{t('reads.due')}</th>
              </tr>
            </thead>
            <tbody>
              {(managed.data?.items ?? []).map((item) => {
                const c = item.requirement.counts;
                const percent = c.total ? Math.round((c.confirmed / c.total) * 100) : 0;
                return (
                  <tr key={item.page.id}>
                    <td>
                      <Link to={item.page.url} className="strong">
                        {item.page.title}
                      </Link>
                      <div className="small muted">
                        {item.page.spaceName} · {item.requirement.audience.map((a) => (a.type === 'space' ? t('reads.everyone') : a.label)).join(', ')}
                      </div>
                    </td>
                    <td style={{ minWidth: 200 }}>
                      <div className="row gap-xs small">
                        {t('reads.progress', { confirmed: c.confirmed, total: c.total })}
                        {c.overdue > 0 && <Badge color="red">{t('reads.overdueCount', { n: c.overdue })}</Badge>}
                      </div>
                      <div className="task-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={t('reads.progressLabel')}>
                        <span style={{ width: `${percent}%` }} />
                      </div>
                    </td>
                    <td className="small">
                      <Time value={item.requirement.dueAt} mode="date" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

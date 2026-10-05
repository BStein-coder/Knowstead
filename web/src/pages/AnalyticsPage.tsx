import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BarChart3, Check, Download, FilePlus2, Link2Off, SearchX, Unlink, EyeOff, TrendingUp } from 'lucide-react';
import { api } from '../api/client';
import type { PageSummary } from '../api/types';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';
import { Badge, Button, EmptyState, ErrorView, Loading, PageHeader, Select, Time } from '../components/ui';

type List = 'top' | 'unread' | 'searches' | 'orphans' | 'links';
type DismissKind = 'search' | 'orphan' | 'link' | 'unread';

interface Report {
  days: number;
  from: string;
  spaces: { key: string; name: string }[];
  canSeeSearches: boolean;
  summary: { views: number; pages: number; unread: number; failedSearches: number; orphans: number; brokenLinks: number };
  topPages: { page: PageSummary; views: number; readers: number }[];
  unreadPages: { page: PageSummary; lastReadAt: string | null }[];
  failedSearches: { query: string; searches: number; lastDay: string }[];
  orphans: { page: PageSummary; children: number; topLevel: boolean }[];
  brokenLinks: { source: PageSummary; kind: 'page' | 'attachment'; targetId: number; reason: 'missing' | 'deleted' | 'draft'; targetLabel: string | null; item: string }[];
}

/** Inhaltsanalyse: Arbeitsliste für die Redaktion. */
export default function AnalyticsPage() {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [space, setSpace] = useState('');
  const [days, setDays] = useState(90);
  const [list, setList] = useState<List>('top');
  const [busy, setBusy] = useState<string | null>(null);

  const spaces = useQuery({ queryKey: ['analytics-spaces'], queryFn: () => api.get<{ items: { key: string; name: string }[]; canSeeSearches: boolean }>('/api/v1/analytics/spaces') });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics', space, days],
    queryFn: () => api.get<Report>('/api/v1/analytics', { space: space || undefined, days }),
  });

  const dismiss = async (kind: DismissKind, item: string) => {
    setBusy(`${kind}:${item}`);
    try {
      await api.put('/api/v1/analytics/dismissed', { kind, item, dismissed: true });
      toast.success(t('analytics.dismissed'));
      void qc.invalidateQueries({ queryKey: ['analytics'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(null);
    }
  };

  const exportUrl = (name: List) => {
    const params = new URLSearchParams({ days: String(days) });
    if (space) params.set('space', space);
    return `/api/v1/analytics/export/${name}?${params}`;
  };

  const summary = data?.summary;
  const tiles: { value: List; label: string; count: number | undefined; icon: typeof TrendingUp; tone: 'blue' | 'yellow' | 'red' | 'gray' }[] = [
    { value: 'top', label: t('analytics.top'), count: summary?.views, icon: TrendingUp, tone: 'blue' },
    { value: 'unread', label: t('analytics.unread'), count: summary?.unread, icon: EyeOff, tone: 'yellow' },
    ...(data?.canSeeSearches || spaces.data?.canSeeSearches ? [{ value: 'searches' as const, label: t('analytics.searches'), count: summary?.failedSearches, icon: SearchX, tone: 'yellow' as const }] : []),
    { value: 'orphans', label: t('analytics.orphans'), count: summary?.orphans, icon: Unlink, tone: 'gray' },
    { value: 'links', label: t('analytics.links'), count: summary?.brokenLinks, icon: Link2Off, tone: 'red' },
  ];

  const dismissButton = (kind: DismissKind, item: string) => (
    <Button size="sm" variant="ghost" icon={Check} loading={busy === `${kind}:${item}`} onClick={() => void dismiss(kind, item)} title={t('analytics.dismissHint')}>
      {t('analytics.dismiss')}
    </Button>
  );

  const pageCell = (page: PageSummary) => (
    <td>
      <Link to={page.url} className="strong">
        {page.icon ?? '📄'} {page.title}
      </Link>
      {!space && <div className="small muted">{page.spaceName}</div>}
    </td>
  );

  return (
    <div className="container container-wide">
      <PageHeader icon={BarChart3} title={t('analytics.title')} subtitle={t('analytics.subtitle')} />
      <div className="row gap-sm mb-2" style={{ flexWrap: 'wrap' }}>
        <Select value={space} onChange={(e) => setSpace(e.target.value)} style={{ width: 240 }} aria-label={t('common.space')}>
          <option value="">{t('analytics.allSpaces')}</option>
          {(spaces.data?.items ?? []).map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 180 }} aria-label={t('analytics.range')}>
          {[30, 90, 180, 365].map((d) => (
            <option key={d} value={d}>
              {t('analytics.lastDays', { n: d })}
            </option>
          ))}
        </Select>
        <span className="spacer" />
        <a className="btn btn-sm" href={exportUrl(list)}>
          <Download size={14} /> {t('analytics.exportCsv')}
        </a>
      </div>

      <div className="review-stats analytics-stats mb-2">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <button key={tile.value} type="button" className={`review-stat ${list === tile.value ? 'active' : ''}`} aria-pressed={list === tile.value} onClick={() => setList(tile.value)}>
              <span>
                <Icon size={14} /> {tile.label}
              </span>
              <Badge color={tile.count ? tile.tone : 'gray'}>{tile.count === undefined ? '…' : fmt.number(tile.count)}</Badge>
            </button>
          );
        })}
      </div>

      {error ? (
        <ErrorView error={error} onRetry={() => void refetch()} />
      ) : isLoading || !data ? (
        <Loading />
      ) : (
        <>
          <p className="small muted mb-1">{t(`analytics.help.${list}`, { n: data.days })}</p>

          {list === 'top' &&
            (data.topPages.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="num">#</th>
                      <th>{t('common.page')}</th>
                      <th className="num">{t('analytics.views')}</th>
                      <th className="num">{t('analytics.readers')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.topPages.map((row, i) => (
                      <tr key={row.page.id}>
                        <td className="num muted">{i + 1}</td>
                        {pageCell(row.page)}
                        <td className="num">
                          <span className="analytics-bar" style={{ ['--share' as string]: `${Math.round((row.views / data.topPages[0].views) * 100)}%` }}>
                            {fmt.number(row.views)}
                          </span>
                        </td>
                        <td className="num">{fmt.number(row.readers)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={TrendingUp} title={t('analytics.emptyTop')} compact />
            ))}

          {list === 'unread' &&
            (data.unreadPages.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('common.page')}</th>
                      <th>{t('analytics.lastRead')}</th>
                      <th>{t('analytics.updated')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.unreadPages.map((row) => (
                      <tr key={row.page.id}>
                        {pageCell(row.page)}
                        <td className="small">{row.lastReadAt ? <Time value={row.lastReadAt} mode="date" /> : <Badge color="yellow">{t('analytics.never')}</Badge>}</td>
                        <td className="small">
                          <Time value={row.page.updatedAt} mode="date" />
                        </td>
                        <td className="actions-cell">{dismissButton('unread', String(row.page.id))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={EyeOff} title={t('analytics.emptyUnread')} compact />
            ))}

          {list === 'searches' &&
            (data.failedSearches.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('analytics.query')}</th>
                      <th className="num">{t('analytics.searchCount')}</th>
                      <th>{t('analytics.lastSearched')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.failedSearches.map((row) => (
                      <tr key={row.query}>
                        <td>
                          <Link to={`/search?q=${encodeURIComponent(row.query)}`} className="strong">
                            {row.query}
                          </Link>
                        </td>
                        <td className="num">{fmt.number(row.searches)}</td>
                        <td className="small">
                          <Time value={row.lastDay} mode="date" />
                        </td>
                        <td className="actions-cell">
                          {space && (
                            <Link className="btn btn-sm btn-ghost" to={`/s/${encodeURIComponent(space)}/new?title=${encodeURIComponent(row.query)}`}>
                              <FilePlus2 size={14} /> {t('analytics.createPage')}
                            </Link>
                          )}
                          {dismissButton('search', row.query)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={SearchX} title={t('analytics.emptySearches')} compact />
            ))}

          {list === 'orphans' &&
            (data.orphans.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('common.page')}</th>
                      <th>{t('analytics.position')}</th>
                      <th className="num">{t('analytics.children')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.orphans.map((row) => (
                      <tr key={row.page.id}>
                        {pageCell(row.page)}
                        <td className="small">{row.topLevel ? <Badge color="yellow">{t('analytics.topLevel')}</Badge> : t('analytics.inTree')}</td>
                        <td className="num">{row.children}</td>
                        <td className="actions-cell">{dismissButton('orphan', String(row.page.id))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={Unlink} title={t('analytics.emptyOrphans')} compact />
            ))}

          {list === 'links' &&
            (data.brokenLinks.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('analytics.linkSource')}</th>
                      <th>{t('analytics.linkTarget')}</th>
                      <th>{t('analytics.linkReason')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.brokenLinks.map((row) => (
                      <tr key={row.item}>
                        {pageCell(row.source)}
                        <td className="small">
                          {row.kind === 'page' ? t('analytics.targetPage') : t('analytics.targetAttachment')}: {row.targetLabel ?? `#${row.targetId}`}
                        </td>
                        <td>
                          <Badge color={row.reason === 'missing' ? 'red' : 'yellow'}>{t(`analytics.reasons.${row.reason}`)}</Badge>
                        </td>
                        <td className="actions-cell">
                          <Link className="btn btn-sm btn-ghost" to={`/s/${encodeURIComponent(row.source.spaceKey)}/edit/${row.source.id}`}>
                            {t('common.edit')}
                          </Link>
                          {dismissButton('link', row.item)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState icon={Link2Off} title={t('analytics.emptyLinks')} compact />
            ))}
        </>
      )}
    </div>
  );
}

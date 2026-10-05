import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Download, GitCompare, ScrollText } from 'lucide-react';
import { api } from '../../api/client';
import type { ChangelogEntry } from '../../api/types';
import { useI18n } from '../../i18n';
import { Avatar, Badge, Checkbox, EmptyState, Field, Input, Loading, PageHeader, Time, cx } from '../../components/ui';
import { DayGroups, activityIcon } from '../../components/ActivityList';
import { useSpaceContext } from './SpaceLayout';

const KIND: Record<string, string> = { create: 'create', edit: 'edit', rename: 'edit', restore: 'restore', task: 'edit', import: 'create', copy: 'create' };

export default function SpaceChangelog() {
  const { space } = useSpaceContext();
  const { t } = useI18n();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minor, setMinor] = useState(false);
  const query = { from: from ? `${from}T00:00:00.000Z` : undefined, to: to ? `${to}T23:59:59.999Z` : undefined, minor };
  const { data, isLoading } = useQuery({
    queryKey: ['changelog', space.key, query],
    queryFn: () => api.get<ChangelogEntry[]>(`/api/v1/spaces/${encodeURIComponent(space.key)}/changelog`, { ...query, limit: 500 }),
  });
  const base = `/s/${encodeURIComponent(space.key)}`;
  const params = new URLSearchParams({ format: 'md' });
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (minor) params.set('minor', 'true');

  return (
    <div className="container">
      <PageHeader
        icon={ScrollText}
        title={t('changelog.title')}
        subtitle={t('changelog.subtitle')}
        actions={
          <a className="btn" href={`/api/v1/spaces/${encodeURIComponent(space.key)}/changelog?${params.toString()}`}>
            <Download size={16} /> {t('changelog.exportMd')}
          </a>
        }
      />
      <div className="row row-wrap gap-lg mb-2" style={{ alignItems: 'flex-end' }}>
        <Field label={t('changelog.from')}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t('changelog.to')}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div style={{ paddingBottom: '1.5rem' }}>
          <Checkbox checked={minor} onChange={setMinor} label={t('changelog.includeMinor')} />
        </div>
      </div>
      {isLoading && <Loading />}
      {data && data.length === 0 && <EmptyState icon={ScrollText} title={t('changelog.empty')} />}
      {data && (
        <DayGroups
          items={data}
          render={(e) => {
            const kind = e.kind === 'revision' ? KIND[e.changeType] ?? 'edit' : activityIcon(e.changeType).kind;
            const Icon = activityIcon(e.kind === 'revision' ? (e.changeType === 'create' ? 'page.created' : 'page.updated') : e.changeType).icon;
            return (
              <div key={e.id} className="timeline-item">
                <span className={cx('timeline-icon', kind)}>
                  <Icon size={15} />
                </span>
                <div className="timeline-body">
                  <div className="timeline-title row row-wrap gap-sm">
                    {e.page.url && !e.page.deleted ? <Link to={e.page.url}>{e.page.title}</Link> : <span className="muted">{e.page.title}</span>}
                    <Badge>{e.label}</Badge>
                    {e.version && <span className="small muted">v{e.version}</span>}
                    {e.minor && <Badge color="gray">{t('history.minor')}</Badge>}
                  </div>
                  <div className="timeline-meta">
                    <Avatar user={e.actor} size={16} />
                    <span>{e.actor?.displayName ?? 'System'}</span>
                    <Time value={e.createdAt} mode="datetime" />
                    {e.kind === 'revision' && e.version && e.version > 1 && !e.page.deleted && (
                      <Link to={`${base}/diff/${e.page.id}?from=${e.version - 1}&to=${e.version}`} className="row gap-xs">
                        <GitCompare size={12} /> {t('changelog.showDiff')}
                      </Link>
                    )}
                  </div>
                  {e.changeNote && <div className="timeline-note">{e.changeNote}</div>}
                </div>
              </div>
            );
          }}
        />
      )}
    </div>
  );
}

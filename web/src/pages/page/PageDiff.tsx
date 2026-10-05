import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, GitCompare } from 'lucide-react';
import { api } from '../../api/client';
import type { DiffResult } from '../../api/types';
import { usePage } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { Alert, Avatar, Badge, ErrorView, Loading, PageHeader, Tabs, Time } from '../../components/ui';
import { HtmlView } from '../../editor/HtmlView';

function LineDiff({ lines }: { lines: DiffResult['lines'] }) {
  const { t } = useI18n();
  // Lange unveränderte Abschnitte einklappen
  const blocks: ({ type: 'gap'; count: number } | DiffResult['lines'][number])[] = [];
  const context = 3;
  const changed = lines.map((l) => l.type !== 'equal');
  for (let i = 0; i < lines.length; i++) {
    const near = changed.slice(Math.max(0, i - context), i + context + 1).some(Boolean);
    if (lines[i].type !== 'equal' || near) blocks.push(lines[i]);
    else {
      const last = blocks[blocks.length - 1];
      if (last && 'count' in last) last.count++;
      else blocks.push({ type: 'gap', count: 1 });
    }
  }
  return (
    <div className="line-diff">
      {blocks.map((b, i) =>
        'count' in b ? (
          <div key={i} className="line-diff-gap">
            {t('history.unchangedLines', { count: b.count })}
          </div>
        ) : (
          <div key={i} className={`line-diff-row ${b.type}`}>
            <span className="sign">{b.type === 'add' ? '+' : b.type === 'del' ? '−' : ' '}</span>
            <span className="text">{b.text || ' '}</span>
          </div>
        ),
      )}
    </div>
  );
}

export default function PageDiff() {
  const { pageId } = useParams();
  const id = Number(pageId);
  const [params] = useSearchParams();
  const from = Number(params.get('from'));
  const to = Number(params.get('to'));
  const { t } = useI18n();
  const { data: page } = usePage(id, { render: false });
  const [tab, setTab] = useState<'visual' | 'source'>('visual');
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['diff', id, from, to],
    queryFn: () => api.get<DiffResult>(`/api/v1/pages/${id}/diff`, { from, to }),
    enabled: !!from && !!to,
  });

  if (isLoading || !page) return <Loading />;
  if (error || !data) return <div className="container"><ErrorView error={error} onRetry={() => void refetch()} /></div>;
  const base = `/s/${encodeURIComponent(page.space.key)}`;
  const noChanges = data.stats.added === 0 && data.stats.removed === 0 && !data.titleChanged;

  return (
    <div className="container container-wide">
      <div className="mb-1">
        <Link to={`${base}/history/${id}`} className="small row gap-xs">
          <ArrowLeft size={14} /> {t('history.title')} · {page.title}
        </Link>
      </div>
      <PageHeader icon={GitCompare} title={t('history.diffTitle', { from: data.from.version, to: data.to.version })} />
      <div className="row row-wrap gap-lg mb-2">
        {[data.from, data.to].map((r, i) => (
          <div key={r.version} className="row" style={{ minWidth: 0 }}>
            {i === 1 && <ArrowRight size={16} className="muted" />}
            <div className="card" style={{ padding: '0.5rem 0.75rem' }}>
              <div className="row">
                <strong>v{r.version}</strong>
                <Avatar user={r.author} size={20} />
                <span className="small">{r.author?.displayName}</span>
                <span className="small muted">
                  <Time value={r.createdAt} mode="datetime" />
                </span>
              </div>
              {r.changeNote && <div className="small soft">{r.changeNote}</div>}
            </div>
          </div>
        ))}
        <span className="spacer" />
        <Badge color="green">{t('history.added', { n: data.stats.added })}</Badge>
        <Badge color="red">{t('history.removed', { n: data.stats.removed })}</Badge>
      </div>
      {data.titleChanged && (
        <div className="mb-2">
          <Alert variant="info">{t('history.titleChanged', { from: data.from.title, to: data.to.title })}</Alert>
        </div>
      )}
      {noChanges && <Alert variant="info">{t('history.noChanges')}</Alert>}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'visual', label: t('history.visual'), hidden: !data.html },
          { value: 'source', label: t('history.source') },
        ]}
      />
      {tab === 'visual' && data.html ? <HtmlView html={data.html} /> : <LineDiff lines={data.lines} />}
    </div>
  );
}

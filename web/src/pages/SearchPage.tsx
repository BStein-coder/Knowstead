import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { FileIcon, FileText, HelpCircle, KanbanSquare, MessageSquare, Search } from 'lucide-react';
import { api } from '../api/client';
import type { SearchResult } from '../api/types';
import { useI18n } from '../i18n';
import { Avatar, Button, EmptyState, Input, Loading, Select, Time, cx } from '../components/ui';

export default function SearchPage() {
  const { t, fmt } = useI18n();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const space = params.get('space') ?? '';
  const label = params.get('label') ?? '';
  const type = params.get('type') ?? '';
  const sort = params.get('sort') ?? 'relevance';
  const [input, setInput] = useState(q);
  const [showTips, setShowTips] = useState(false);
  useEffect(() => setInput(q), [q]);

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next);
  };

  const enabled = !!(q.trim() || label || space);
  const query = useInfiniteQuery({
    queryKey: ['search', q, space, label, type, sort],
    queryFn: ({ pageParam }) => api.get<SearchResult>('/api/v1/search', { q, space, label, type, sort, limit: 20, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.offset + last.limit < last.total ? last.offset + last.limit : undefined),
    enabled,
  });
  const first = query.data?.pages[0];
  const hits = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="container container-wide">
      <h1 className="sr-only">{t('search.title')}</h1>
      <form
        className="search-box"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q: input });
        }}
      >
        <Input icon={Search} value={input} autoFocus onChange={(e) => setInput(e.target.value)} placeholder={t('search.placeholder')} aria-label={t('search.title')} />
        <Button type="submit" variant="primary" size="lg">
          {t('common.search')}
        </Button>
        <Button type="button" size="lg" variant="ghost" icon={HelpCircle} aria-label={t('common.help')} aria-expanded={showTips} onClick={() => setShowTips((s) => !s)} />
      </form>
      {showTips && <p className="small muted mb-2">{t('search.tips')}</p>}

      <div className="search-layout">
        <div>
          {enabled && first && (
            <div className="row mb-1">
              <span className="muted small">{t('search.results', { n: first.total })}</span>
              <span className="spacer" />
              <Select style={{ width: 200 }} className="input-sm" aria-label={t('search.sort')} value={sort} onChange={(e) => set({ sort: e.target.value === 'relevance' ? '' : e.target.value })}>
                <option value="relevance">{t('search.sortRelevance')}</option>
                <option value="updated">{t('search.sortUpdated')}</option>
                <option value="title">{t('search.sortTitle')}</option>
              </Select>
            </div>
          )}
          {!enabled && <EmptyState icon={Search} title={t('search.title')} text={t('search.tips')} />}
          {query.isLoading && enabled && <Loading />}
          {enabled && first && first.total === 0 && <EmptyState icon={Search} title={t('search.noResults', { q })} text={t('search.tips')} />}
          {hits.map((h) => (
            <div key={h.id} className="search-hit">
              <Link to={h.url} className="search-hit-title">
                <span>{h.icon ?? <FileText size={16} className="muted" />}</span>
                {h.title}
              </Link>
              <div className="search-hit-path">
                {h.spaceName}
                {h.path.length ? ` › ${h.path.join(' › ')}` : ''} · {h.updatedBy?.displayName} · <Time value={h.updatedAt} />
              </div>
              <div className="search-hit-snippet" dangerouslySetInnerHTML={{ __html: h.snippet }} />
              {h.labels.length > 0 && (
                <div className="row gap-xs mt-1">
                  {h.labels.map((l) => (
                    <button key={l} type="button" className="chip" style={{ border: 'none', cursor: 'pointer' }} onClick={() => set({ label: l })}>
                      {l}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {query.hasNextPage && (
            <div className="center mt-2">
              <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                {t('common.showMore')}
              </Button>
            </div>
          )}
          {first && first.tasks.length > 0 && (
            <div className="mt-3">
              <div className="facet-title">{t('search.tasks')}</div>
              <div className="list">
                {first.tasks.map((task) => (
                  <div key={task.id} className="list-item">
                    <span className="list-item-icon">
                      <KanbanSquare size={15} />
                    </span>
                    <span className="list-item-body">
                      <Link className="list-item-title" to={task.url}>
                        {task.title}
                      </Link>
                      <div className="list-item-meta row gap-xs">
                        <span>
                          {task.spaceName} · {task.boardName}
                        </span>
                        {task.dueDate && (
                          <span className={task.overdue ? 'danger-text' : undefined}>
                            {t('tasks.due')}: {fmt.date(task.dueDate)}
                          </span>
                        )}
                        {task.status === 'done' && <span className="badge badge-green">{t('tasks.statuses.done')}</span>}
                        {task.assignee && <Avatar user={task.assignee} size={18} title={task.assignee.displayName} />}
                      </div>
                      {task.chat && (
                        <div className="search-hit-snippet search-chat-hit">
                          <MessageSquare size={13} aria-hidden="true" />
                          <span className="muted">
                            {t('search.inChat')}
                            {task.chat.author ? ` · ${task.chat.author.displayName}` : ''}:
                          </span>{' '}
                          <span dangerouslySetInnerHTML={{ __html: task.chat.snippet }} />
                        </div>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {first && first.attachments.length > 0 && (
            <div className="mt-3">
              <div className="facet-title">{t('search.attachments')}</div>
              <div className="list">
                {first.attachments.map((a) => (
                  <div key={a.id} className="list-item attachment-hit">
                    <span className="list-item-icon">
                      <FileIcon size={15} />
                    </span>
                    <span className="list-item-body">
                      <a className="list-item-title" href={`/api/v1/attachments/${a.id}/raw`} target="_blank" rel="noopener noreferrer">
                        {a.filename}
                      </a>
                      {a.snippet && <div className="search-hit-snippet" dangerouslySetInnerHTML={{ __html: a.snippet }} />}
                      <div className="list-item-meta">
                        <Link to={a.page.url}>{a.page.title}</Link> · {fmt.bytes(a.size)}
                        {a.snippet && <span className="badge badge-blue attachment-hit-badge">{t('search.inContent')}</span>}
                      </div>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <aside>
          {first && (
            <>
              {(first.facets.spaces.length > 0 || space) && (
                <div className="facet">
                  <div className="facet-title">{t('search.filterSpace')}</div>
                  <button type="button" className={cx('facet-item', !space && 'active')} onClick={() => set({ space: '' })}>
                    {t('search.anySpace')}
                  </button>
                  {first.facets.spaces.map((s) => (
                    <button key={s.key} type="button" className={cx('facet-item', space === s.key && 'active')} onClick={() => set({ space: s.key })}>
                      <span className="truncate">
                        {s.icon} {s.name}
                      </span>
                      <span className="facet-count">{s.count}</span>
                    </button>
                  ))}
                </div>
              )}
              {(first.facets.labels.length > 0 || label) && (
                <div className="facet">
                  <div className="facet-title">{t('search.filterLabel')}</div>
                  {label && (
                    <button type="button" className="facet-item active" onClick={() => set({ label: '' })}>
                      {label} ✕
                    </button>
                  )}
                  {first.facets.labels
                    .filter((l) => l.name !== label)
                    .map((l) => (
                      <button key={l.name} type="button" className="facet-item" onClick={() => set({ label: l.name })}>
                        <span className="truncate">{l.name}</span>
                        <span className="facet-count">{l.count}</span>
                      </button>
                    ))}
                </div>
              )}
              <div className="facet">
                <div className="facet-title">{t('search.filterType')}</div>
                {['', 'richtext', 'markdown', 'code'].map((ty) => (
                  <button key={ty || 'all'} type="button" className={cx('facet-item', type === ty && 'active')} onClick={() => set({ type: ty })}>
                    {ty ? t(`page.pageTypes.${ty}`) : t('search.anyType')}
                    <span className="facet-count">{ty ? first.facets.types.find((x) => x.type === ty)?.count ?? '' : ''}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

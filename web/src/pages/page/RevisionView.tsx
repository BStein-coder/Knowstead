import { Link, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, History, RotateCcw } from 'lucide-react';
import { api } from '../../api/client';
import type { RevisionDetail } from '../../api/types';
import { usePage } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Button, ErrorView, Loading } from '../../components/ui';
import { DocumentView } from '../../editor/DocumentView';
import { HtmlView } from '../../editor/HtmlView';
import { CodeView } from './CodeView';

export default function RevisionView() {
  const { pageId, version } = useParams();
  const id = Number(pageId);
  const v = Number(version);
  const { t, fmt } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const { data: page } = usePage(id, { render: false });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['revision', id, v],
    queryFn: () => api.get<RevisionDetail>(`/api/v1/pages/${id}/revisions/${v}`),
  });
  if (isLoading || !page) return <Loading />;
  if (error || !data) return <div className="container"><ErrorView error={error} onRetry={() => void refetch()} /></div>;
  const base = `/s/${encodeURIComponent(page.space.key)}`;
  return (
    <div className="page-view">
      <div className="banner banner-info">
        <History size={15} />
        <span>
          {t('page.oldVersionBanner', { version: data.version, date: fmt.dateTime(data.createdAt) })} {data.author && `· ${data.author.displayName}`}
          {data.changeNote && ` · „${data.changeNote}“`}
        </span>
        <span className="spacer" />
        <Link className="btn btn-sm" to={`${base}/history/${id}`}>
          <ArrowLeft size={14} /> {t('history.title')}
        </Link>
        <Link className="btn btn-sm" to={page.isHome ? base : page.url}>
          {t('page.toCurrent')}
        </Link>
        {page.access.edit && !data.isCurrent && (
          <Button
            size="sm"
            variant="primary"
            icon={RotateCcw}
            onClick={async () => {
              if (!(await dialogs.confirm({ title: t('history.restore'), message: t('history.restoreConfirm', { n: data.version }) }))) return;
              try {
                await api.post(`/api/v1/pages/${id}/revisions/${data.version}/restore`);
                toast.success(t('history.restored', { n: data.version }));
                void qc.invalidateQueries({ queryKey: ['page', id] });
                void qc.invalidateQueries({ queryKey: ['revisions', id] });
              } catch (err) {
                toast.error(err);
              }
            }}
          >
            {t('history.restore')}
          </Button>
        )}
      </div>
      <div className="page-layout no-toc">
        <article>
          <header className="page-head">
            <h1 className="page-title">{data.title}</h1>
          </header>
          {data.contentType === 'richtext' ? (
            <DocumentView html={data.content} pageId={id} spaceKey={page.space.key} />
          ) : data.contentType === 'markdown' ? (
            <HtmlView html={data.html} />
          ) : (
            <CodeView code={data.content} language={data.language} />
          )}
        </article>
      </div>
    </div>
  );
}

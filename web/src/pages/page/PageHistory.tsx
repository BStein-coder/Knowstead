import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, GitCompare, History, RotateCcw } from 'lucide-react';
import { api } from '../../api/client';
import { usePage, useRevisions } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Avatar, Badge, Button, ErrorView, IconButton, Loading, PageHeader, Time, cx } from '../../components/ui';

export default function PageHistory() {
  const { pageId } = useParams();
  const id = Number(pageId);
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: page } = usePage(id, { render: false });
  const { data, isLoading, error, refetch } = useRevisions(id, 500);
  const [selected, setSelected] = useState<number[]>([]);

  if (isLoading || !page) return <Loading />;
  if (error) return <div className="container"><ErrorView error={error} onRetry={() => void refetch()} /></div>;
  const base = `/s/${encodeURIComponent(page.space.key)}`;
  const revisions = data?.items ?? [];

  const toggle = (v: number) =>
    setSelected((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev.slice(-1), v]));

  const compare = () => {
    const [a, b] = [...selected].sort((x, y) => x - y);
    navigate(`${base}/diff/${id}?from=${a}&to=${b}`);
  };

  const restore = async (version: number) => {
    const ok = await dialogs.confirm({ title: t('history.restore'), message: t('history.restoreConfirm', { n: version }), confirmLabel: t('history.restore') });
    if (!ok) return;
    try {
      await api.post(`/api/v1/pages/${id}/revisions/${version}/restore`);
      toast.success(t('history.restored', { n: version }));
      await qc.invalidateQueries({ queryKey: ['page', id] });
      await refetch();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="container">
      <div className="mb-1">
        <Link to={page.isHome ? base : page.url} className="small row gap-xs">
          <ArrowLeft size={14} /> {page.title}
        </Link>
      </div>
      <PageHeader
        icon={History}
        title={t('history.title')}
        subtitle={t('history.subtitle')}
        actions={
          <Button icon={GitCompare} variant="primary" disabled={selected.length !== 2} onClick={compare}>
            {t('history.compareSelected')}
          </Button>
        }
      />
      <div className="revision-list">
        {revisions.map((r, i) => {
          const prev = revisions[i + 1];
          return (
            <div key={r.id} className={cx('revision-row')}>
              <input type="checkbox" checked={selected.includes(r.version)} onChange={() => toggle(r.version)} aria-label={`Version ${r.version}`} />
              <div className="row gap-xs">
                <strong>v{r.version}</strong>
                {r.isCurrent && <Badge color="green">{t('history.current')}</Badge>}
              </div>
              <div style={{ minWidth: 0 }}>
                <div className={cx('revision-note', !r.changeNote && 'empty')}>{r.changeNote || t('history.noNote')}</div>
                <div className="tiny muted row gap-xs">
                  <Badge>{t(`history.changeTypes.${r.changeType}`)}</Badge>
                  {r.minor && <Badge color="gray">{t('history.minor')}</Badge>}
                  {prev && r.title !== prev.title && <span>„{r.title}“</span>}
                </div>
              </div>
              <div className="row revision-author small">
                <Avatar user={r.author} size={22} />
                <span className="truncate">{r.author?.displayName ?? '–'}</span>
                <span className="muted nowrap">
                  <Time value={r.createdAt} mode="datetime" />
                </span>
              </div>
              <div className="row gap-xs">
                <IconButton icon={Eye} label={t('history.view')} onClick={() => navigate(`${base}/history/${id}/v/${r.version}`)} />
                {prev && <IconButton icon={GitCompare} label={t('history.compare')} onClick={() => navigate(`${base}/diff/${id}?from=${prev.version}&to=${r.version}`)} />}
                {page.access.edit && !r.isCurrent && <IconButton icon={RotateCcw} label={t('history.restore')} onClick={() => void restore(r.version)} />}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

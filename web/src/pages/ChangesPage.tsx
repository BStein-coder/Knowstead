import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitCompare, History, RotateCcw, Undo2 } from 'lucide-react';
import { api } from '../api/client';
import type { ChangeEntry } from '../api/types';
import { useSpaces } from '../api/hooks';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';
import { useDialogs } from '../lib/dialogs';
import { Avatar, Badge, Button, EmptyState, ErrorView, Loading, PageHeader, Select, Time } from '../components/ui';

const LIMITS = [25, 50, 100, 200];

/**
 * „Letzte Änderungen“: die jüngsten Bearbeitungen aller sichtbaren Bereiche,
 * jede einzeln zurücknehmbar (es entsteht dabei eine neue Version).
 */
export default function ChangesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const { data: spaces } = useSpaces({});
  const [space, setSpace] = useState('');
  const [limit, setLimit] = useState(50);

  const { data, isLoading, error } = useQuery({
    queryKey: ['changes', space, limit],
    queryFn: () => api.get<{ items: ChangeEntry[] }>('/api/v1/changes', { space: space || undefined, limit }),
  });

  const undo = useMutation({
    mutationFn: (id: number) => api.post(`/api/v1/changes/${id}/undo`, {}),
    onSuccess: () => {
      toast.success(t('changes.undone'));
      void qc.invalidateQueries({ queryKey: ['changes'] });
      void qc.invalidateQueries({ queryKey: ['page'] });
    },
    onError: (err) => toast.error(err),
  });

  const items = data?.items ?? [];

  return (
    <div className="container">
      <PageHeader
        icon={History}
        title={t('changes.title')}
        subtitle={t('changes.subtitle', { n: limit })}
        actions={
          <div className="row gap-sm">
            <Select value={space} onChange={(e) => setSpace(e.target.value)} aria-label={t('changes.allSpaces')}>
              <option value="">{t('changes.allSpaces')}</option>
              {(spaces ?? []).map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select value={String(limit)} onChange={(e) => setLimit(Number(e.target.value))} aria-label={t('changes.count')}>
              {LIMITS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
        }
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorView error={error} />
      ) : !items.length ? (
        <EmptyState icon={History} title={t('changes.empty')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
          <thead>
            <tr>
              <th>{t('common.title')}</th>
              <th>{t('editor.changeNote')}</th>
              <th>{t('common.author')}</th>
              <th>{t('common.updated')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={c.url} className="row gap-xs">
                    <span>{c.pageIcon ?? '📄'}</span>
                    <span className="truncate">{c.pageTitle}</span>
                  </Link>
                  <div className="tiny faint">
                    {c.spaceName} · {t('review.version', { n: c.version })}
                    {c.deleted && ` · ${t('changes.deleted')}`}
                  </div>
                </td>
                <td className="small">
                  {c.changeNote || <span className="faint">—</span>}
                  {c.minor && (
                    <Badge color="gray" className="ml-xs">
                      {t('history.minor')}
                    </Badge>
                  )}
                </td>
                <td>
                  <div className="row gap-xs small">
                    {c.author && <Avatar user={c.author} size={20} />}
                    <span className="truncate">{c.author?.displayName ?? '—'}</span>
                  </div>
                </td>
                <td className="small muted">
                  <Time value={c.createdAt} />
                </td>
                <td style={{ width: 1, whiteSpace: 'nowrap' }}>
                  <div className="row gap-xs">
                    {c.previousVersion && (
                      <Link
                        className="btn btn-ghost btn-sm"
                        to={`/s/${encodeURIComponent(c.spaceKey)}/diff/${c.pageId}?from=${c.previousVersion}&to=${c.version}`}
                        title={t('changes.compare')}
                      >
                        <GitCompare size={14} />
                      </Link>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={c.isCurrent ? Undo2 : RotateCcw}
                      disabled={!c.canRestore || !c.previousVersion}
                      loading={undo.isPending && undo.variables === c.id}
                      title={t('changes.undo')}
                      onClick={async () => {
                        const ok = await dialogs.confirm({
                          title: t('changes.undoTitle'),
                          message: t('changes.undoText', { title: c.pageTitle }),
                          confirmLabel: t('changes.undo'),
                        });
                        if (ok) undo.mutate(c.id);
                      }}
                    >
                      {t('changes.undo')}
                    </Button>
                  </div>
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

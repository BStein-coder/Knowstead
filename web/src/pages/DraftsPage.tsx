import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FilePen, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { PageSummary } from '../api/types';
import { useI18n } from '../i18n';
import { useDialogs } from '../lib/dialogs';
import { useToast } from '../lib/toast';
import { Badge, Button, EmptyState, Loading, PageHeader, Time } from '../components/ui';

export default function DraftsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['drafts'], queryFn: () => api.get<PageSummary[]>('/api/v1/me/drafts') });
  return (
    <div className="container container-narrow">
      <PageHeader icon={FilePen} title={t('drafts.title')} subtitle={t('drafts.subtitle')} />
      {isLoading && <Loading />}
      {data && data.length === 0 && <EmptyState icon={FilePen} title={t('drafts.empty')} />}
      {data && data.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {data.map((d) => (
                <tr key={`${d.kind}-${d.id}`}>
                  <td>
                    <Link to={`/s/${encodeURIComponent(d.spaceKey)}/edit/${d.id}`} className="strong">
                      {d.icon} {d.title || '(ohne Titel)'}
                    </Link>
                    <div className="small muted">
                      {d.spaceName} · <Time value={d.draftUpdatedAt} />
                    </div>
                  </td>
                  <td>
                    <Badge color={d.kind === 'new' ? 'green' : 'blue'}>{d.kind === 'new' ? t('drafts.newPage') : t('drafts.editOf')}</Badge>
                  </td>
                  <td className="actions-cell">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      onClick={async () => {
                        if (!(await dialogs.confirm({ title: t('drafts.discard'), message: t('editor.discardConfirm'), danger: true, confirmLabel: t('drafts.discard') }))) return;
                        try {
                          await api.del(`/api/v1/pages/${d.id}/draft`);
                          await refetch();
                          void qc.invalidateQueries({ queryKey: ['page', d.id] });
                        } catch (err) {
                          toast.error(err);
                        }
                      }}
                    >
                      {t('drafts.discard')}
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

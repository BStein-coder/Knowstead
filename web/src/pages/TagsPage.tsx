import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Search, Tag, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import { useSpaces } from '../api/hooks';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';
import { useDialogs } from '../lib/dialogs';
import { EmptyState, IconButton, Input, Loading, PageHeader, Select, Tabs, cx } from '../components/ui';

interface LabelCount {
  name: string;
  count: number;
}

/**
 * Stichwörter im Überblick: Wolke oder Liste, Filter nach Bereich, Sprung in
 * die Suche – für Administratoren zusätzlich Umbenennen/Zusammenführen/Löschen.
 */
export default function TagsPage() {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const { isAdmin } = useAuth();
  const { data: spaces } = useSpaces({});
  const [space, setSpace] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<'cloud' | 'list'>('cloud');

  const { data, isLoading } = useQuery({
    queryKey: ['labels', 'overview', space],
    queryFn: () => api.get<LabelCount[]>('/api/v1/labels', { space: space || undefined }),
  });

  const labels = useMemo(() => {
    const lower = q.trim().toLowerCase();
    return (data ?? []).filter((l) => !lower || l.name.includes(lower));
  }, [data, q]);
  const max = Math.max(1, ...labels.map((l) => l.count));

  const searchUrl = (name: string) => `/search?q=${encodeURIComponent(`label:${name}${space ? ` space:${space}` : ''}`)}`;

  const rename = async (label: LabelCount) => {
    const next = await dialogs.prompt({ title: t('tags.renameTitle'), label: t('tags.renameLabel', { name: label.name }), defaultValue: label.name });
    if (!next || next.trim() === label.name) return;
    try {
      const res = await api.post<{ pages: number; merged: boolean }>('/api/v1/labels/rename', { from: label.name, to: next });
      toast.success(res.merged ? t('tags.merged', { n: res.pages }) : t('tags.renamed', { n: res.pages }));
      void qc.invalidateQueries({ queryKey: ['labels'] });
    } catch (err) {
      toast.error(err);
    }
  };

  const remove = async (label: LabelCount) => {
    const ok = await dialogs.confirm({ title: t('tags.deleteTitle'), message: t('tags.deleteText', { name: label.name, n: label.count }), danger: true, confirmLabel: t('common.delete') });
    if (!ok) return;
    try {
      await api.del(`/api/v1/labels/${encodeURIComponent(label.name)}`);
      void qc.invalidateQueries({ queryKey: ['labels'] });
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="container">
      <PageHeader
        icon={Tag}
        title={t('tags.title')}
        subtitle={t('tags.subtitle')}
        actions={
          <Select value={space} onChange={(e) => setSpace(e.target.value)} aria-label={t('changes.allSpaces')}>
            <option value="">{t('changes.allSpaces')}</option>
            {(spaces ?? []).map((sp) => (
              <option key={sp.key} value={sp.key}>
                {sp.name}
              </option>
            ))}
          </Select>
        }
      />
      <div className="row gap-sm mb-2">
        <div style={{ width: 320, maxWidth: '100%' }}>
          <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('tags.filter')} />
        </div>
        <span className="spacer" />
        <Tabs
          value={view}
          onChange={setView}
          items={[
            { value: 'cloud', label: t('tags.cloud') },
            { value: 'list', label: t('tags.list') },
          ]}
        />
      </div>
      {isLoading ? (
        <Loading />
      ) : !labels.length ? (
        <EmptyState icon={Tag} title={t('tags.empty')} text={t('tags.emptyHint')} />
      ) : view === 'cloud' ? (
        <div className="tag-cloud">
          {labels.map((l) => {
            const weight = l.count / max;
            return (
              <Link key={l.name} to={searchUrl(l.name)} className={cx('tag-cloud-item', weight > 0.66 && 'strong')} style={{ fontSize: `${0.85 + weight * 0.9}rem` }}>
                #{l.name}
                <span className="tag-cloud-count">{l.count}</span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('tags.tag')}</th>
                <th>{t('tags.pages')}</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {labels.map((l) => (
                <tr key={l.name}>
                  <td>
                    <Link to={searchUrl(l.name)} className="chip">
                      #{l.name}
                    </Link>
                  </td>
                  <td className="small muted">{l.count}</td>
                  {isAdmin && (
                    <td style={{ width: 1, whiteSpace: 'nowrap' }}>
                      <IconButton icon={Pencil} label={t('tags.rename')} onClick={() => void rename(l)} />
                      <IconButton icon={Trash2} label={t('common.delete')} onClick={() => void remove(l)} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

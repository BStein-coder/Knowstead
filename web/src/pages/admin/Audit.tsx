import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Search, Shield } from 'lucide-react';
import { api } from '../../api/client';
import type { Activity, Paged } from '../../api/types';
import { useCatalog } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { Badge, Button, Input, Loading, PageHeader, Select, Time } from '../../components/ui';

const CATEGORY_COLORS: Record<string, string> = { security: 'red', admin: 'purple', content: 'blue', system: 'gray' };

export function AdminAudit() {
  const { t } = useI18n();
  const catalog = useCatalog();
  const [category, setCategory] = useState('');
  const [type, setType] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const params = { category, type, q, from: from ? `${from}T00:00:00.000Z` : '', to: to ? `${to}T23:59:59.999Z` : '' };
  const { data, isLoading } = useQuery({
    queryKey: ['audit', params, offset],
    queryFn: () => api.get<Paged<Activity>>('/api/v1/admin/audit', { ...params, limit: 50, offset }),
  });
  const csv = `/api/v1/admin/audit.csv?${new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <>
      <PageHeader
        icon={Shield}
        title={t('admin.nav.audit')}
        subtitle={t('adminAudit.subtitle')}
        actions={
          <a className="btn" href={csv}>
            <Download size={16} /> {t('adminAudit.csv')}
          </a>
        }
      />
      <div className="row row-wrap mb-2">
        <Select style={{ width: 170 }} aria-label={t('adminAudit.category')} value={category} onChange={(e) => { setCategory(e.target.value); setOffset(0); }}>
          <option value="">{t('adminAudit.allCategories')}</option>
          <option value="security">{t('adminAudit.cat.security')}</option>
          <option value="admin">{t('adminAudit.cat.admin')}</option>
          <option value="content">{t('adminAudit.cat.content')}</option>
          <option value="system">{t('adminAudit.cat.system')}</option>
        </Select>
        <Select style={{ width: 260 }} aria-label={t('adminAudit.eventType')} value={type} onChange={(e) => { setType(e.target.value); setOffset(0); }}>
          <option value="">{t('adminAudit.allEvents')}</option>
          {(catalog.data?.events ?? []).filter((e) => !category || e.category === category).map((e) => (
            <option key={e.type} value={e.type}>
              {e.label} ({e.type})
            </option>
          ))}
        </Select>
        <div style={{ width: 240 }}>
          <Input icon={Search} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} placeholder={t('adminAudit.searchPlaceholder')} />
        </div>
        <Input type="date" style={{ width: 160 }} aria-label={t('adminAudit.from')} value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" style={{ width: 160 }} aria-label={t('adminAudit.to')} value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {isLoading ? (
        <Loading />
      ) : (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('adminAudit.time')}</th>
                  <th>{t('adminAudit.event')}</th>
                  <th>{t('adminAudit.actor')}</th>
                  <th>{t('adminAudit.target')}</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((e) => (
                  <Fragment key={e.id}>
                    <tr className="clickable" onClick={() => setOpen(open === e.id ? null : e.id)}>
                      <td className="small nowrap">
                        <Time value={e.createdAt} mode="datetime" />
                      </td>
                      <td>
                        <Badge color={CATEGORY_COLORS[e.category] ?? 'gray'}>{t(`adminAudit.cat.${e.category}`)}</Badge> {e.label}
                      </td>
                      <td className="small">{e.actorName ?? e.actor?.displayName ?? t('adminAudit.cat.system')}</td>
                      <td className="small">
                        {e.target?.label ?? '–'} {e.space && <span className="muted">· {e.space.key}</span>}
                      </td>
                      <td className="small mono muted">{e.ip ?? ''}</td>
                    </tr>
                    {open === e.id && (
                      <tr>
                        <td colSpan={5}>
                          <div className="small muted mb-1">
                            {e.type} · {e.userAgent}
                          </div>
                          <pre className="code-block">{JSON.stringify(e.data, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row mt-2">
            <span className="small muted">
              {data ? t('adminAudit.range', { from: offset + 1, to: Math.min(offset + 50, data.total), total: data.total }) : ''}
            </span>
            <span className="spacer" />
            <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>
              {t('common.back')}
            </Button>
            <Button size="sm" disabled={!data || offset + 50 >= data.total} onClick={() => setOffset(offset + 50)}>
              {t('common.next')}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

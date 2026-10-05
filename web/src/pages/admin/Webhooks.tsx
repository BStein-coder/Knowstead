import { Fragment, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, RefreshCw, RotateCw, Send, Trash2, Webhook as WebhookIcon, X } from 'lucide-react';
import { api } from '../../api/client';
import type { Webhook, WebhookDelivery } from '../../api/types';
import { useCatalog } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Alert, Badge, Button, Checkbox, CopyField, EmptyState, Field, IconButton, Input, Loading, Modal, PageHeader, Switch, Time } from '../../components/ui';
import { SpaceSelect } from '../../components/Pickers';

export function AdminWebhooks() {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['webhooks'], queryFn: () => api.get<Webhook[]>('/api/v1/admin/webhooks') });
  const [editing, setEditing] = useState<Webhook | 'new' | null>(null);
  const [deliveries, setDeliveries] = useState<Webhook | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        icon={WebhookIcon}
        title={t('admin.nav.webhooks')}
        subtitle={t('adminWebhooks.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            {t('adminWebhooks.create')}
          </Button>
        }
      />
      {secret && (
        <div className="mb-2">
          <Alert variant="success" title={t('adminWebhooks.secretTitle')}>
            <CopyField value={secret} onCopied={() => toast.success(t('common.copied'))} />
            <div className="small mt-1">
              {t('adminWebhooks.verification')} <code>X-Knowstead-Signature = sha256=HMAC_SHA256(secret, X-Knowstead-Timestamp + "." + body)</code>
            </div>
          </Alert>
        </div>
      )}
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={WebhookIcon} title={t('adminWebhooks.empty')} text={t('adminWebhooks.emptyText')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('adminWebhooks.events')}</th>
                <th>{t('adminWebhooks.lastDelivery')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((w) => (
                <tr key={w.id}>
                  <td>
                    <div className="strong row gap-xs">
                      <span className={`status-dot ${w.active ? (w.failureCount > 0 ? 'err' : 'ok') : ''}`} />
                      {w.name} {!w.active && <Badge>{t('common.inactive')}</Badge>}
                    </div>
                    <div className="small muted mono truncate" style={{ maxWidth: 380 }}>
                      {w.url}
                    </div>
                    {w.spaceKey && <div className="small">{t('adminWebhooks.onlySpace', { key: w.spaceKey })}</div>}
                  </td>
                  <td>
                    <div className="row row-wrap gap-xs">
                      {w.events.slice(0, 4).map((e) => (
                        <Badge key={e} color="accent">
                          {e}
                        </Badge>
                      ))}
                      {w.events.length > 4 && <Badge>+{w.events.length - 4}</Badge>}
                    </div>
                  </td>
                  <td className="small">
                    {w.lastDeliveryAt ? (
                      <>
                        <Badge color={w.lastStatus && w.lastStatus < 300 ? 'green' : 'red'}>{w.lastStatus ?? t('adminWebhooks.error')}</Badge> <Time value={w.lastDeliveryAt} />
                      </>
                    ) : (
                      <span className="muted">–</span>
                    )}
                    {w.failureCount > 0 && <div className="danger-text tiny">{t('adminWebhooks.failures', { n: w.failureCount })}</div>}
                  </td>
                  <td className="actions-cell">
                    <IconButton
                      icon={Send}
                      label={t('adminWebhooks.testDelivery')}
                      onClick={async () => {
                        try {
                          const res = await api.post<{ success: boolean; status: number | null; error: string | null }>(`/api/v1/admin/webhooks/${w.id}/test`);
                          if (res.success) toast.success(t('adminWebhooks.testOk', { status: res.status }));
                          else toast.error(t('adminWebhooks.testFailed', { error: res.error ?? `HTTP ${res.status}` }));
                          await refetch();
                        } catch (err) {
                          toast.error(err);
                        }
                      }}
                    />
                    <IconButton icon={RefreshCw} label={t('adminWebhooks.deliveries')} onClick={() => setDeliveries(w)} />
                    <IconButton icon={Pencil} label={t('common.edit')} onClick={() => setEditing(w)} />
                    <IconButton
                      icon={RotateCw}
                      label={t('adminWebhooks.rotate')}
                      onClick={async () => {
                        if (!(await dialogs.confirm({ title: t('adminWebhooks.rotateTitle'), message: t('adminWebhooks.rotateText') }))) return;
                        const res = await api.post<{ secret: string }>(`/api/v1/admin/webhooks/${w.id}/rotate-secret`);
                        setSecret(res.secret);
                      }}
                    />
                    <IconButton
                      icon={Trash2}
                      label={t('common.delete')}
                      onClick={async () => {
                        if (!(await dialogs.confirm({ title: t('adminWebhooks.deleteTitle', { name: w.name }), danger: true, confirmLabel: t('common.delete') }))) return;
                        await api.del(`/api/v1/admin/webhooks/${w.id}`);
                        await refetch();
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <WebhookDialog
          webhook={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(newSecret) => {
            if (newSecret) setSecret(newSecret);
            void refetch();
          }}
        />
      )}
      {deliveries && <DeliveriesDialog webhook={deliveries} onClose={() => setDeliveries(null)} />}
    </>
  );
}

function WebhookDialog({ webhook, onClose, onSaved }: { webhook: Webhook | null; onClose: () => void; onSaved: (secret?: string) => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const catalog = useCatalog();
  const [name, setName] = useState(webhook?.name ?? '');
  const [url, setUrl] = useState(webhook?.url ?? 'https://');
  const [events, setEvents] = useState<string[]>(webhook?.events ?? ['page.*', 'comment.*']);
  const [spaceKey, setSpaceKey] = useState<string>(webhook?.spaceKey ?? '');
  const [limitSpace, setLimitSpace] = useState(!!webhook?.spaceKey);
  const [active, setActive] = useState(webhook?.active ?? true);
  const [headers, setHeaders] = useState<[string, string][]>(Object.entries(webhook?.headers ?? {}));
  const [busy, setBusy] = useState(false);
  const spaces = useQuery({ queryKey: ['spaces', { all: true }], queryFn: () => api.get<{ id: number; key: string }[]>('/api/v1/spaces') });

  const groups = useMemo(() => {
    const map = new Map<string, { type: string; label: string }[]>();
    for (const e of catalog.data?.events ?? []) {
      const prefix = e.type.split('.')[0];
      map.set(prefix, [...(map.get(prefix) ?? []), e]);
    }
    return [...map.entries()];
  }, [catalog.data]);

  const toggle = (e: string, on: boolean) => setEvents(on ? [...new Set([...events, e])] : events.filter((x) => x !== e));

  const save = async () => {
    setBusy(true);
    const spaceId = limitSpace ? (spaces.data ?? []).find((s) => s.key === spaceKey)?.id ?? null : null;
    const body = { name, url, events, spaceId, active, headers: Object.fromEntries(headers.filter(([k]) => k.trim())) };
    try {
      if (webhook) {
        await api.patch(`/api/v1/admin/webhooks/${webhook.id}`, body);
        onSaved();
      } else {
        const res = await api.post<{ secret: string }>('/api/v1/admin/webhooks', body);
        onSaved(res.secret);
      }
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={webhook ? t('adminWebhooks.dialogTitle', { name: webhook.name }) : t('adminWebhooks.create')}
      icon={WebhookIcon}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label={t('common.name')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('common.status')}>
          <Switch checked={active} onChange={setActive} label={active ? t('common.active') : t('common.inactive')} />
        </Field>
      </div>
      <Field label={t('adminWebhooks.url')} help={t('adminWebhooks.urlHelp')}>
        <Input value={url} onChange={(e) => setUrl(e.target.value)} className="mono" />
      </Field>
      <Field label={t('adminWebhooks.space')}>
        <div className="row">
          <Checkbox checked={limitSpace} onChange={setLimitSpace} label={t('adminWebhooks.limitSpace')} />
          {limitSpace && (
            <div style={{ width: 280 }}>
              <SpaceSelect value={spaceKey} onChange={setSpaceKey} />
            </div>
          )}
        </div>
      </Field>
      <Field label={t('adminWebhooks.events')}>
        <div className="row row-wrap gap-sm mb-1">
          <Checkbox checked={events.includes('*')} onChange={(on) => toggle('*', on)} label={<strong>{t('adminWebhooks.allEvents')}</strong>} />
        </div>
        <div className="form-grid" style={{ gap: '0.75rem 1.5rem' }}>
          {groups.map(([prefix, list]) => (
            <div key={prefix}>
              <Checkbox checked={events.includes(`${prefix}.*`)} onChange={(on) => toggle(`${prefix}.*`, on)} label={<strong>{prefix}.*</strong>} />
              <div className="col gap-xs" style={{ marginLeft: '1.5rem', marginTop: 4 }}>
                {list.map((e) => (
                  <Checkbox key={e.type} checked={events.includes(e.type)} onChange={(on) => toggle(e.type, on)} label={<span className="small">{e.label}</span>} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Field>
      <Field label={t('adminWebhooks.headers')} help={t('adminWebhooks.headersHelp')}>
        <div className="col gap-sm">
          {headers.map(([k, v], i) => (
            <div key={i} className="row">
              <Input className="input-sm mono" style={{ maxWidth: 200 }} value={k} onChange={(e) => setHeaders(headers.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))} placeholder="Header" />
              <Input className="input-sm mono grow" value={v} onChange={(e) => setHeaders(headers.map((h, j) => (j === i ? [h[0], e.target.value] : h)))} placeholder={t('adminWebhooks.value')} />
              <IconButton icon={X} label={t('common.remove')} onClick={() => setHeaders(headers.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div>
            <Button size="sm" icon={Plus} onClick={() => setHeaders([...headers, ['', '']])}>
              Header
            </Button>
          </div>
        </div>
      </Field>
    </Modal>
  );
}

function DeliveriesDialog({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['deliveries', webhook.id],
    queryFn: () => api.get<WebhookDelivery[]>(`/api/v1/admin/webhooks/${webhook.id}/deliveries`),
  });
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Modal open onClose={onClose} size="xl" title={t('adminWebhooks.deliveriesTitle', { name: webhook.name })} footer={<Button icon={RefreshCw} onClick={() => void refetch()}>{t('adminWebhooks.refresh')}</Button>}>
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState compact title={t('adminWebhooks.noDeliveries')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {data.map((d) => (
                <Fragment key={d.id}>
                  <tr className="clickable" onClick={() => setOpen(open === d.id ? null : d.id)}>
                    <td>
                      <Badge color={d.success ? 'green' : 'red'}>{d.status ?? t('adminWebhooks.error')}</Badge>
                    </td>
                    <td className="mono small">{d.eventType}</td>
                    <td className="small">
                      <Time value={d.createdAt} mode="datetime" />
                    </td>
                    <td className="small muted">
                      {d.durationMs} ms · {t('adminWebhooks.attempt', { n: d.attempt })}
                    </td>
                    <td className="actions-cell">
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={RotateCw}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const res = await api.post<{ success: boolean; status: number | null }>(`/api/v1/admin/webhooks/deliveries/${d.id}/redeliver`);
                          if (res.success) toast.success(t('adminWebhooks.redelivered', { status: res.status }));
                          else toast.error(t('adminWebhooks.deliveryFailed'));
                          await refetch();
                          void qc.invalidateQueries({ queryKey: ['webhooks'] });
                        }}
                      >
                        {t('adminWebhooks.resend')}
                      </Button>
                    </td>
                  </tr>
                  {open === d.id && (
                    <tr key={`${d.id}-detail`}>
                      <td colSpan={5}>
                        {d.error && <Alert variant="error">{d.error}</Alert>}
                        <div className="form-grid mt-1">
                          <div>
                            <div className="facet-title">{t('adminWebhooks.payload')}</div>
                            <pre className="code-block">{JSON.stringify(d.payload, null, 2)}</pre>
                          </div>
                          <div>
                            <div className="facet-title">{t('adminWebhooks.response')}</div>
                            <pre className="code-block">{d.response || '–'}</pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Pencil, Play, Plug, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../api/client';
import type { Connector, ConnectorResult } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Alert, Badge, Button, EmptyState, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Switch, Textarea } from '../../components/ui';

export function AdminConnectors() {
  const { t } = useI18n();
  const dialogs = useDialogs();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['connectors'], queryFn: () => api.get<Connector[]>('/api/v1/admin/connectors') });
  const [editing, setEditing] = useState<Connector | 'new' | null>(null);
  const [testing, setTesting] = useState<Connector | null>(null);
  return (
    <>
      <PageHeader
        icon={Plug}
        title={t('admin.nav.connectors')}
        subtitle={t('adminConnectors.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            {t('adminConnectors.create')}
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={Plug} title={t('adminConnectors.empty')} text={t('adminConnectors.emptyText')} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('adminConnectors.baseUrl')}</th>
                <th>{t('adminConnectors.auth')}</th>
                <th>Cache</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div className="strong">
                      {c.name} {!c.active && <Badge>{t('common.inactive')}</Badge>}
                    </div>
                    <div className="small muted mono">{c.key}</div>
                  </td>
                  <td className="mono small">{c.baseUrl}</td>
                  <td className="small">
                    <Badge color={c.authType === 'none' ? 'gray' : 'blue'}>{c.authType}</Badge> {c.authHint}
                  </td>
                  <td className="small">{c.cacheTtl} s</td>
                  <td className="actions-cell">
                    <IconButton icon={Play} label={t('adminConnectors.test')} onClick={() => setTesting(c)} />
                    <IconButton icon={Pencil} label={t('common.edit')} onClick={() => setEditing(c)} />
                    <IconButton
                      icon={Trash2}
                      label={t('common.delete')}
                      onClick={async () => {
                        if (!(await dialogs.confirm({ title: t('adminConnectors.deleteTitle', { name: c.name }), message: t('adminConnectors.deleteText'), danger: true, confirmLabel: t('common.delete') }))) return;
                        await api.del(`/api/v1/admin/connectors/${c.id}`);
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
      {editing && <ConnectorDialog connector={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void refetch()} />}
      {testing && <TestDialog connector={testing} onClose={() => setTesting(null)} />}
    </>
  );
}

function ConnectorDialog({ connector, onClose, onSaved }: { connector: Connector | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [form, setForm] = useState({
    key: connector?.key ?? '',
    name: connector?.name ?? '',
    description: connector?.description ?? '',
    baseUrl: connector?.baseUrl ?? 'https://',
    authType: connector?.authType ?? 'none',
    cacheTtl: connector?.cacheTtl ?? 300,
    timeoutMs: connector?.timeoutMs ?? 10000,
    active: connector?.active ?? true,
    allowedPaths: (connector?.allowedPaths ?? []).join('\n'),
  });
  const [auth, setAuth] = useState({ token: '', username: '', password: '', name: '', value: '' });
  const [headers, setHeaders] = useState<[string, string][]>(Object.entries(connector?.headers ?? {}));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm({ ...form, [k]: v });

  const save = async () => {
    setBusy(true);
    const authPayload = Object.values(auth).some(Boolean) ? auth : undefined;
    const body = {
      ...form,
      allowedPaths: form.allowedPaths.split(/\n+/).map((s) => s.trim()).filter(Boolean),
      headers: Object.fromEntries(headers.filter(([k]) => k.trim())),
      auth: form.authType === 'none' ? null : authPayload,
    };
    try {
      if (connector) await api.patch(`/api/v1/admin/connectors/${connector.id}`, body);
      else await api.post('/api/v1/admin/connectors', body);
      toast.success(t('common.changesSaved'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  const keep = connector?.authConfigured ? t('adminConnectors.keep') : undefined;

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Plug}
      title={connector ? t('adminConnectors.dialogTitle', { name: connector.name }) : t('adminConnectors.create')}
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
        <Field label={t('common.name')} required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} autoFocus />
        </Field>
        <Field label={t('adminConnectors.key')} required>
          <Input className="mono" value={form.key} onChange={(e) => set('key', e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} />
        </Field>
      </div>
      <Field label={t('common.description')}>
        <Input value={form.description} onChange={(e) => set('description', e.target.value)} />
      </Field>
      <Field label={t('adminConnectors.baseUrl')} help={t('adminConnectors.baseUrlHelp')}>
        <Input className="mono" value={form.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label={t('adminConnectors.auth')}>
          <Select value={form.authType} onChange={(e) => set('authType', e.target.value as typeof form.authType)}>
            <option value="none">{t('adminConnectors.authNone')}</option>
            <option value="bearer">{t('adminConnectors.authBearer')}</option>
            <option value="basic">{t('adminConnectors.authBasic')}</option>
            <option value="header">{t('adminConnectors.authHeader')}</option>
            <option value="query">{t('adminConnectors.authQuery')}</option>
          </Select>
        </Field>
        <Field label={t('common.status')}>
          <Switch checked={form.active} onChange={(v) => set('active', v)} label={form.active ? t('common.active') : t('common.inactive')} />
        </Field>
      </div>
      {form.authType === 'bearer' && (
        <Field label={t('adminConnectors.token')} help={keep}>
          <Input type="password" value={auth.token} onChange={(e) => setAuth({ ...auth, token: e.target.value })} autoComplete="off" />
        </Field>
      )}
      {form.authType === 'basic' && (
        <div className="form-grid">
          <Field label={t('adminConnectors.user')} help={keep}>
            <Input value={auth.username} onChange={(e) => setAuth({ ...auth, username: e.target.value })} autoComplete="off" />
          </Field>
          <Field label={t('adminConnectors.password')} help={keep}>
            <Input type="password" value={auth.password} onChange={(e) => setAuth({ ...auth, password: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
      )}
      {(form.authType === 'header' || form.authType === 'query') && (
        <div className="form-grid">
          <Field label={form.authType === 'header' ? t('adminConnectors.headerName') : t('adminConnectors.paramName')} help={keep}>
            <Input className="mono" value={auth.name} onChange={(e) => setAuth({ ...auth, name: e.target.value })} placeholder={form.authType === 'header' ? 'X-API-Key' : 'api_key'} />
          </Field>
          <Field label={t('adminConnectors.value')} help={keep}>
            <Input type="password" value={auth.value} onChange={(e) => setAuth({ ...auth, value: e.target.value })} autoComplete="off" />
          </Field>
        </div>
      )}
      <div className="form-grid">
        <Field label={t('adminConnectors.cacheTtl')} help={t('adminConnectors.noCache')}>
          <Input type="number" min={0} value={form.cacheTtl} onChange={(e) => set('cacheTtl', Number(e.target.value))} />
        </Field>
        <Field label="Timeout (ms)">
          <Input type="number" min={1000} max={60000} value={form.timeoutMs} onChange={(e) => set('timeoutMs', Number(e.target.value))} />
        </Field>
      </div>
      <Field label={t('adminConnectors.allowedPaths')} help={t('adminConnectors.allowedPathsHelp')}>
        <Textarea rows={3} className="mono" value={form.allowedPaths} onChange={(e) => set('allowedPaths', e.target.value)} />
      </Field>
      <Field label={t('adminConnectors.headers')}>
        <div className="col gap-sm">
          {headers.map(([k, v], i) => (
            <div key={i} className="row">
              <Input className="input-sm mono" style={{ maxWidth: 200 }} value={k} onChange={(e) => setHeaders(headers.map((h, j) => (j === i ? [e.target.value, h[1]] : h)))} placeholder="Header" />
              <Input className="input-sm mono grow" value={v} onChange={(e) => setHeaders(headers.map((h, j) => (j === i ? [h[0], e.target.value] : h)))} placeholder={t('adminConnectors.value')} />
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

function TestDialog({ connector, onClose }: { connector: Connector; onClose: () => void }) {
  const { t } = useI18n();
  const [path, setPath] = useState('/');
  const [result, setResult] = useState<ConnectorResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} size="lg" title={t('adminConnectors.testTitle', { name: connector.name })} icon={Play}>
      <form
        className="row mb-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            setResult(await api.post<ConnectorResult>(`/api/v1/admin/connectors/${connector.id}/test`, { path }));
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="mono small muted nowrap">{connector.baseUrl}</span>
        <Input className="mono" value={path} onChange={(e) => setPath(e.target.value)} autoFocus />
        <Button type="submit" variant="primary" icon={Play} loading={busy}>
          {t('adminConnectors.query')}
        </Button>
      </form>
      {error && <Alert variant="error">{error}</Alert>}
      {result && (
        <div className="col">
          <div className="row">
            <Badge color={result.ok ? 'green' : 'red'}>HTTP {result.status}</Badge>
            <span className="small muted mono">{result.contentType}</span>
          </div>
          <pre className="code-block">{typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2)}</pre>
        </div>
      )}
    </Modal>
  );
}

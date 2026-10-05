import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { NodeViewProps } from '@tiptap/react';
import { Plug, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';
import type { ConnectorResult } from '../../api/types';
import { useI18n } from '../../i18n';
import { getByPath, renderTemplate } from '../../lib/utils';
import { Alert, Button, Field, IconButton, Input, Loading, Modal, Select, Textarea } from '../../components/ui';
import { useDoc } from '../context';
import { MacroFrame } from './MacroFrame';

interface Attrs {
  connector: string;
  path: string;
  select: string;
  display: 'table' | 'list' | 'value' | 'json' | 'template';
  columns: string;
  template: string;
  title: string;
  limit: number;
}

function parseColumns(spec: string, sample: unknown): { key: string; label: string }[] {
  const cols = spec
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [key, label] = c.split(':').map((s) => s.trim());
      return { key, label: label || key };
    });
  if (cols.length) return cols;
  if (sample && typeof sample === 'object' && !Array.isArray(sample)) {
    return Object.keys(sample as object)
      .filter((k) => {
        const v = (sample as Record<string, unknown>)[k];
        return v === null || ['string', 'number', 'boolean'].includes(typeof v);
      })
      .slice(0, 8)
      .map((k) => ({ key: k, label: k }));
  }
  return [{ key: '', label: 'Wert' }];
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '–';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function ApiDataRender({ attrs, result }: { attrs: Attrs; result: ConnectorResult }) {
  const { t } = useI18n();
  const selected = getByPath(result.data, attrs.select || '');
  if (!result.ok) {
    return (
      <Alert variant="error" title={`HTTP ${result.status}`}>
        {typeof result.data === 'string' ? result.data.slice(0, 300) : JSON.stringify(result.data).slice(0, 300)}
      </Alert>
    );
  }
  const limit = attrs.limit || 50;
  if (attrs.display === 'value') return <div className="api-data-value">{formatCell(selected)}</div>;
  if (attrs.display === 'json') return <pre className="code-block">{JSON.stringify(selected, null, 2)?.slice(0, 20000)}</pre>;
  if (attrs.display === 'template') {
    if (Array.isArray(selected)) {
      return (
        <ul>
          {selected.slice(0, limit).map((item, i) => (
            <li key={i}>{renderTemplate(attrs.template || '{{name}}', item)}</li>
          ))}
        </ul>
      );
    }
    return <p>{renderTemplate(attrs.template, selected)}</p>;
  }
  if (!Array.isArray(selected)) {
    if (selected && typeof selected === 'object') {
      return (
        <table className="macro-table">
          <tbody>
            {Object.entries(selected as Record<string, unknown>)
              .slice(0, 40)
              .map(([k, v]) => (
                <tr key={k}>
                  <th style={{ width: '35%' }}>{k}</th>
                  <td>{formatCell(v)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      );
    }
    return <div className="api-data-value">{formatCell(selected)}</div>;
  }
  if (attrs.display === 'list') {
    return (
      <ul>
        {selected.slice(0, limit).map((item, i) => (
          <li key={i}>{attrs.template ? renderTemplate(attrs.template, item) : typeof item === 'object' ? formatCell(Object.values(item as object)[0]) : formatCell(item)}</li>
        ))}
      </ul>
    );
  }
  const cols = parseColumns(attrs.columns, selected[0]);
  return (
    <div className="table-scroll" style={{ margin: 0 }}>
      <table className="macro-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key || 'v'}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {selected.slice(0, limit).map((row, i) => (
            <tr key={i}>
              {cols.map((c) => (
                <td key={c.key || 'v'}>{formatCell(c.key ? getByPath(row, c.key) : row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {selected.length > limit && <div className="tiny muted mt-1">{t('common.showMore')}: {selected.length - limit}</div>}
    </div>
  );
}

export function ApiDataView(props: NodeViewProps) {
  const { t, fmt } = useI18n();
  const doc = useDoc();
  const qc = useQueryClient();
  const attrs = props.node.attrs as Attrs;
  const [config, setConfig] = useState(!attrs.connector && props.editor.isEditable);
  const queryKey = ['api-data', attrs.connector, attrs.path, doc.pageId];
  const { data, isLoading, error, isFetching } = useQuery({
    queryKey,
    queryFn: () => api.post<ConnectorResult>(`/api/v1/connectors/${encodeURIComponent(attrs.connector)}/query`, { path: attrs.path, pageId: doc.pageId ?? undefined }),
    enabled: !!attrs.connector,
    staleTime: 60_000,
    retry: false,
  });
  const refresh = async () => {
    const fresh = await api.post<ConnectorResult>(`/api/v1/connectors/${encodeURIComponent(attrs.connector)}/query`, { path: attrs.path, pageId: doc.pageId ?? undefined, refresh: true });
    qc.setQueryData(queryKey, fresh);
  };
  return (
    <MacroFrame
      props={props}
      title={attrs.title || t('macros.apiData')}
      icon={Plug}
      onConfigure={() => setConfig(true)}
      headerRight={
        attrs.connector && (
          <span className="row gap-xs tiny">
            {data && (
              <span>
                {t('macros.fetchedAt', { time: fmt.time(data.fetchedAt) })}
                {data.cached ? ` · ${t('macros.cached')}` : ''}
              </span>
            )}
            <IconButton icon={RefreshCw} label={t('common.refresh')} onClick={() => void refresh()} className={isFetching ? 'spin' : undefined} />
          </span>
        )
      }
    >
      {!attrs.connector ? (
        <div className="macro-empty">{t('macros.apiDataDesc')}</div>
      ) : isLoading ? (
        <Loading inline />
      ) : error ? (
        <Alert variant="error">{(error as Error).message}</Alert>
      ) : data ? (
        <ApiDataRender attrs={attrs} result={data} />
      ) : null}
      {config && <ApiDataConfig attrs={attrs} onClose={() => setConfig(false)} onSave={(next) => props.updateAttributes(next)} />}
    </MacroFrame>
  );
}

function ApiDataConfig({ attrs, onClose, onSave }: { attrs: Attrs; onClose: () => void; onSave: (a: Partial<Attrs>) => void }) {
  const { t } = useI18n();
  const doc = useDoc();
  const [draft, setDraft] = useState<Attrs>({ ...attrs, display: attrs.display || 'table', limit: attrs.limit || 50 });
  const [preview, setPreview] = useState<ConnectorResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const connectors = useQuery({
    queryKey: ['connectors-available'],
    queryFn: () => api.get<{ key: string; name: string; description: string; baseUrl: string }[]>('/api/v1/connectors/available'),
  });
  const selectedConnector = connectors.data?.find((c) => c.key === draft.connector);
  const set = (patch: Partial<Attrs>) => setDraft((d) => ({ ...d, ...patch }));

  const load = async () => {
    setLoading(true);
    setPreviewError(null);
    try {
      setPreview(await api.post<ConnectorResult>(`/api/v1/connectors/${encodeURIComponent(draft.connector)}/query`, { path: draft.path, pageId: doc.pageId ?? undefined, refresh: true }));
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const pathHints = useMemo(() => {
    if (!preview) return [];
    const hints: string[] = [];
    const walk = (value: unknown, path: string, depth: number) => {
      if (depth > 3 || hints.length > 30) return;
      if (Array.isArray(value)) {
        hints.push(path || '(Wurzel)');
        return;
      }
      if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, depth + 1);
    };
    walk(preview.data, '', 0);
    return hints;
  }, [preview]);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('macros.apiData')}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            disabled={!draft.connector}
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            {t('common.apply')}
          </Button>
        </>
      }
    >
      {connectors.data && connectors.data.length === 0 ? (
        <Alert variant="info">{t('macros.noConnectors')}</Alert>
      ) : (
        <>
          <div className="form-grid">
            <Field label={t('macros.connector')} help={selectedConnector?.baseUrl}>
              <Select value={draft.connector} onChange={(e) => set({ connector: e.target.value })}>
                <option value="">–</option>
                {(connectors.data ?? []).map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('macros.path')}>
              <Input value={draft.path} onChange={(e) => set({ path: e.target.value })} placeholder="/api/items?status=open" />
            </Field>
            <Field label={t('common.title')}>
              <Input value={draft.title} onChange={(e) => set({ title: e.target.value })} />
            </Field>
            <Field label={t('macros.display')}>
              <Select value={draft.display} onChange={(e) => set({ display: e.target.value as Attrs['display'] })}>
                <option value="table">{t('macros.displayTable')}</option>
                <option value="list">{t('macros.displayList')}</option>
                <option value="value">{t('macros.displayValue')}</option>
                <option value="template">{t('macros.displayTemplate')}</option>
                <option value="json">{t('macros.displayJson')}</option>
              </Select>
            </Field>
            <Field label={t('macros.selectPath')}>
              <Input value={draft.select} onChange={(e) => set({ select: e.target.value })} list="api-path-hints" />
              <datalist id="api-path-hints">
                {pathHints.map((h) => (
                  <option key={h} value={h === '(Wurzel)' ? '' : h} />
                ))}
              </datalist>
            </Field>
            <Field label={t('macros.limit')}>
              <Input type="number" min={1} max={500} value={draft.limit} onChange={(e) => set({ limit: Number(e.target.value) || 50 })} />
            </Field>
          </div>
          {(draft.display === 'table' || draft.display === 'list') && (
            <Field label={t('macros.columns')} help={t('apiData.columnsHelp')}>
              <Input value={draft.columns} onChange={(e) => set({ columns: e.target.value })} placeholder="name:Name, status:Status" />
            </Field>
          )}
          {(draft.display === 'template' || draft.display === 'list') && (
            <Field label={t('macros.template')}>
              <Textarea rows={2} value={draft.template} onChange={(e) => set({ template: e.target.value })} />
            </Field>
          )}
          <div className="row mb-1">
            <Button icon={RefreshCw} loading={loading} disabled={!draft.connector} onClick={() => void load()}>
              {t('macros.loadPreview')}
            </Button>
          </div>
          {previewError && <Alert variant="error">{previewError}</Alert>}
          {preview && (
            <div className="col">
              <div className="macro" style={{ margin: 0 }}>
                <div className="macro-body">
                  <ApiDataRender attrs={draft} result={preview} />
                </div>
              </div>
              <details>
                <summary className="small muted">JSON ({preview.url})</summary>
                <pre className="code-block">{JSON.stringify(preview.data, null, 2).slice(0, 12000)}</pre>
              </details>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

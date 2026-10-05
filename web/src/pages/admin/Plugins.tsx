import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Code2, FolderSearch, Monitor, Puzzle, Server, Settings2 } from 'lucide-react';
import { api } from '../../api/client';
import type { PluginInfo } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Alert, Badge, Button, EmptyState, Field, Input, Loading, Modal, PageHeader, Select, Switch, Textarea } from '../../components/ui';

export function AdminPlugins() {
  const { t } = useI18n();
  const toast = useToast();
  const { data, isLoading, refetch } = useQuery({ queryKey: ['plugins'], queryFn: () => api.get<PluginInfo[]>('/api/v1/admin/plugins') });
  const [editing, setEditing] = useState<PluginInfo | null>(null);
  return (
    <>
      <PageHeader
        icon={Puzzle}
        title={t('admin.nav.plugins')}
        subtitle={t('adminPlugins.subtitle')}
        actions={
          <Button
            icon={FolderSearch}
            onClick={async () => {
              await api.post('/api/v1/admin/plugins/rescan');
              await refetch();
              toast.success(t('adminPlugins.rescanned'));
            }}
          >
            {t('adminPlugins.rescan')}
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <EmptyState icon={Puzzle} title={t('adminPlugins.empty')} text={t('adminPlugins.emptyText')} />
      ) : (
        data.map((p) => (
          <div key={p.id} className="plugin-card">
            <span className="plugin-icon">
              <Puzzle size={20} />
            </span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="row row-wrap gap-sm">
                <strong>{p.name}</strong>
                <span className="small muted">v{p.version}</span>
                <span className="small muted mono">{p.id}</span>
                {p.hasServer && (
                  <Badge color="blue">
                    <Server size={11} /> Server
                  </Badge>
                )}
                {p.hasClient && (
                  <Badge color="purple">
                    <Monitor size={11} /> Client
                  </Badge>
                )}
                {p.enabled && p.loaded && <Badge color="green">{t('adminPlugins.loaded')}</Badge>}
              </div>
              <p className="small soft mt-1">{p.description}</p>
              {p.author && <div className="tiny muted">{t('adminPlugins.by', { author: p.author })}</div>}
              {p.error && (
                <div className="mt-1">
                  <Alert variant="error">{p.error}</Alert>
                </div>
              )}
            </div>
            <div className="col" style={{ alignItems: 'flex-end' }}>
              <Switch
                ariaLabel={t('adminPlugins.enableAria', { name: p.name })}
                checked={p.enabled}
                onChange={async (on) => {
                  try {
                    await api.post(`/api/v1/admin/plugins/${p.id}/enabled`, { enabled: on });
                    toast.success(on ? t('adminPlugins.enabled', { name: p.name }) : t('adminPlugins.disabled', { name: p.name }));
                  } catch (err) {
                    toast.error(err);
                  }
                  await refetch();
                }}
              />
              {p.settingsSchema.length > 0 && (
                <Button size="sm" icon={Settings2} onClick={() => setEditing(p)}>
                  {t('common.settings')}
                </Button>
              )}
            </div>
          </div>
        ))
      )}
      <div className="mt-3">
        <Alert variant="info" title={t('adminPlugins.develop')}>
          <span className="row gap-xs">
            <Code2 size={14} /> {t('adminPlugins.developText')}
          </span>
        </Alert>
      </div>
      {editing && <PluginSettingsDialog plugin={editing} onClose={() => setEditing(null)} onSaved={() => void refetch()} />}
    </>
  );
}

function PluginSettingsDialog({ plugin, onClose, onSaved }: { plugin: PluginInfo; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = { ...plugin.settings };
    for (const def of plugin.settingsSchema) if (def.type === 'json' && typeof v[def.key] !== 'string') v[def.key] = JSON.stringify(v[def.key] ?? def.default ?? null, null, 2);
    return v;
  });
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      icon={Settings2}
      title={`${plugin.name} – ${t('common.settings')}`}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api.put(`/api/v1/admin/plugins/${plugin.id}/settings`, values);
                toast.success(t('common.changesSaved'));
                onSaved();
                onClose();
              } catch (err) {
                toast.error(err);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      {plugin.settingsSchema.map((def) => {
        const value = values[def.key];
        const set = (v: unknown) => setValues({ ...values, [def.key]: v });
        return (
          <Field key={def.key} label={def.label} help={def.help} required={def.required}>
            {def.type === 'boolean' ? (
              <Switch checked={!!value} onChange={set} />
            ) : def.type === 'select' ? (
              <Select value={String(value ?? '')} onChange={(e) => set(e.target.value)}>
                {(def.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            ) : def.type === 'textarea' || def.type === 'json' ? (
              <Textarea rows={def.type === 'json' ? 8 : 4} className={def.type === 'json' ? 'mono' : undefined} value={String(value ?? '')} onChange={(e) => set(e.target.value)} />
            ) : (
              <Input type={def.type === 'password' ? 'password' : def.type === 'number' ? 'number' : 'text'} value={String(value ?? '')} onChange={(e) => set(e.target.value)} autoComplete="off" />
            )}
          </Field>
        );
      })}
    </Modal>
  );
}

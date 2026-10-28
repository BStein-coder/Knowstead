import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Info, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Alert, Button, Card, Loading, PageHeader, Switch, Time } from '../../components/ui';
import { HtmlView } from '../../editor/HtmlView';
import { renderMarkdownPreview } from '../../editor/markdownPreview';

interface UpdateInfo {
  enabled: boolean;
  current: string;
  latest: string | null;
  url: string | null;
  name: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  error: { code: 'unreachable' | 'http' | 'format'; detail: string } | null;
  newer: boolean;
  source: string;
}

/** So alt darf der gemerkte Stand sein, bevor das Öffnen der Seite erneut nachsieht (Stunden). */
const STALE_HOURS = 12;

/** Hinweis auf neue Versionen – nur auf Wunsch eingeschaltet, Standard: aus. */
function UpdateCard() {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['update-check'], queryFn: () => api.get<UpdateInfo>('/api/v1/admin/update-check') });
  const refresh = useMutation({
    mutationFn: () => api.post<UpdateInfo>('/api/v1/admin/update-check', {}),
    onSuccess: (info) => qc.setQueryData(['update-check'], info),
    onError: (err) => toast.error(err),
  });
  const toggle = useMutation({
    mutationFn: (on: boolean) => api.put('/api/v1/admin/settings', { updateCheck: on }),
    onSuccess: async (_result, on) => {
      await qc.invalidateQueries({ queryKey: ['update-check'] });
      // Sofort nachsehen, damit die Antwort schon da ist, wenn man den Schalter umgelegt hat
      if (on) refresh.mutate();
      toast.success(t(on ? 'adminAbout.updates.turnedOn' : 'adminAbout.updates.turnedOff'));
    },
    onError: (err) => toast.error(err),
  });

  // Beim Öffnen der Seite nachsehen, wenn die Suche an ist und der gemerkte Stand älter als zwölf Stunden ist
  const asked = useRef(false);
  useEffect(() => {
    if (!data?.enabled || asked.current) return;
    const stale = !data.checkedAt || Date.now() - Date.parse(data.checkedAt) > STALE_HOURS * 3_600_000;
    if (!stale) return;
    asked.current = true;
    refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.enabled, data?.checkedAt]);

  if (!data) return null;
  const errorText = data.error ? t(`adminAbout.updates.errors.${data.error.code}`, { detail: data.error.detail }) : null;

  return (
    <Card
      title={t('adminAbout.updates.title')}
      actions={
        data.enabled && (
          <Button size="sm" icon={RefreshCw} loading={refresh.isPending} onClick={() => refresh.mutate()}>
            {t('adminAbout.updates.checkNow')}
          </Button>
        )
      }
    >
      <Switch
        checked={data.enabled}
        onChange={(on) => toggle.mutate(on)}
        disabled={toggle.isPending}
        label={t('adminAbout.updates.switchLabel')}
        description={t('adminAbout.updates.switchHelp', { source: data.source })}
      />
      {data.enabled && (
        <div className="mt-3" aria-live="polite">
          {data.newer && data.latest ? (
            <Alert
              variant="warning"
              title={t('adminAbout.updates.available', { version: data.latest })}
              action={
                data.url && (
                  <a className="btn btn-secondary btn-sm" href={data.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} aria-hidden="true" /> {t('adminAbout.updates.notes')}
                  </a>
                )
              }
            >
              {t('adminAbout.updates.availableText', { current: data.current })}
              {data.publishedAt && (
                <>
                  {' '}
                  {t('adminAbout.updates.publishedOn')} <Time value={data.publishedAt} mode="date" />.
                </>
              )}{' '}
              {t('adminAbout.updates.howTo')}
            </Alert>
          ) : data.latest && !data.error ? (
            <Alert variant="success">{t('adminAbout.updates.upToDate', { version: data.current })}</Alert>
          ) : null}
          {errorText && (
            <Alert variant="error" title={t('adminAbout.updates.failed')}>
              {errorText}
            </Alert>
          )}
          {refresh.isPending && !data.checkedAt && <Loading inline label={t('adminAbout.updates.checking')} />}
          {data.checkedAt && (
            <p className="small soft mt-2">
              {t('adminAbout.updates.checked')} <Time value={data.checkedAt} mode="datetime" />
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export function AdminAbout() {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({ queryKey: ['release-notes'], queryFn: () => api.get<{ version: string; markdown: string }>('/api/v1/release-notes') });
  return (
    <>
      <PageHeader icon={Info} title={t('admin.nav.about')} subtitle={data ? `Knowstead ${data.version}` : undefined} />
      <div className="mb-3">
        <UpdateCard />
      </div>
      <div className="form-grid mb-3" style={{ gap: '1rem' }}>
        <Card title={t('adminAbout.docs')}>
          <ul className="small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
            <li>
              <a href="/s/HANDBUCH">{t('adminAbout.handbook')}</a>
            </li>
            <li>
              <a href="/api/docs" target="_blank" rel="noreferrer">
                REST-API (OpenAPI/Swagger)
              </a>
            </li>
            <li>docs/ADMINISTRATION.md · docs/API.md · docs/PLUGINS.md · docs/ARCHITEKTUR.md</li>
          </ul>
        </Card>
        <Card title={t('adminAbout.tech')}>
          <p className="small soft">Node.js · Fastify · SQLite (FTS5) · React · TipTap · CodeMirror · Mermaid · KaTeX</p>
        </Card>
      </div>
      <Card title={t('app.releaseNotes')}>
        {isLoading ? <Loading /> : <div className="release-notes"><HtmlView html={renderMarkdownPreview(data?.markdown ?? '')} /></div>}
      </Card>
    </>
  );
}

import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { api } from '../../api/client';
import { useI18n } from '../../i18n';
import { Card, Loading, PageHeader } from '../../components/ui';
import { HtmlView } from '../../editor/HtmlView';
import { renderMarkdownPreview } from '../../editor/markdownPreview';

export function AdminAbout() {
  const { t } = useI18n();
  const { data, isLoading } = useQuery({ queryKey: ['release-notes'], queryFn: () => api.get<{ version: string; markdown: string }>('/api/v1/release-notes') });
  return (
    <>
      <PageHeader icon={Info} title={t('admin.nav.about')} subtitle={data ? `Knowstead ${data.version}` : undefined} />
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

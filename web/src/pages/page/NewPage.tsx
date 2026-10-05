import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { FileCode2, FilePlus2, FileText, FileType2, Search } from 'lucide-react';
import { api } from '../../api/client';
import type { ContentType, Page } from '../../api/types';
import { useTemplates } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Button, Field, Input, Loading, PageHeader, cx } from '../../components/ui';
import { PagePicker } from '../../components/Pickers';
import { useSpaceContext } from '../spaces/SpaceLayout';

type Choice = { kind: 'blank'; contentType: ContentType } | { kind: 'template'; id: number };

export default function NewPage() {
  const { space } = useSpaceContext();
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const parentParam = Number(params.get('parent')) || null;
  const [parent, setParent] = useState<{ id: number; title: string } | null>(null);
  const [choice, setChoice] = useState<Choice>({ kind: 'blank', contentType: 'richtext' });
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const { data: templates, isLoading } = useTemplates(space.key);

  useQuery({
    queryKey: ['page', parentParam, 'raw'],
    queryFn: async () => {
      const p = await api.get<Page>(`/api/v1/pages/${parentParam}`);
      if (!p.isHome) setParent({ id: p.id, title: p.title });
      return p;
    },
    enabled: !!parentParam,
  });

  const grouped = useMemo(() => {
    const lower = q.trim().toLowerCase();
    const list = (templates ?? []).filter((tpl) => !lower || `${tpl.name} ${tpl.description} ${tpl.category}`.toLowerCase().includes(lower));
    const groups = new Map<string, typeof list>();
    for (const tpl of list) {
      const key = tpl.spaceId ? t('newPage.spaceTemplates') : tpl.category || t('nav.templates');
      groups.set(key, [...(groups.get(key) ?? []), tpl]);
    }
    return [...groups.entries()];
  }, [templates, q, t]);

  const create = async () => {
    setBusy(true);
    try {
      const page = await api.post<Page>('/api/v1/pages', {
        spaceKey: space.key,
        parentId: parent?.id ?? null,
        status: 'draft',
        // Vorschlag aus der Inhaltsanalyse (Suchbegriff ohne Treffer)
        title: (params.get('title') ?? '').slice(0, 200),
        ...(choice.kind === 'template' ? { templateId: choice.id } : { contentType: choice.contentType, content: '' }),
      });
      navigate(`/s/${encodeURIComponent(space.key)}/edit/${page.id}`, { replace: true });
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  };

  const blank = [
    { contentType: 'richtext' as const, icon: FileText, title: t('newPage.blank'), desc: t('newPage.blankDesc') },
    { contentType: 'markdown' as const, icon: FileType2, title: t('newPage.markdown'), desc: t('newPage.markdownDesc') },
    { contentType: 'code' as const, icon: FileCode2, title: t('newPage.code'), desc: t('newPage.codeDesc') },
  ];

  return (
    <div className="container">
      <PageHeader
        icon={FilePlus2}
        title={t('newPage.title')}
        subtitle={`${space.icon ?? '📘'} ${space.name}`}
        actions={
          <Button variant="primary" loading={busy} onClick={() => void create()}>
            {t('common.create')}
          </Button>
        }
      />
      <Field label={t('newPage.parent')} help={!parent ? t('newPage.topLevel') : undefined}>
        <div style={{ maxWidth: 520 }}>
          <PagePicker value={parent} spaceKey={space.key} onChange={(p) => setParent(p ? { id: p.id, title: p.title } : null)} />
        </div>
      </Field>
      <h3 className="mb-1 mt-2">{t('newPage.chooseTemplate')}</h3>
      <div className="template-grid mb-3">
        {blank.map((b) => {
          const Icon = b.icon;
          const selected = choice.kind === 'blank' && choice.contentType === b.contentType;
          return (
            <button key={b.contentType} type="button" className={cx('template-card', selected && 'selected')} onClick={() => setChoice({ kind: 'blank', contentType: b.contentType })} onDoubleClick={() => void create()}>
              <span className="template-card-icon">
                <Icon size={22} />
              </span>
              <span className="template-card-name">{b.title}</span>
              <span className="template-card-desc">{b.desc}</span>
            </button>
          );
        })}
      </div>
      <div className="row mb-2" style={{ maxWidth: 420 }}>
        <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('newPage.searchTemplates')} />
      </div>
      {isLoading && <Loading />}
      {grouped.map(([group, list]) => (
        <div key={group} className="mb-3">
          <div className="facet-title">{group}</div>
          <div className="template-grid">
            {list.map((tpl) => {
              const selected = choice.kind === 'template' && choice.id === tpl.id;
              return (
                <button key={tpl.id} type="button" className={cx('template-card', selected && 'selected')} onClick={() => setChoice({ kind: 'template', id: tpl.id })} onDoubleClick={() => void create()}>
                  <span className="template-card-icon">{tpl.icon ?? '📄'}</span>
                  <span className="template-card-name">{tpl.name}</span>
                  <span className="template-card-desc">{tpl.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

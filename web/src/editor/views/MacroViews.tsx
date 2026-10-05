import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { NodeViewProps } from '@tiptap/react';
import {
  Clock,
  Download,
  FileText,
  FolderTree,
  GitBranch,
  History,
  Paperclip,
  Table2,
} from 'lucide-react';
import { api } from '../../api/client';
import type { Attachment, Page, PageSummary, Paged, Revision } from '../../api/types';
import { useI18n } from '../../i18n';
import { Button, Field, Input, Loading, Modal, Select, Time } from '../../components/ui';
import { PagePicker } from '../../components/Pickers';
import { useDoc, DocContext } from '../context';
import { collectHeadings, type DocHeading } from '../headings';
import { MacroFrame } from './MacroFrame';
import { DocumentView } from '../DocumentView';
import { HtmlView } from '../HtmlView';

/* ------------------------------ Inhaltsverzeichnis ------------------------------ */

export function TocView(props: NodeViewProps) {
  const { t } = useI18n();
  const maxLevel = Number(props.node.attrs.maxLevel) || 3;
  const [headings, setHeadings] = useState<DocHeading[]>(() => collectHeadings(props.editor.state.doc, maxLevel));
  useEffect(() => {
    const update = () => setHeadings(collectHeadings(props.editor.state.doc, maxLevel));
    update();
    props.editor.on('update', update);
    return () => {
      props.editor.off('update', update);
    };
  }, [props.editor, maxLevel]);
  const minLevel = Math.min(...headings.map((h) => h.level), 6);
  return (
    <MacroFrame props={props} plain onConfigure={() => props.updateAttributes({ maxLevel: maxLevel >= 4 ? 2 : maxLevel + 1 })}>
      <nav className="toc-macro">
        <div className="toc-macro-title">{t('macros.toc')}</div>
        {headings.length === 0 ? (
          <div className="macro-empty">{t('macros.tocEmpty')}</div>
        ) : (
          <ul className="toc-list">
            {headings.map((h) => (
              <li key={`${h.id}-${h.pos}`} style={{ paddingLeft: `${(h.level - minLevel) * 1.1}em` }}>
                <a
                  href={`#${h.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    history.replaceState(null, '', `#${h.id}`);
                  }}
                >
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        )}
      </nav>
    </MacroFrame>
  );
}

/* ------------------------------ Unterseiten ------------------------------ */

function ChildList({ items, excerpt }: { items: PageSummary[]; excerpt: boolean }) {
  return (
    <ul className="children-list">
      {items.map((p) => (
        <li key={p.id}>
          <Link to={p.url}>
            <span>{p.icon ?? <FileText size={14} className="muted" />}</span>
            {p.title}
          </Link>
          {excerpt && p.excerpt && <div className="children-excerpt">{p.excerpt}</div>}
          {p.children && p.children.length > 0 && <ChildList items={p.children} excerpt={excerpt} />}
        </li>
      ))}
    </ul>
  );
}

export function ChildrenView(props: NodeViewProps) {
  const { t } = useI18n();
  const { pageId } = useDoc();
  const [config, setConfig] = useState(false);
  const depth = Number(props.node.attrs.depth) || 1;
  const sort = (props.node.attrs.sort as string) || 'position';
  const excerpt = props.node.attrs.excerpt === true || props.node.attrs.excerpt === 'true';
  const { data, isLoading } = useQuery({
    queryKey: ['children', pageId, sort, depth],
    queryFn: () => api.get<PageSummary[]>(`/api/v1/pages/${pageId}/children`, { sort, depth }),
    enabled: !!pageId,
    staleTime: 15_000,
  });
  return (
    <MacroFrame props={props} title={t('macros.children')} icon={FolderTree} plain onConfigure={() => setConfig(true)}>
      {!pageId ? (
        <div className="macro-empty">{t('macros.childrenDesc')}</div>
      ) : isLoading ? (
        <Loading inline />
      ) : !data?.length ? (
        <div className="macro-empty">{t('macros.childrenEmpty')}</div>
      ) : (
        <ChildList items={data} excerpt={excerpt} />
      )}
      <Modal open={config} onClose={() => setConfig(false)} title={t('macros.children')} size="sm" footer={<Button variant="primary" onClick={() => setConfig(false)}>{t('common.ok')}</Button>}>
        <Field label={t('macros.depth')}>
          <Select value={depth} onChange={(e) => props.updateAttributes({ depth: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t('macros.sort')}>
          <Select value={sort} onChange={(e) => props.updateAttributes({ sort: e.target.value })}>
            <option value="position">{t('macros.sortPosition')}</option>
            <option value="title">{t('macros.sortTitle')}</option>
            <option value="updated">{t('macros.sortUpdated')}</option>
            <option value="created">{t('macros.sortCreated')}</option>
          </Select>
        </Field>
        <label className="checkbox-row">
          <input type="checkbox" checked={excerpt} onChange={(e) => props.updateAttributes({ excerpt: e.target.checked })} />
          <span>{t('macros.showExcerpt')}</span>
        </label>
      </Modal>
    </MacroFrame>
  );
}

/* ------------------------------ Seite einbinden ------------------------------ */

export function IncludePageView(props: NodeViewProps) {
  const { t } = useI18n();
  const doc = useDoc();
  const pageId = Number(props.node.attrs.pageId) || null;
  const [config, setConfig] = useState(false);
  const tooDeep = doc.depth >= 3;
  const { data, isLoading, error } = useQuery({
    queryKey: ['page', pageId, 'render'],
    queryFn: () => api.get<Page>(`/api/v1/pages/${pageId}`, { render: true }),
    enabled: !!pageId && !tooDeep && pageId !== doc.pageId,
    retry: false,
  });
  const editable = props.editor.isEditable;
  const picker = (
    <PagePicker
      value={data ? { id: data.id, title: data.title } : null}
      excludeId={doc.pageId ?? undefined}
      placeholder={t('macros.includeChoose')}
      onChange={(p) => {
        props.updateAttributes({ pageId: p?.id ?? null });
        setConfig(false);
      }}
    />
  );
  if (!pageId) {
    return (
      <MacroFrame props={props} title={t('macros.include')} icon={GitBranch}>
        {editable ? picker : <div className="macro-empty">{t('macros.includeMissing')}</div>}
      </MacroFrame>
    );
  }
  return (
    <MacroFrame props={props} plain onConfigure={() => setConfig(true)}>
      <div className="include-macro">
        {data && (
          <div className="include-macro-header">
            <GitBranch size={12} />
            <Link to={data.url}>{data.title}</Link>
          </div>
        )}
        {tooDeep || pageId === doc.pageId ? (
          <div className="macro-empty">{t('macros.includeLoop')}</div>
        ) : isLoading ? (
          <Loading inline />
        ) : error || !data ? (
          <div className="macro-empty">{t('macros.includeMissing')}</div>
        ) : data.contentType === 'richtext' ? (
          <DocContext.Provider value={{ mode: 'view', pageId: data.id, spaceKey: data.space.key, depth: doc.depth + 1 }}>
            <DocumentView html={data.html ?? data.content} pageId={data.id} spaceKey={data.space.key} depth={doc.depth + 1} />
          </DocContext.Provider>
        ) : (
          <HtmlView html={data.html ?? ''} />
        )}
      </div>
      <Modal open={config} onClose={() => setConfig(false)} title={t('macros.include')} size="md">
        {picker}
      </Modal>
    </MacroFrame>
  );
}

/* ------------------------------ Änderungshistorie ------------------------------ */

export function ChangelogView(props: NodeViewProps) {
  const { t } = useI18n();
  const doc = useDoc();
  const pageId = Number(props.node.attrs.pageId) || doc.pageId;
  const limit = Number(props.node.attrs.limit) || 10;
  const { data, isLoading } = useQuery({
    queryKey: ['revisions', pageId, limit],
    queryFn: () => api.get<Paged<Revision>>(`/api/v1/pages/${pageId}/revisions`, { limit }),
    enabled: !!pageId,
  });
  const labels = (type: string) => t(`history.changeTypes.${type}`);
  return (
    <MacroFrame
      props={props}
      title={t('macros.changelog')}
      icon={History}
      onConfigure={() => props.updateAttributes({ limit: limit >= 50 ? 5 : limit === 5 ? 10 : limit === 10 ? 25 : 50 })}
      headerRight={<span className="tiny">{limit}</span>}
    >
      {!pageId ? (
        <div className="macro-empty">{t('macros.changelogDesc')}</div>
      ) : isLoading ? (
        <Loading inline />
      ) : (
        <table className="macro-table">
          <thead>
            <tr>
              <th style={{ width: '12%' }}>{t('common.version')}</th>
              <th style={{ width: '20%' }}>{t('changeHistory.date')}</th>
              <th style={{ width: '22%' }}>{t('changeHistory.author')}</th>
              <th>{t('changeHistory.change')}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.version}</td>
                <td>
                  <Time value={r.createdAt} mode="date" />
                </td>
                <td>{r.author?.displayName ?? '–'}</td>
                <td>{r.changeNote || <span className="muted">{labels(r.changeType)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </MacroFrame>
  );
}

/* ------------------------------ Zuletzt geändert ------------------------------ */

export function RecentPagesView(props: NodeViewProps) {
  const { t } = useI18n();
  const doc = useDoc();
  const [config, setConfig] = useState(false);
  const limit = Number(props.node.attrs.limit) || 8;
  const scope = (props.node.attrs.scope as string) || 'space';
  const label = (props.node.attrs.label as string) || '';
  const { data, isLoading } = useQuery({
    queryKey: ['recent-pages', scope === 'space' ? doc.spaceKey : null, limit, label],
    queryFn: () => api.get<PageSummary[]>('/api/v1/macros/recent-pages', { space: scope === 'space' ? doc.spaceKey : undefined, limit, label }),
    staleTime: 20_000,
  });
  return (
    <MacroFrame props={props} title={t('macros.recent')} icon={Clock} onConfigure={() => setConfig(true)}>
      {isLoading ? (
        <Loading inline />
      ) : !data?.length ? (
        <div className="macro-empty">{t('common.noResults')}</div>
      ) : (
        <ul className="children-list">
          {data.map((p) => (
            <li key={p.id} className="row" style={{ justifyContent: 'space-between' }}>
              <Link to={p.url}>
                <span>{p.icon ?? <FileText size={14} className="muted" />}</span>
                {p.title}
                {scope !== 'space' && <span className="muted small"> · {p.spaceName}</span>}
              </Link>
              <span className="small muted nowrap">
                {p.updatedBy?.displayName} · <Time value={p.updatedAt} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <Modal open={config} onClose={() => setConfig(false)} title={t('macros.recent')} size="sm" footer={<Button variant="primary" onClick={() => setConfig(false)}>{t('common.ok')}</Button>}>
        <Field label={t('macros.limit')}>
          <Input type="number" min={1} max={50} value={limit} onChange={(e) => props.updateAttributes({ limit: Number(e.target.value) || 8 })} />
        </Field>
        <Field label={t('macros.scope')}>
          <Select value={scope} onChange={(e) => props.updateAttributes({ scope: e.target.value })}>
            <option value="space">{t('macros.scopeSpace')}</option>
            <option value="all">{t('macros.scopeAll')}</option>
          </Select>
        </Field>
        <Field label={t('macros.label')}>
          <Input value={label} onChange={(e) => props.updateAttributes({ label: e.target.value })} />
        </Field>
      </Modal>
    </MacroFrame>
  );
}

/* ------------------------------ Anhänge ------------------------------ */

export function AttachmentsView(props: NodeViewProps) {
  const { t, fmt } = useI18n();
  const { pageId } = useDoc();
  const { data, isLoading } = useQuery({
    queryKey: ['attachments', pageId, false],
    queryFn: () => api.get<Attachment[]>(`/api/v1/pages/${pageId}/attachments`),
    enabled: !!pageId,
  });
  return (
    <MacroFrame props={props} title={t('macros.attachments')} icon={Paperclip}>
      {isLoading ? (
        <Loading inline />
      ) : !data?.length ? (
        <div className="macro-empty">{t('attachments.empty')}</div>
      ) : (
        <table className="macro-table">
          <tbody>
            {data.map((a) => (
              <tr key={a.id}>
                <td>
                  <a href={a.url} target="_blank" rel="noopener noreferrer">
                    {a.filename}
                  </a>
                </td>
                <td className="muted small">{fmt.bytes(a.size)}</td>
                <td className="muted small">{a.uploadedBy?.displayName}</td>
                <td className="muted small">
                  <Time value={a.createdAt} mode="date" />
                </td>
                <td style={{ width: 1 }}>
                  <a href={a.downloadUrl} title={t('common.download')}>
                    <Download size={14} />
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </MacroFrame>
  );
}

/* ------------------------------ Eigenschaften-Bericht ------------------------------ */

export function PropertyValue({ value, type }: { value: string; type: string }) {
  const { fmt } = useI18n();
  if (!value) return <span className="muted">–</span>;
  if (type === 'status') {
    const lower = value.toLowerCase();
    const color = /erledigt|done|fertig|aktiv|abgeschlossen|freigegeben|ja/.test(lower)
      ? 'green'
      : /arbeit|progress|laufend|review|prüfung/.test(lower)
        ? 'blue'
        : /blockiert|fehler|abgelehnt|risiko|rot/.test(lower)
          ? 'red'
          : /geplant|entwurf|offen|vorgeschlagen/.test(lower)
            ? 'yellow'
            : 'gray';
    return (
      <span className="status-lozenge" data-color={color}>
        {value}
      </span>
    );
  }
  if (type === 'url' && /^https?:\/\//.test(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer">
        {value.replace(/^https?:\/\//, '')}
      </a>
    );
  }
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}/.test(value)) return <span>{fmt.date(value)}</span>;
  if (type === 'boolean') return <span>{value === 'true' || value === 'ja' ? '✓' : '–'}</span>;
  return <span>{value}</span>;
}

export function PropertiesReportView(props: NodeViewProps) {
  const { t } = useI18n();
  const doc = useDoc();
  const [config, setConfig] = useState(false);
  const scope = (props.node.attrs.scope as string) || 'children';
  const label = (props.node.attrs.label as string) || '';
  const columns = (props.node.attrs.columns as string) || '';
  const { data, isLoading } = useQuery({
    queryKey: ['props-report', doc.pageId, scope, label, columns],
    queryFn: () =>
      api.get<{ columns: string[]; rows: { page: PageSummary; values: Record<string, { value: string; type: string } | null>; labels: string[] }[] }>(
        '/api/v1/macros/properties-report',
        { pageId: doc.pageId ?? undefined, scope, label: label || undefined, columns: columns || undefined, space: scope === 'label' ? doc.spaceKey ?? undefined : undefined },
      ),
    enabled: scope === 'label' ? !!label : !!doc.pageId,
    staleTime: 15_000,
  });
  return (
    <MacroFrame props={props} title={t('macros.propsReport')} icon={Table2} onConfigure={() => setConfig(true)}>
      {isLoading ? (
        <Loading inline />
      ) : !data?.rows.length ? (
        <div className="macro-empty">{t('common.noResults')}</div>
      ) : (
        <div className="table-scroll" style={{ margin: 0 }}>
          <table className="macro-table">
            <thead>
              <tr>
                <th>{t('common.page')}</th>
                {data.columns.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.page.id}>
                  <td>
                    <Link to={r.page.url}>
                      {r.page.icon ? `${r.page.icon} ` : ''}
                      {r.page.title}
                    </Link>
                  </td>
                  {data.columns.map((c) => (
                    <td key={c}>{r.values[c] ? <PropertyValue value={r.values[c]!.value} type={r.values[c]!.type} /> : <span className="muted">–</span>}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={config} onClose={() => setConfig(false)} title={t('macros.propsReport')} size="sm" footer={<Button variant="primary" onClick={() => setConfig(false)}>{t('common.ok')}</Button>}>
        <Field label={t('macros.scope')}>
          <Select value={scope} onChange={(e) => props.updateAttributes({ scope: e.target.value })}>
            <option value="children">{t('macros.propsScopeChildren')}</option>
            <option value="descendants">{t('macros.propsScopeDescendants')}</option>
            <option value="label">{t('macros.propsScopeLabel')}</option>
          </Select>
        </Field>
        {scope === 'label' && (
          <Field label={t('macros.label')}>
            <Input value={label} onChange={(e) => props.updateAttributes({ label: e.target.value })} />
          </Field>
        )}
        <Field label={t('macros.columns')}>
          <Input value={columns} onChange={(e) => props.updateAttributes({ columns: e.target.value })} placeholder={t('changeHistory.columnsPlaceholder')} />
        </Field>
      </Modal>
    </MacroFrame>
  );
}

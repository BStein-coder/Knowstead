import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronRight,
  ClipboardCheck,
  ClipboardPlus,
  Clock,
  Copy,
  CopyPlus,
  Download,
  Eye,
  EyeOff,
  FilePlus2,
  FileSignature,
  FileText,
  FolderInput,
  GitPullRequestDraft,
  History,
  Home,
  Info,
  Link2,
  Lock,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Printer,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { api } from '../../api/client';
import type { Page, PresenceUser } from '../../api/types';
import { useComments, usePage, usePresence } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { usePluginRegistry, type PluginPageContext, type PluginPagePanel } from '../../lib/plugins';
import type { PageEventDetail } from '../../lib/realtime';
import { readingTime } from '../../lib/utils';
import { ExportDialog } from './ExportDialog';
import { ReviewCycleBanner, ReviewCycleChip, ReviewCycleDialog } from './ReviewCycle';
import { ReadConfirmationBanner, ReadRequirementDialog } from './ReadConfirmation';
import { EditModeDialog, SuggestionsChip } from './Suggestions';
import { Avatar, AvatarStack, Badge, Button, EmptyState, ErrorView, IconButton, Loading, Menu, Time, cx } from '../../components/ui';
import { DocumentView } from '../../editor/DocumentView';
import { HtmlView } from '../../editor/HtmlView';
import { CodeView } from './CodeView';
import { CommentsPanel, type ComposerHandle } from './Comments';
import { AttachmentsPanel, LabelsBar, LinksPanel, PropertiesPanel } from './PagePanels';
import { MoveCopyDialog, PageInfoDialog, RestrictionsDialog, SaveTemplateDialog } from './PageDialogs';
import { RequestReviewDialog, ReviewBanner } from './ReviewPanel';
import { AiAssistantDialog } from '../../lib/ai';
import { useAddClip } from '../../components/Clipboard';

function Breadcrumbs({ page }: { page: Page }) {
  const { t } = useI18n();
  const base = `/s/${encodeURIComponent(page.space.key)}`;
  return (
    <nav className="breadcrumbs" aria-label={t('a11y.breadcrumb')}>
      <Link to={base}>
        <span>{page.space.icon ?? '📘'}</span>
        <span>{page.space.name}</span>
      </Link>
      {page.ancestors.map((a) => (
        <span key={a.id} className="row gap-xs">
          <ChevronRight size={13} className="sep" />
          <Link to={`${base}/p/${a.id}`}>
            {a.icon && <span>{a.icon}</span>}
            <span>{a.title}</span>
          </Link>
        </span>
      ))}
    </nav>
  );
}

function useTocHeadings(containerRef: React.RefObject<HTMLElement | null>, deps: unknown[]) {
  const [headings, setHeadings] = useState<{ id: string; text: string; level: number }[]>([]);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const collect = () => {
      const list = [...el.querySelectorAll<HTMLElement>('.page-content h1[id], .page-content h2[id], .page-content h3[id]')]
        .filter((h) => !h.closest('.include-macro'))
        .map((h) => ({ id: h.id, text: h.textContent ?? '', level: Number(h.tagName.slice(1)) }));
      setHeadings(list);
    };
    const timer = window.setTimeout(collect, 150);
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      window.setTimeout(collect, 200);
    });
    observer.observe(el, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    const main = document.getElementById('main');
    if (!main || headings.length < 2) return;
    const onScroll = () => {
      let current: string | null = null;
      for (const h of headings) {
        const node = document.getElementById(h.id);
        if (node && node.getBoundingClientRect().top < 140) current = h.id;
      }
      setActive(current ?? headings[0]?.id ?? null);
    };
    onScroll();
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => main.removeEventListener('scroll', onScroll);
  }, [headings]);
  return { headings, active };
}

export function PageView({ pageId: override }: { pageId?: number }) {
  const params = useParams();
  const pageId = override ?? Number(params.pageId);
  const { t } = useI18n();
  const { user, data } = useAuth();
  const toast = useToast();
  const dialogs = useDialogs();
  const addClip = useAddClip();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const registry = usePluginRegistry();
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: page, isLoading, error, refetch } = usePage(pageId, { render: true, view: true, deleted: true });
  const presence = usePresence(pageId).data ?? [];
  const [liveUpdate, setLiveUpdate] = useState<PageEventDetail | null>(null);
  const [dialog, setDialog] = useState<null | 'restrictions' | 'move' | 'copy' | 'template' | 'info' | 'review' | 'ai' | 'cycle' | 'export' | 'reads' | 'editMode'>(null);
  const [selectionBtn, setSelectionBtn] = useState<{ x: number; y: number; text: string; html: string } | null>(null);
  const articleRef = useRef<HTMLElement>(null);
  const composerRef = useRef<ComposerHandle>(null);

  // Dialog über Query-Parameter öffnen (z. B. aus dem Seitenbaum)
  useEffect(() => {
    const d = searchParams.get('dialog');
    if (d === 'copy' || d === 'move' || d === 'restrictions') {
      setDialog(d);
      searchParams.delete('dialog');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Anwesenheit melden
  useEffect(() => {
    if (!user || !pageId) return;
    const beat = () =>
      api
        .post<PresenceUser[]>(`/api/v1/pages/${pageId}/presence`, { mode: 'view' })
        .then((users) => qc.setQueryData(['presence', pageId], users))
        .catch(() => {});
    void beat();
    const id = window.setInterval(beat, 30_000);
    return () => {
      window.clearInterval(id);
      void api.post(`/api/v1/pages/${pageId}/presence`, { mode: 'leave' }).catch(() => {});
    };
  }, [pageId, user, qc]);

  // Live-Aktualisierungen anderer Benutzer
  useEffect(() => {
    setLiveUpdate(null);
    const onEvent = (e: Event) => {
      const detail = (e as CustomEvent<PageEventDetail>).detail;
      if (detail.pageId !== pageId) return;
      if (detail.type === 'page.updated' && detail.actor?.id !== user?.id) setLiveUpdate(detail);
      if (detail.type === 'page.updated' && detail.actor?.id === user?.id) void refetch();
    };
    window.addEventListener('knowstead:page-event', onEvent);
    return () => window.removeEventListener('knowstead:page-event', onEvent);
  }, [pageId, user?.id, refetch]);

  // Tastenkürzel
  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'e' && page.access.edit) {
        e.preventDefault();
        navigate(`/s/${encodeURIComponent(page.space.key)}/edit/${page.id}`);
      } else if (e.key === 'h') navigate(`/s/${encodeURIComponent(page.space.key)}/history/${page.id}`);
      else if (e.key === 's' && user) void toggleFavorite();
      else if (e.key === 'c' && page.access.create) navigate(`/s/${encodeURIComponent(page.space.key)}/new?parent=${page.id}`);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, user]);

  const { headings, active } = useTocHeadings(articleRef, [page?.id, page?.version]);
  const { data: comments } = useComments(page?.status === 'current' ? pageId : undefined);
  const commentHighlights = useMemo(
    () => (comments ?? []).filter((c) => c.quote && !c.resolved && !c.deleted).map((c) => ({ id: c.id, quote: c.quote! })),
    [comments],
  );

  // Textauswahl → Inline-Kommentar bzw. Zwischenablage
  // Auswahl im Text: Knopf für Inline-Kommentare (nur angemeldet, neu gebunden je Seite und Person)
  const selectionPageId = page?.id;
  const selectionUserId = user?.id;
  useEffect(() => {
    if (!selectionPageId || !selectionUserId) return;
    const onSel = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (!sel || sel.isCollapsed || text.length < 3 || !articleRef.current) {
        setSelectionBtn(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const content = articleRef.current.querySelector('.page-content');
      if (!content || !content.contains(range.commonAncestorContainer)) {
        setSelectionBtn(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      const holder = document.createElement('div');
      holder.appendChild(range.cloneContents());
      setSelectionBtn({ x: rect.left + rect.width / 2, y: rect.top, text: text.slice(0, 500), html: holder.innerHTML });
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, [selectionPageId, selectionUserId]);

  const invalidate = useCallback(() => qc.invalidateQueries({ queryKey: ['page', pageId] }), [qc, pageId]);

  const toggleFavorite = async () => {
    if (!page) return;
    await api.post(`/api/v1/pages/${page.id}/favorite`, { on: !page.isFavorite });
    await invalidate();
    void qc.invalidateQueries({ queryKey: ['favorites'] });
  };

  const toggleWatch = async () => {
    if (!page) return;
    await api.post(`/api/v1/pages/${page.id}/watch`, { on: !page.isWatching });
    await invalidate();
  };

  const onTaskToggle = useCallback(
    async (index: number, checked: boolean) => {
      try {
        const res = await api.post<{ version: number; content: string }>(`/api/v1/pages/${pageId}/tasks`, { index, checked });
        qc.setQueryData<Page>(['page', pageId, 'render'], (old) => (old ? { ...old, version: res.version, content: res.content, html: res.content } : old));
        toast.success(t('page.taskToggled'));
      } catch (err) {
        toast.error(err);
        void refetch();
      }
    },
    [pageId, qc, toast, t, refetch],
  );

  const pluginCtx: PluginPageContext | null = useMemo(
    () =>
      page
        ? {
            page: { id: page.id, title: page.title, spaceKey: page.space.key, contentType: page.contentType, version: page.version, labels: page.labels, url: page.url },
            text: page.contentType === 'richtext' ? (new DOMParser().parseFromString(page.content, 'text/html').body.textContent ?? '') : page.content,
          }
        : null,
    [page],
  );

  if (isLoading) return <Loading />;
  if (error || !page) {
    const status = (error as { status?: number } | null)?.status;
    return (
      <div className="container">
        {status === 404 || status === 403 ? (
          <EmptyState icon={FileText} title={t('errors.notFoundTitle')} text={t('page.notFound')} action={<Link className="btn" to="/">{t('errors.toHome')}</Link>} />
        ) : (
          <ErrorView error={error} onRetry={() => void refetch()} />
        )}
      </div>
    );
  }

  const base = `/s/${encodeURIComponent(page.space.key)}`;
  const editors = presence.filter((p) => p.mode === 'edit' && p.id !== user?.id);
  const viewers = presence.filter((p) => p.id !== user?.id);
  const minutes = readingTime(pluginCtx?.text ?? '');
  const showToc = headings.length >= 3 && page.contentType !== 'code';

  const menuItems = [
    { label: t('page.history'), icon: History, onClick: () => navigate(`${base}/history/${page.id}`), shortcut: 'H' },
    {
      label: t('review.request'),
      icon: ClipboardCheck,
      onClick: () => setDialog('review'),
      hidden: !user || !page.access.edit || page.status !== 'current' || !!page.deletedAt,
    },
    { label: t('reviewCycle.menu'), icon: ShieldCheck, onClick: () => setDialog('cycle'), hidden: !user || page.status !== 'current' || !!page.deletedAt },
    { label: t('reads.menu'), icon: FileSignature, onClick: () => setDialog('reads'), hidden: !user || !page.review.canDecide || page.status !== 'current' || !!page.deletedAt },
    { label: t('suggest.menu'), icon: GitPullRequestDraft, onClick: () => setDialog('editMode'), hidden: !user || !page.editMode?.canChange || page.contentType !== 'richtext' || !!page.deletedAt },
    { label: t('page.restrictions'), icon: Lock, onClick: () => setDialog('restrictions'), hidden: !user },
    { label: t('page.info'), icon: Info, onClick: () => setDialog('info') },
    { separator: true as const },
    { label: t('page.createChild'), icon: FilePlus2, onClick: () => navigate(`${base}/new?parent=${page.id}`), hidden: !page.access.create || page.isHome },
    { label: t('page.move'), icon: FolderInput, onClick: () => setDialog('move'), hidden: !page.access.move || page.isHome },
    { label: t('page.copy'), icon: Copy, onClick: () => setDialog('copy'), hidden: !page.access.create },
    {
      label: t('page.duplicate'),
      icon: CopyPlus,
      hidden: !page.access.create || page.isHome,
      onClick: async () => {
        try {
          const copy = await api.post<Page>(`/api/v1/pages/${page.id}/duplicate`, { includeAttachments: true });
          toast.success(t('page.duplicated'));
          void qc.invalidateQueries({ queryKey: ['tree', page.space.key] });
          navigate(copy.url);
        } catch (err) {
          toast.error(err);
        }
      },
    },
    {
      label: t('clipboard.addPage'),
      icon: ClipboardPlus,
      hidden: !user,
      onClick: () => addClip.mutate({ content: page.url, kind: 'link', title: page.title, sourcePageId: page.id }),
    },
    { label: t('ai.assistant'), icon: Sparkles, onClick: () => setDialog('ai'), hidden: !data?.aiAvailable },
    { label: t('page.saveAsTemplate'), icon: Save, onClick: () => setDialog('template'), hidden: !user },
    { separator: true as const },
    { label: t('page.exportDots'), icon: Download, onClick: () => setDialog('export'), hidden: !page.access.export },
    { label: t('page.print'), icon: Printer, onClick: () => window.print(), hidden: !page.access.export },
    { separator: true as const, hidden: !registry.actions.length },
    { heading: t('editor.groups.plugins'), hidden: !registry.actions.length },
    ...registry.actions.map((a) => ({ label: a.label, hint: a.icon, onClick: () => pluginCtx && void a.onClick(pluginCtx) })),
    { separator: true as const, hidden: !page.access.delete || page.isHome },
    {
      label: t('page.delete'),
      icon: Trash2,
      danger: true,
      hidden: !page.access.delete || page.isHome,
      onClick: async () => {
        const ok = await dialogs.confirm({ title: t('page.delete'), message: t('page.deleteConfirm', { title: page.title }), danger: true, confirmLabel: t('page.delete') });
        if (!ok) return;
        try {
          await api.del(`/api/v1/pages/${page.id}`);
          toast.success(t('page.deleted'));
          void qc.invalidateQueries({ queryKey: ['tree', page.space.key] });
          navigate(page.ancestors.length ? `${base}/p/${page.ancestors[page.ancestors.length - 1].id}` : base);
        } catch (err) {
          toast.error(err);
        }
      },
    },
  ];

  return (
    <div className="page-view">
      <div className="page-toolbar">
        <Breadcrumbs page={page} />
        {viewers.length > 0 && (
          <span className="presence-bar" title={t('page.viewingNow', { names: viewers.map((v) => v.displayName).join(', ') })}>
            <Users size={14} />
            <AvatarStack users={viewers} size={22} />
          </span>
        )}
        {page.access.edit && page.status === 'current' && !page.deletedAt && (
          <Button variant="primary" size="sm" icon={Pencil} onClick={() => navigate(`${base}/edit/${page.id}`)}>
            {t('page.edit')}
          </Button>
        )}
        {user && (
          <>
            <IconButton icon={Star} label={page.isFavorite ? t('page.unfavorite') : t('page.favorite')} active={page.isFavorite} onClick={() => void toggleFavorite()} />
            <IconButton icon={page.isWatching ? Eye : EyeOff} label={page.isWatching ? t('page.unwatch') : t('page.watch')} active={page.isWatching} onClick={() => void toggleWatch()} />
          </>
        )}
        <IconButton
          icon={Link2}
          label={t('page.share')}
          onClick={async () => {
            await navigator.clipboard.writeText(window.location.origin + page.url);
            toast.success(t('page.linkCopied'));
          }}
        />
        <Menu placement="bottom-end" trigger={(p) => <IconButton {...p} ref={p.ref as never} icon={MoreHorizontal} label={t('common.more')} />} items={menuItems} />
      </div>

      {page.status === 'draft' && (
        <div className="banner banner-info">
          <Pencil size={15} />
          <span>{t('page.draftBanner')}</span>
          <span className="spacer" />
          <Button size="sm" onClick={() => navigate(`${base}/edit/${page.id}`)}>
            {t('page.continueEditing')}
          </Button>
        </div>
      )}
      {page.collab?.unpublished && page.access.edit && page.status === 'current' && !page.deletedAt && (
        <div className="banner banner-info">
          <Users size={15} />
          <span>
            <strong>{t('collab.unpublished')}</strong> – {page.collab.editors.length ? t('collab.editingNow', { names: page.collab.editors.map((e) => e.name).join(', ') }) : t('collab.unpublishedHint')}
          </span>
          <span className="spacer" />
          <Button size="sm" onClick={() => navigate(`${base}/edit/${page.id}`)}>
            {t('page.continueEditing')}
          </Button>
        </div>
      )}
      {page.hasDraft && page.status === 'current' && (
        <div className="banner banner-info">
          <Pencil size={15} />
          <span>{t('page.hasDraftBanner')}</span>
          <span className="spacer" />
          <Button size="sm" onClick={() => navigate(`${base}/edit/${page.id}`)}>
            {t('page.continueEditing')}
          </Button>
        </div>
      )}
      {page.deletedAt && (
        <div className="banner banner-danger">
          <Trash2 size={15} />
          <span>{t('page.deletedBanner')}</span>
          <span className="spacer" />
          {page.access.delete && (
            <Button
              size="sm"
              icon={RotateCcw}
              onClick={async () => {
                await api.post(`/api/v1/pages/${page.id}/restore`);
                await invalidate();
                void qc.invalidateQueries({ queryKey: ['tree', page.space.key] });
              }}
            >
              {t('page.restore')}
            </Button>
          )}
        </div>
      )}
      {editors.length > 0 && (
        <div className="banner">
          <Pencil size={15} />
          <span>{t('page.editingNow', { names: editors.map((e) => e.displayName).join(', ') })}</span>
        </div>
      )}
      {liveUpdate && (
        <div className="banner banner-info">
          <Clock size={15} />
          <span>{t('page.updatedLive', { name: liveUpdate.actor?.displayName ?? '?' })}</span>
          <span className="spacer" />
          <Button
            size="sm"
            onClick={() => {
              setLiveUpdate(null);
              void refetch();
            }}
          >
            {t('page.reload')}
          </Button>
        </div>
      )}

      <div className={cx('page-layout', page.fullWidth && 'full', !showToc && 'no-toc')}>
        <article ref={articleRef} className="grow" style={{ minWidth: 0 }}>
          <header className="page-head">
            <div className="page-title-row">
              {page.icon && <span className="page-icon">{page.icon}</span>}
              <h1 className="page-title">{page.title}</h1>
              {(page.restrictions.view || page.restrictions.inheritedView) && (
                <button type="button" className="icon-btn" title={t('page.restrictedView')} onClick={() => setDialog('restrictions')} style={{ marginTop: 8 }}>
                  <Lock size={16} className="danger-text" />
                </button>
              )}
              {page.restrictions.edit && !page.restrictions.view && (
                <button type="button" className="icon-btn" title={t('page.restrictedEdit')} onClick={() => setDialog('restrictions')} style={{ marginTop: 8 }}>
                  <Lock size={16} style={{ color: 'var(--warning)' }} />
                </button>
              )}
            </div>
            <div className="page-meta">
              {page.isHome && (
                <span className="page-meta-item">
                  <Home size={13} /> {t('page.homePage')}
                </span>
              )}
              {page.updatedBy && (
                <span className="page-meta-item">
                  <Avatar user={page.updatedBy} size={18} />
                  <span>
                    <Link to={`/people/${encodeURIComponent(page.updatedBy.username)}`}>{page.updatedBy.displayName}</Link> · <Time value={page.updatedAt} />
                  </span>
                </span>
              )}
              <Link to={`${base}/history/${page.id}`} className="page-meta-item">
                <History size={13} /> {t('page.versionInfo', { n: page.version })}
              </Link>
              <span className="page-meta-item">
                <Clock size={13} /> {t('page.readingTime', { n: minutes })}
              </span>
              <ReviewCycleChip page={page} onOpen={() => setDialog('cycle')} />
              <SuggestionsChip page={page} />
              {page.tasks.total > 0 && <Badge color={page.tasks.done === page.tasks.total ? 'green' : 'blue'}>{t('page.tasks', { done: page.tasks.done, total: page.tasks.total })}</Badge>}
              {page.contentType !== 'richtext' && <Badge>{t(`page.pageTypes.${page.contentType}`)}</Badge>}
              {registry.meta.map((m) => {
                const text = pluginCtx ? m.render(pluginCtx) : null;
                return text ? (
                  <span key={`${m.plugin}-${m.id}`} className="page-meta-item">
                    {text}
                  </span>
                ) : null;
              })}
            </div>
            <LabelsBar page={page} />
          </header>

          {page.review.status !== 'none' && <ReviewBanner page={page} onChanged={() => void refetch()} />}
          <ReviewCycleBanner page={page} onChanged={() => void refetch()} onOpen={() => setDialog('cycle')} />
          <ReadConfirmationBanner page={page} onChanged={() => void refetch()} />

          <div className="page-content">
            {page.contentType === 'richtext' ? (
              <DocumentView
                html={page.html ?? page.content}
                pageId={page.id}
                spaceKey={page.space.key}
                onTaskToggle={page.access.edit ? onTaskToggle : undefined}
                highlights={commentHighlights}
                onHighlightClick={(id) => document.getElementById(`comment-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              />
            ) : page.contentType === 'markdown' ? (
              <HtmlView html={page.html ?? ''} />
            ) : (
              <CodeView code={page.content} language={page.language} />
            )}
          </div>

          <div className="page-footer-panels">
            {registry.panels.map((panel) => (
              <PluginPanel key={`${panel.plugin}-${panel.id}`} panel={panel} ctx={pluginCtx} />
            ))}
            <PropertiesPanel page={page} />
            <AttachmentsPanel page={page} />
            <LinksPanel page={page} />
            {page.status === 'current' && <CommentsPanel ref={composerRef} page={page} />}
          </div>
        </article>
        {showToc && (
          <aside className="toc-float">
            <div className="toc-float-title">{t('page.onThisPage')}</div>
            {headings.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                className={cx(active === h.id && 'active')}
                style={{ '--level': h.level - 1 } as CSSProperties}
                onClick={(e) => {
                  e.preventDefault();
                  document.getElementById(h.id)?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                {h.text}
              </a>
            ))}
          </aside>
        )}
      </div>

      {selectionBtn && (
        <div className="selection-actions" style={{ position: 'fixed', left: selectionBtn.x, top: selectionBtn.y - 44, transform: 'translateX(-50%)', zIndex: 60 }}>
          {page.access.comment && (
            <Button
              size="sm"
              variant="primary"
              icon={MessageSquarePlus}
              className="selection-comment-btn"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                composerRef.current?.setQuote(selectionBtn.text);
                document.getElementById('comments')?.scrollIntoView({ behavior: 'smooth' });
                window.getSelection()?.removeAllRanges();
                setSelectionBtn(null);
              }}
            >
              {t('page.inlineComment')}
            </Button>
          )}
          <Button
            size="sm"
            icon={ClipboardPlus}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              addClip.mutate({ content: selectionBtn.html || selectionBtn.text, kind: selectionBtn.html ? 'html' : 'text', sourcePageId: page.id });
              window.getSelection()?.removeAllRanges();
              setSelectionBtn(null);
            }}
          >
            {t('clipboard.add')}
          </Button>
        </div>
      )}

      {dialog === 'restrictions' && <RestrictionsDialog page={page} open onClose={() => setDialog(null)} />}
      {(dialog === 'move' || dialog === 'copy') && <MoveCopyDialog page={page} mode={dialog} open onClose={() => setDialog(null)} />}
      {dialog === 'template' && <SaveTemplateDialog page={page} open onClose={() => setDialog(null)} />}
      {dialog === 'info' && <PageInfoDialog page={page} open onClose={() => setDialog(null)} />}
      {dialog === 'ai' && <AiAssistantDialog page={page} open onClose={() => setDialog(null)} />}
      {dialog === 'cycle' && <ReviewCycleDialog page={page} open onClose={() => setDialog(null)} onChanged={() => void refetch()} />}
      {dialog === 'reads' && <ReadRequirementDialog page={page} onClose={() => setDialog(null)} onChanged={() => void refetch()} />}
      {dialog === 'editMode' && <EditModeDialog page={page} onClose={() => setDialog(null)} onChanged={() => void refetch()} />}
      {dialog === 'export' && <ExportDialog page={page} open onClose={() => setDialog(null)} />}
      {dialog === 'review' && (
        <RequestReviewDialog page={page} open onClose={() => setDialog(null)} onDone={() => void refetch()} />
      )}
    </div>
  );
}

function PluginPanel({ panel, ctx }: { panel: PluginPagePanel; ctx: PluginPageContext | null }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !ctx) return;
    ref.current.innerHTML = '';
    let cleanup: void | (() => void);
    try {
      cleanup = panel.render(ref.current, ctx);
    } catch (err) {
      ref.current.textContent = t('page.pluginError', { error: err instanceof Error ? err.message : String(err) });
    }
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, [panel, ctx, t]);
  return (
    <section className="panel">
      <h2 className="panel-title">{panel.title}</h2>
      <div ref={ref} />
    </section>
  );
}

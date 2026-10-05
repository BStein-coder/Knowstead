import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { useBlocker, useNavigate, useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, CloudOff, Eye, ListTree, Loader2, Maximize2, Minimize2, MoreHorizontal, Radio, Settings2, Tag, Trash2, WifiOff, X } from 'lucide-react';
import type { YMapEvent } from 'yjs';
import type { Editor } from '@tiptap/react';
import { ApiError, api } from '../../api/client';
import type { ContentType, Page } from '../../api/types';
import { usePage } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Alert, AvatarStack, Button, Checkbox, EmptyState, IconButton, Input, Loading, Menu, Modal, Select, cx } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { CollabSession, type CollabControl, type CollabStatus, type CollabUser } from '../../editor/collab/session';
import { EmojiPicker, TagInput } from '../../components/Pickers';
import { RichEditor } from '../../editor/RichEditor';
import { CodeEditor } from '../../editor/CodeEditor';
import { HtmlView } from '../../editor/HtmlView';
import { renderMarkdownPreview } from '../../editor/markdownPreview';
import { COMMON_LANGUAGES } from '../../editor/render';
import { debounce } from '../../lib/utils';
import type { SuggestionInfo } from '../../editor/suggestionMode';
import { SuggestToggle, SuggestionsPanel } from './Suggestions';

interface Draft {
  title: string;
  content: string;
  contentType: ContentType;
  language: string | null;
  baseVersion: number;
  updatedAt: string;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function PageEdit() {
  const { pageId } = useParams();
  const id = Number(pageId);
  const { data: page, isLoading, error } = usePage(id, { render: false });
  const draftQuery = useQuery({
    queryKey: ['draft', id],
    queryFn: () => api.get<{ draft: Draft | null }>(`/api/v1/pages/${id}/draft`),
    enabled: !!page && page.status === 'current',
    staleTime: 0,
    gcTime: 0,
  });
  const { t } = useI18n();
  const { settings } = useAuth();

  if (isLoading || (page?.status === 'current' && draftQuery.isLoading)) return <Loading />;
  if (error || !page) return <div className="container"><EmptyState title={t('errors.notFoundTitle')} text={(error as Error)?.message} /></div>;
  if (!page.access.edit) return <div className="container"><EmptyState title={t('errors.forbidden')} /></div>;
  // Rich-Text-Seiten werden – wenn eingeschaltet – gemeinsam in Echtzeit bearbeitet
  if (page.contentType === 'richtext' && page.status === 'current' && settings.realtimeCollaboration !== false) {
    return <CollabGate key={page.id} page={page} serverDraft={draftQuery.data?.draft ?? null} />;
  }
  return <EditorScreen key={page.id} page={page} serverDraft={draftQuery.data?.draft ?? null} />;
}

interface CollabBinding {
  session: CollabSession;
  handlers: MutableRefObject<{ onControl?: (message: CollabControl) => void; onStatus?: (status: CollabStatus) => void }>;
  /** Steuernachrichten, die vor dem Anzeigen des Editors eintrafen */
  pending: MutableRefObject<CollabControl[]>;
  restart: () => void;
}

/** Baut die Sitzung auf; ohne Verbindung (z. B. Proxy ohne WebSocket) geht es im Einzelmodus weiter. */
function CollabGate({ page, serverDraft }: { page: Page; serverDraft: Draft | null }) {
  const { t } = useI18n();
  const toast = useToast();
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState<'connecting' | 'ready' | 'failed'>('connecting');
  const [session, setSession] = useState<CollabSession | null>(null);
  const handlers = useRef<CollabBinding['handlers']['current']>({});
  const pending = useRef<CollabControl[]>([]);

  useEffect(() => {
    setPhase('connecting');
    pending.current = [];
    const current = new CollabSession(page.id, {
      onSynced: () => setPhase((p) => (p === 'failed' ? p : 'ready')),
      onControl: (message) => (handlers.current.onControl ? handlers.current.onControl(message) : pending.current.push(message)),
      onStatus: (status) => handlers.current.onStatus?.(status),
    });
    setSession(current);
    const timer = window.setTimeout(() => {
      if (current.synced) return;
      current.destroy();
      setPhase('failed');
    }, 6000);
    return () => {
      window.clearTimeout(timer);
      // erst nach dem Abbau des Editors (die Yjs-Bindung hängt noch am Dokument)
      window.setTimeout(() => current.destroy(), 0);
    };
  }, [page.id, round]);

  useEffect(() => {
    if (phase === 'failed') toast.info(t('collab.unavailable'));
  }, [phase, toast, t]);

  if (phase === 'failed') return <EditorScreen page={page} serverDraft={serverDraft} />;
  if (phase !== 'ready' || !session) return <Loading label={t('collab.connecting')} />;
  return <EditorScreen key={round} page={page} serverDraft={null} collab={{ session, handlers, pending, restart: () => setRound((r) => r + 1) }} />;
}

function EditorScreen({ page, serverDraft, collab }: { page: Page; serverDraft: Draft | null; collab?: CollabBinding }) {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const base = `/s/${encodeURIComponent(page.space.key)}`;
  const isNew = page.status === 'draft';
  const { user } = useAuth();
  const session = collab?.session ?? null;
  // Gemeinsamer Stand (falls schon vorhanden) hat Vorrang vor der veröffentlichten Fassung
  const shared = session && session.meta.get('initialized') === true ? session.meta : null;

  const [restorePrompt, setRestorePrompt] = useState(!!serverDraft && !isNew && !collab);
  const [title, setTitle] = useState(shared ? String(shared.get('title') ?? page.title) : page.title);
  const [content, setContent] = useState(page.content);
  const [contentType] = useState<ContentType>(page.contentType);
  const [language, setLanguage] = useState<string | null>(page.language);
  const [icon, setIcon] = useState<string | null>(shared ? ((shared.get('icon') as string | null) ?? null) : page.icon);
  const [fullWidth, setFullWidth] = useState(shared ? !!shared.get('fullWidth') : page.fullWidth);
  const [baseVersion, setBaseVersion] = useState(shared && typeof shared.get('baseVersion') === 'number' ? (shared.get('baseVersion') as number) : page.version);
  const [collabStatus, setCollabStatus] = useState<CollabStatus>('connected');
  const [peers, setPeers] = useState<CollabUser[]>([]);
  const [outdated, setOutdated] = useState<number | null>(shared && typeof shared.get('outdated') === 'number' ? (shared.get('outdated') as number) : null);
  const initRequest = useRef<number | null>(null);
  const [changeNote, setChangeNote] = useState('');
  const [notify, setNotify] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [conflict, setConflict] = useState<{ version: number; name: string } | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [words, setWords] = useState(0);
  const [outline, setOutline] = useState<{ level: number; text: string; pos: number }[]>([]);
  const [showOutline, setShowOutline] = useState(() => {
    try {
      return localStorage.getItem('knowstead.editor.outline') !== 'off';
    } catch {
      return true;
    }
  });
  const [labels, setLabels] = useState<string[]>(shared && Array.isArray(shared.get('labels')) ? (shared.get('labels') as string[]) : page.labels);
  const [labelsDirty, setLabelsDirty] = useState(false);
  // Vorschlagsmodus: erzwungen für Personen, die nur vorschlagen dürfen, sonst frei umschaltbar
  const suggestForced = contentType === 'richtext' && !!page.editMode?.forced;
  const [suggesting, setSuggesting] = useState(suggestForced);
  const [suggestions, setSuggestions] = useState<SuggestionInfo[]>([]);
  const labelSuggestions = useQuery({
    queryKey: ['labels', page.space.key],
    queryFn: () => api.get<{ name: string; count: number }[]>('/api/v1/labels', { space: page.space.key }),
    staleTime: 60_000,
  });
  const editorRef = useRef<Editor | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ title, content, contentType, language, baseVersion });
  latest.current = { title, content, contentType, language, baseVersion };
  const publishedRef = useRef(false);
  /** läuft gerade die eigene Veröffentlichung? (dann keinen „X hat veröffentlicht“-Hinweis zeigen) */
  const publishingRef = useRef(false);

  // Automatisches Speichern des Entwurfs
  const saveDraft = useMemo(
    () =>
      debounce(async () => {
        setSaveState('saving');
        try {
          const res = await api.put<{ savedAt: string }>(`/api/v1/pages/${page.id}/draft`, latest.current);
          setSavedAt(res.savedAt);
          setSaveState('saved');
        } catch {
          setSaveState('error');
        }
      }, 2000),
    [page.id],
  );
  useEffect(() => () => saveDraft.cancel(), [saveDraft]);

  const markDirty = useCallback(() => {
    setDirty(true);
    // Gemeinsame Bearbeitung: Der Server speichert den Stand laufend – kein persönlicher Entwurf
    if (collab) return;
    setSaveState('idle');
    saveDraft();
  }, [saveDraft, collab]);

  /** Metadaten in den gemeinsamen Stand schreiben (Titel, Symbol, Breite, Stichwörter). */
  const shareMeta = useCallback(
    (key: 'title' | 'icon' | 'fullWidth' | 'labels', value: unknown) => {
      if (session) session.meta.set(key, value);
    },
    [session],
  );

  // Gemeinsamen Inhalt einspielen, wenn der Server diesen Client damit beauftragt
  const runInit = useCallback(async () => {
    const version = initRequest.current;
    const editor = editorRef.current;
    if (version === null || !editor || !session) return;
    initRequest.current = null;
    let source = page;
    if (source.version !== version) {
      try {
        source = await api.get<Page>(`/api/v1/pages/${page.id}`, { render: false });
      } catch {
        /* veröffentlichte Fassung aus dem Speicher verwenden */
      }
    }
    session.doc.transact(() => {
      editor.commands.setContent(source.content, { emitUpdate: false });
      session.meta.set('title', source.title);
      session.meta.set('icon', source.icon);
      session.meta.set('fullWidth', source.fullWidth);
      session.meta.set('labels', source.labels);
      session.meta.set('baseVersion', source.version);
      session.meta.set('initialized', true);
    });
    setTitle(source.title);
    setIcon(source.icon);
    setFullWidth(source.fullWidth);
    setLabels(source.labels);
    setBaseVersion(source.version);
    setContent(source.content);
    updateWords(editor);
  }, [page, session]);

  // Änderungen anderer an Titel & Co. übernehmen, Personen im Dokument anzeigen
  useEffect(() => {
    if (!session) return;
    const onMeta = (event: YMapEvent<unknown>) => {
      if (event.transaction.local) return;
      for (const key of event.keysChanged) {
        const value = session.meta.get(key);
        if (key === 'title' && typeof value === 'string') setTitle(value);
        else if (key === 'icon') setIcon((value as string | null) ?? null);
        else if (key === 'fullWidth') setFullWidth(!!value);
        else if (key === 'labels' && Array.isArray(value)) setLabels(value as string[]);
        else if (key === 'baseVersion' && typeof value === 'number') setBaseVersion(value);
        else if (key === 'outdated') setOutdated(typeof value === 'number' ? value : null);
      }
    };
    session.meta.observe(onMeta);
    const onAwareness = () => setPeers(session.peers());
    session.awareness.on('change', onAwareness);
    onAwareness();
    return () => {
      session.meta.unobserve(onMeta);
      session.awareness.off('change', onAwareness);
    };
  }, [session]);

  // Höhe der (umbrechenden) Kopfzeile für Gliederung und Sprungziele bereitstellen
  useEffect(() => {
    const root = pageRef.current;
    const bar = root?.querySelector<HTMLElement>('.editor-topbar');
    if (!root || !bar || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => root.style.setProperty('--editor-topbar-h', `${bar.offsetHeight}px`));
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // Anwesenheit (bearbeitet gerade)
  useEffect(() => {
    const beat = () => api.post(`/api/v1/pages/${page.id}/presence`, { mode: 'edit' }).catch(() => {});
    void beat();
    const timer = window.setInterval(beat, 30_000);
    return () => {
      window.clearInterval(timer);
      void api.post(`/api/v1/pages/${page.id}/presence`, { mode: 'leave' }).catch(() => {});
    };
  }, [page.id]);

  // Verlassen mit ungespeicherten Änderungen verhindern
  const unsaved = collab ? dirty && collabStatus !== 'connected' && !publishedRef.current : dirty && saveState !== 'saved' && !publishedRef.current;
  // Refs statt Closure-Werte: Nach dem Veröffentlichen wird sofort navigiert, noch bevor neu gerendert wurde.
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => !publishedRef.current && unsavedRef.current && currentLocation.pathname !== nextLocation.pathname,
  );
  const blockerOpen = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || blockerOpen.current) return;
    blockerOpen.current = true;
    const current = blocker;
    void dialogs.confirm({ title: t('common.unsavedChanges'), danger: true, confirmLabel: t('common.confirm') }).then((ok) => {
      blockerOpen.current = false;
      if (ok) {
        publishedRef.current = true;
        current.proceed?.();
      } else current.reset?.();
    });
  }, [blocker, dialogs, t]);
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (unsaved) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [unsaved]);

  const publish = useCallback(
    async (force = false) => {
      saveDraft.cancel();
      const cur = latest.current;
      if (!cur.title.trim()) {
        toast.error(t('editor.titlePlaceholder'));
        return;
      }
      setPublishing(true);
      publishingRef.current = true;
      try {
        // Inhalt direkt aus dem Editor – bei gemeinsamer Bearbeitung enthält er auch die Änderungen der anderen
        const html = cur.contentType === 'richtext' && editorRef.current ? editorRef.current.getHTML() : cur.content;
        const updated = await api.put<Page>(`/api/v1/pages/${page.id}`, {
          title: cur.title,
          content: html,
          contentType: cur.contentType,
          language: cur.language,
          icon,
          fullWidth,
          changeNote,
          minor: !notify,
          baseVersion: force ? undefined : cur.baseVersion,
          collab: collab ? true : undefined,
        });
        publishedRef.current = true;
        setDirty(false);
        if (labelsDirty || (collab && labels.join('\u0000') !== page.labels.join('\u0000'))) await api.put(`/api/v1/pages/${updated.id}/labels`, { labels }).catch((err) => toast.error(err));
        toast.success(t('editor.published', { n: updated.version }));
        qc.setQueryData(['page', updated.id, 'raw'], updated);
        void qc.invalidateQueries({ queryKey: ['page', updated.id] });
        void qc.invalidateQueries({ queryKey: ['tree', page.space.key] });
        void qc.invalidateQueries({ queryKey: ['revisions', updated.id] });
        void qc.invalidateQueries({ queryKey: ['children'] });
        void qc.invalidateQueries({ queryKey: ['drafts'] });
        navigate(updated.isHome ? base : updated.url, { replace: true });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          const details = err.details as { currentVersion: number; updatedBy?: { displayName: string } } | undefined;
          setConflict({ version: details?.currentVersion ?? 0, name: details?.updatedBy?.displayName ?? '?' });
        } else toast.error(err);
      } finally {
        publishingRef.current = false;
        setPublishing(false);
      }
    },
    [saveDraft, toast, t, page.id, page.space.key, page.labels, icon, fullWidth, changeNote, notify, qc, navigate, base, labels, labelsDirty, collab],
  );

  const close = useCallback(() => {
    navigate(isNew ? (page.parentId ? `${base}/p/${page.parentId}` : base) : page.isHome ? base : page.url);
  }, [navigate, isNew, page, base]);

  const discard = async () => {
    if (session) {
      const ok = await dialogs.confirm({ title: t('collab.discardShared'), message: t('collab.discardSharedConfirm'), danger: true, confirmLabel: t('collab.discardShared') });
      if (ok) session.sendControl({ type: 'reset' });
      return;
    }
    const ok = await dialogs.confirm({ title: t('editor.discard'), message: t('editor.discardConfirm'), danger: true, confirmLabel: t('editor.discard') });
    if (!ok) return;
    saveDraft.cancel();
    publishedRef.current = true;
    await api.del(`/api/v1/pages/${page.id}/draft`).catch(() => {});
    void qc.invalidateQueries({ queryKey: ['page', page.id] });
    void qc.invalidateQueries({ queryKey: ['drafts'] });
    if (isNew) {
      void qc.invalidateQueries({ queryKey: ['tree', page.space.key] });
      navigate(page.parentId ? `${base}/p/${page.parentId}` : base, { replace: true });
    } else navigate(page.isHome ? base : page.url, { replace: true });
  };

  // Steuernachrichten der gemeinsamen Bearbeitung
  useEffect(() => {
    if (!collab) return;
    const binding = collab.handlers.current;
    binding.onStatus = setCollabStatus;
    binding.onControl = (message) => {
      switch (message.type) {
        case 'init':
          initRequest.current = Number(message.version);
          void runInit();
          break;
        case 'published':
          if (!publishedRef.current && !publishingRef.current) {
            setDirty(false);
            toast.success(t('collab.publishedBy', { name: String(message.by ?? '?'), n: Number(message.version) }));
          }
          break;
        case 'outdated':
          setOutdated(Number(message.version));
          break;
        case 'restart':
          if (publishedRef.current) break;
          if (message.reason === 'deleted') {
            publishedRef.current = true;
            toast.error(t('collab.deleted'));
            navigate(base, { replace: true });
          } else {
            toast.info(message.reason === 'reset' ? t('collab.resetBy', { name: String(message.by ?? '?') }) : t('collab.updatedExternally'));
            void qc.invalidateQueries({ queryKey: ['page', page.id] }).then(() => collab.restart());
          }
          break;
        case 'closed':
          publishedRef.current = true;
          toast.error(message.reason === 'too_large' ? t('collab.tooLarge') : t('collab.forbidden'));
          navigate(page.isHome ? base : page.url, { replace: true });
          break;
        default:
          break;
      }
    };
    const queued = collab.pending.current.splice(0);
    for (const message of queued) binding.onControl(message);
    return () => {
      binding.onControl = undefined;
      binding.onStatus = undefined;
    };
  }, [collab, runInit, toast, t, navigate, base, qc, page.id, page.isHome, page.url]);

  // Tastenkürzel: Strg+S veröffentlichen, Esc schließen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void publish();
      } else if (e.key === 'Escape' && !document.fullscreenElement && !document.querySelector('.modal-backdrop, .popover, .suggestion-list, .drawio-editor, .whiteboard-editor')) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [publish, close]);

  const restoreDraft = (yes: boolean) => {
    setRestorePrompt(false);
    if (yes && serverDraft) {
      setTitle(serverDraft.title);
      setContent(serverDraft.content);
      setLanguage(serverDraft.language);
      setBaseVersion(serverDraft.baseVersion);
      setDirty(true);
      setSaveState('saved');
      setEditorKey((k) => k + 1);
    } else {
      void api.del(`/api/v1/pages/${page.id}/draft`).catch(() => {});
    }
  };

  const updateWords = (editor: Editor) => {
    const storage = editor.storage as unknown as { characterCount?: { words: () => number } };
    setWords(storage.characterCount?.words() ?? 0);
    const items: { level: number; text: string; pos: number }[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && (node.attrs.level as number) <= 3 && node.textContent.trim()) {
        items.push({ level: node.attrs.level as number, text: node.textContent.trim(), pos });
      }
      return node.type.name !== 'heading';
    });
    setOutline(items);
  };

  const jumpTo = (pos: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    // Fokus ohne eigenes Scrollen – sonst bricht TipTap das sanfte Scrollen im nächsten Frame ab
    editor.chain().setTextSelection(pos + 1).focus(null, { scrollIntoView: false }).run();
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) requestAnimationFrame(() => requestAnimationFrame(() => dom.scrollIntoView({ behavior: 'smooth', block: 'start' })));
  };

  const toggleOutline = () =>
    setShowOutline((v) => {
      try {
        localStorage.setItem('knowstead.editor.outline', v ? 'off' : 'on');
      } catch {
        /* ignorieren */
      }
      return !v;
    });

  const collabStatusLine = collab && (
    <span className="editor-status">
      {collabStatus === 'connected' ? (
        <span className="row gap-xs collab-live" title={t('collab.liveHint')}>
          <Radio size={13} /> {t('collab.live')}
        </span>
      ) : (
        <span className="danger-text row gap-xs">
          <WifiOff size={13} /> {t('collab.offline')}
        </span>
      )}
      {peers.length > 0 && (
        <span className="row gap-xs" title={peers.map((p) => p.name).join(', ')}>
          <AvatarStack users={peers.map((p) => ({ id: p.id, displayName: p.name, avatarColor: p.color }))} size={20} />
        </span>
      )}
      {words > 0 && <span className="faint">· {t('editor.words', { n: words })}</span>}
    </span>
  );

  const status = (
    <span className="editor-status">
      {saveState === 'saving' && (
        <>
          <Loader2 size={13} className="spin" /> {t('editor.draftSaving')}
        </>
      )}
      {saveState === 'saved' && savedAt && (
        <>
          <Check size={13} /> {t('editor.draftSaved', { time: fmt.time(savedAt) })}
        </>
      )}
      {saveState === 'error' && (
        <span className="danger-text row gap-xs">
          <CloudOff size={13} /> {t('editor.draftError')}
        </span>
      )}
      {contentType === 'richtext' && words > 0 && <span className="faint">· {t('editor.words', { n: words })}</span>}
    </span>
  );

  return (
    <div className="editor-page" ref={pageRef}>
      <h1 className="sr-only">
        {t('page.edit')}: {title || t('page.untitled')}
      </h1>
      <div className="editor-topbar">
        <div className="editor-actions">
          <span className="breadcrumbs truncate" style={{ maxWidth: '40%' }}>
            <span>{page.space.icon ?? '📘'}</span>
            <span className="truncate">{page.space.name}</span>
            {page.ancestors.slice(-2).map((a) => (
              <span key={a.id} className="row gap-xs">
                <ChevronRight size={12} />
                <span className="truncate">{a.title}</span>
              </span>
            ))}
          </span>
          {collab ? collabStatusLine : status}
          <span className="spacer" />
          {contentType === 'markdown' && <IconButton icon={Eye} label={t('common.preview')} active={showPreview} onClick={() => setShowPreview((s) => !s)} />}
          {contentType === 'richtext' && <IconButton icon={ListTree} label={t('editor.outline')} active={showOutline} onClick={toggleOutline} />}
          <IconButton
            icon={fullWidth ? Minimize2 : Maximize2}
            label={t('page.fullWidth')}
            active={fullWidth}
            onClick={() => {
              shareMeta('fullWidth', !fullWidth);
              setFullWidth(!fullWidth);
            }}
          />
          <Menu
            placement="bottom-end"
            trigger={(p) => <IconButton {...p} ref={p.ref as never} icon={MoreHorizontal} label={t('common.more')} />}
            items={[
              { label: collab ? t('collab.discardShared') : t('editor.discard'), icon: Trash2, danger: true, onClick: () => void discard() },
              { label: t('editor.settings'), icon: Settings2, hint: `${t(`page.pageTypes.${contentType}`)} · v${baseVersion}`, disabled: true },
            ]}
          />
          {contentType === 'richtext' && user && <SuggestToggle active={suggesting || suggestForced} forced={suggestForced} onChange={setSuggesting} />}
          <Button size="sm" icon={X} onClick={close}>
            {t('editor.close')}
          </Button>
          <Button size="sm" variant="primary" loading={publishing} onClick={() => void publish()}>
            {isNew ? t('editor.publish') : t('editor.update')}
          </Button>
        </div>
        {contentType === 'richtext' && <div ref={setToolbarEl} />}
      </div>

      <div className={cx('editor-stage', contentType === 'richtext' && showOutline && outline.length > 0 && 'with-outline', (fullWidth || contentType !== 'richtext') && 'wide')}>
      {contentType === 'richtext' && showOutline && outline.length > 0 && (
        <aside className="editor-outline" aria-label={t('editor.outline')}>
          <div className="editor-outline-title">{t('editor.outline')}</div>
          <nav>
            {outline.map((h, i) => (
              <button key={`${h.pos}-${i}`} type="button" className={`outline-item level-${h.level}`} onClick={() => jumpTo(h.pos)} title={h.text}>
                {h.text}
              </button>
            ))}
          </nav>
          <div className="editor-outline-stats">
            {t('editor.words', { n: words })} · {t('page.readingTime', { n: Math.max(1, Math.round(words / 200)) })}
          </div>
        </aside>
      )}
      <div className={cx('editor-body', 'editor-sheet', (fullWidth || contentType !== 'richtext') && 'wide')}>
        {collab && outdated !== null && (
          <div className="collab-banner">
            <Alert
              variant="warning"
              title={t('collab.outdatedTitle', { n: outdated })}
              action={
                <div className="row gap-xs">
                  <Button size="sm" onClick={() => void discard()}>
                    {t('collab.discardShared')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => void publish(true)}>
                    {t('editor.conflictOverwrite')}
                  </Button>
                </div>
              }
            >
              {t('collab.outdatedText')}
            </Alert>
          </div>
        )}
        <div className="editor-title-row">
          <EmojiPicker
            value={icon}
            onChange={(v) => {
              setIcon(v);
              shareMeta('icon', v);
              setDirty(true);
            }}
            trigger={(open, ref) => (
              <button ref={ref} type="button" className={cx('icon-picker-btn', !icon && 'empty')} onClick={open} title={t('page.changeIcon')}>
                {icon ?? `＋ ${t('page.addIcon')}`}
              </button>
            )}
          />
          <input
            className="editor-title"
            value={title}
            placeholder={t('editor.titlePlaceholder')}
            autoFocus={!page.title}
            onChange={(e) => {
              setTitle(e.target.value);
              shareMeta('title', e.target.value);
              markDirty();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                editorRef.current?.commands.focus('start');
              }
            }}
          />
        </div>
        <div className="editor-labels">
          <Tag size={14} className="muted" />
          <TagInput
            value={labels}
            onChange={(next) => {
              setLabels(next);
              shareMeta('labels', next);
              setLabelsDirty(true);
              setDirty(true);
              setSaveState('idle');
            }}
            placeholder={t('page.addLabel')}
            suggestions={(labelSuggestions.data ?? []).map((l) => l.name)}
          />
        </div>

        {contentType === 'richtext' && user && (
          <SuggestionsPanel editor={editorRef.current} suggestions={suggestions} canResolve={!!page.editMode?.canResolve} userId={user.id} />
        )}
        {contentType === 'richtext' && toolbarEl && (
          <RichEditor
            key={editorKey}
            initialContent={content}
            pageId={page.id}
            spaceKey={page.space.key}
            autofocus={!!page.title && !page.content}
            collab={session && user ? { session, user: { id: user.id, name: user.displayName, color: user.avatarColor ?? '#2563eb' } } : undefined}
            suggestion={user ? { enabled: suggesting || suggestForced, user: { id: user.id, name: user.displayName } } : undefined}
            onSuggestionsChange={setSuggestions}
            onReady={(editor) => {
              editorRef.current = editor;
              updateWords(editor);
              if (initRequest.current !== null) void runInit();
            }}
            onChange={(html) => {
              setContent(html);
              markDirty();
              if (editorRef.current) updateWords(editorRef.current);
            }}
            toolbarTarget={(toolbar) => createPortal(toolbar, toolbarEl)}
          />
        )}
        {contentType === 'markdown' && (
          <div className={cx('split-editor', !showPreview && 'single')}>
            <CodeEditor
              key={editorKey}
              value={content}
              language="markdown"
              wrap
              autofocus
              onSave={() => void publish()}
              onChange={(v) => {
                setContent(v);
                markDirty();
              }}
            />
            {showPreview && (
              <div className="preview-pane">
                <HtmlView html={renderMarkdownPreview(content)} />
              </div>
            )}
          </div>
        )}
        {contentType === 'code' && (
          <div className="col">
            <div className="row">
              <span className="small muted">{t('editor.language')}</span>
              <Select
                style={{ width: 220 }}
                value={language ?? 'plaintext'}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  markDirty();
                }}
              >
                {COMMON_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </Select>
            </div>
            <CodeEditor
              key={editorKey}
              value={content}
              language={language}
              autofocus
              onSave={() => void publish()}
              onChange={(v) => {
                setContent(v);
                markDirty();
              }}
            />
          </div>
        )}
      </div>

      </div>

      <div className="editor-footer">
        <Input value={changeNote} maxLength={500} placeholder={t('editor.changeNote')} onChange={(e) => setChangeNote(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void publish()} />
        <Checkbox checked={notify} onChange={setNotify} label={notify ? t('editor.notifyWatchers') : t('editor.minorHint')} />
        <Button variant="primary" loading={publishing} onClick={() => void publish()}>
          {isNew ? t('editor.publish') : t('editor.update')}
        </Button>
      </div>

      <Modal
        open={restorePrompt}
        onClose={() => restoreDraft(false)}
        dismissible={false}
        title={t('page.hasDraftBanner')}
        size="sm"
        footer={
          <>
            <Button onClick={() => restoreDraft(false)}>{t('editor.restoreDraftNo')}</Button>
            <Button variant="primary" onClick={() => restoreDraft(true)}>
              {t('editor.restoreDraftYes')}
            </Button>
          </>
        }
      >
        <p>{t('editor.restoreDraft', { date: fmt.dateTime(serverDraft?.updatedAt) })}</p>
      </Modal>

      <Modal
        open={!!conflict}
        onClose={() => setConflict(null)}
        title={t('editor.conflictTitle')}
        size="md"
        footer={
          <>
            <Button
              onClick={async () => {
                await navigator.clipboard.writeText(latest.current.content);
                toast.success(t('common.copied'));
              }}
            >
              {t('editor.conflictCopy')}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setConflict(null);
                void publish(true);
              }}
            >
              {t('editor.conflictOverwrite')}
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                setConflict(null);
                if (session) {
                  session.sendControl({ type: 'reset' });
                  return;
                }
                publishedRef.current = true;
                await api.del(`/api/v1/pages/${page.id}/draft`).catch(() => {});
                await qc.invalidateQueries({ queryKey: ['page', page.id] });
                window.location.reload();
              }}
            >
              {session ? t('collab.discardShared') : t('editor.conflictReload')}
            </Button>
          </>
        }
      >
        <p>{conflict && t('editor.conflictText', { name: conflict.name, version: conflict.version })}</p>
      </Modal>
    </div>
  );
}

import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { useI18n } from '../i18n';
import { cx } from '../components/ui';
import { DocContext } from './context';
import { buildExtensions } from './extensions';

interface Props {
  html: string;
  pageId: number | null;
  spaceKey: string | null;
  depth?: number;
  className?: string;
  onTaskToggle?: (index: number, checked: boolean) => void;
  /** Zitate offener Inline-Kommentare, die markiert werden sollen. */
  highlights?: { id: number; quote: string }[];
  onHighlightClick?: (commentId: number) => void;
  onReady?: (editor: Editor) => void;
}

const highlightKey = new PluginKey<DecorationSet>('commentHighlights');

/** Markiert Textstellen (Inline-Kommentare) über Dekorationen. */
function CommentHighlights(getQuotes: () => { id: number; quote: string }[]) {
  return Extension.create({
    name: 'commentHighlights',
    addProseMirrorPlugins() {
      const build = (doc: import('@tiptap/pm/model').Node) => {
        const quotes = getQuotes().filter((q) => q.quote && q.quote.trim().length > 2);
        if (!quotes.length) return DecorationSet.empty;
        const decorations: Decoration[] = [];
        doc.descendants((node, pos) => {
          if (!node.isTextblock) return true;
          const text = node.textContent;
          for (const q of quotes) {
            const needle = q.quote.trim().slice(0, 300);
            const idx = text.indexOf(needle);
            if (idx < 0) continue;
            // Textposition → Dokumentposition abbilden
            let offset = 0;
            let from = -1;
            let to = -1;
            node.forEach((child, childOffset) => {
              if (!child.isText) {
                offset += child.textContent.length;
                return;
              }
              const len = child.text!.length;
              const start = pos + 1 + childOffset;
              if (from < 0 && idx >= offset && idx < offset + len) from = start + (idx - offset);
              const end = idx + needle.length;
              if (to < 0 && end > offset && end <= offset + len) to = start + (end - offset);
              offset += len;
            });
            if (from >= 0 && to > from) decorations.push(Decoration.inline(from, to, { class: 'inline-comment-mark', 'data-comment-id': String(q.id) }));
          }
          return false;
        });
        return DecorationSet.create(doc, decorations);
      };
      return [
        new Plugin({
          key: highlightKey,
          state: {
            init: (_, state) => build(state.doc),
            apply: (tr, old) => (tr.docChanged || tr.getMeta(highlightKey) ? build(tr.doc) : old),
          },
          props: {
            decorations(state) {
              return highlightKey.getState(state);
            },
          },
        }),
      ];
    },
  });
}

/** Schreibgeschützte Darstellung eines Rich-Text-Dokuments (inkl. Makros). */
export function DocumentView({ html, pageId, spaceKey, depth = 0, className, onTaskToggle, highlights, onHighlightClick, onReady }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const editorRef = useRef<Editor | null>(null);
  const taskRef = useRef(onTaskToggle);
  taskRef.current = onTaskToggle;
  const highlightsRef = useRef(highlights ?? []);
  highlightsRef.current = highlights ?? [];

  const extensions = useMemo(
    () => [
      ...buildExtensions({
        mode: 'view',
        t,
        getEditor: () => editorRef.current,
        onTaskToggle: (i, c) => taskRef.current?.(i, c),
      }),
      CommentHighlights(() => highlightsRef.current),
    ],
    // Erweiterungen nur einmal je Instanz erzeugen
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    editable: false,
    extensions,
    content: html,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    // Nur lesen: kein Eingabefeld für Screenreader, sondern ein benannter Inhaltsbereich
    editorProps: { attributes: { role: 'region', 'aria-label': t('page.contentLabel') } },
  });

  useEffect(() => {
    editorRef.current = editor;
    if (editor) onReady?.(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (editor.getHTML() !== html) editor.commands.setContent(html, { emitUpdate: false });
  }, [editor, html]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dispatch(editor.state.tr.setMeta(highlightKey, true));
  }, [editor, highlights]);

  return (
    <DocContext.Provider value={{ mode: 'view', pageId, spaceKey, depth }}>
      <div
        className={cx('doc readonly', className)}
        onClick={(e) => {
          const target = e.target as HTMLElement;
          const mark = target.closest('.inline-comment-mark') as HTMLElement | null;
          if (mark && onHighlightClick) {
            onHighlightClick(Number(mark.dataset.commentId));
            return;
          }
          const mention = target.closest('.mention') as HTMLElement | null;
          if (mention?.dataset.id) {
            navigate(`/people/${encodeURIComponent(mention.dataset.id)}`);
            return;
          }
          const a = target.closest('a');
          if (!a) return;
          const href = a.getAttribute('href') ?? '';
          if (e.ctrlKey || e.metaKey || e.button !== 0) return;
          if (href.startsWith('#')) {
            e.preventDefault();
            document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' });
            return;
          }
          if (href.startsWith('/') && !href.startsWith('/api/')) {
            e.preventDefault();
            navigate(href);
            return;
          }
          if (/^https?:\/\//i.test(href)) {
            e.preventDefault();
            window.open(href, '_blank', 'noopener,noreferrer');
          }
        }}
      >
        <EditorContent editor={editor} />
      </div>
    </DocContext.Provider>
  );
}

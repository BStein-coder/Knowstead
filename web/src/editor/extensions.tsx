import { createElement } from 'react';
import { Mark, Node, mergeAttributes, type AnyExtension, type Editor, type Range } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details';
import { Mention } from '@tiptap/extension-mention';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Color, TextStyle } from '@tiptap/extension-text-style';
import { Highlight } from '@tiptap/extension-highlight';
import { TextAlign } from '@tiptap/extension-text-align';
import { Image } from '@tiptap/extension-image';
import { Typography } from '@tiptap/extension-typography';
import { Subscript } from '@tiptap/extension-subscript';
import { Superscript } from '@tiptap/extension-superscript';
import { BlockMath, InlineMath } from '@tiptap/extension-mathematics';
import { FileHandler } from '@tiptap/extension-file-handler';
import type { Node as PMNode } from '@tiptap/pm/model';
import { common, createLowlight } from 'lowlight';
import { api } from '../api/client';
import type { MentionCandidate, UserRef } from '../api/types';
import type { MentionScope } from './mentions';
import type { TFn } from '../i18n';
import type { PluginMacro } from '../lib/plugins';
import { HeadingIds } from './headings';
import { CalloutView, CodeBlockView, StatusView } from './views/BasicViews';
import { AttachmentsView, ChangelogView, ChildrenView, IncludePageView, PropertiesReportView, RecentPagesView, TocView } from './views/MacroViews';
import { EmbedView, MermaidView, PluginMacroView } from './views/EmbedViews';
import { ApiDataView } from './views/ApiDataView';
import { GalleryView } from './views/GalleryView';
import { DrawioView, FileCardView, PdfMacroView } from './views/FileViews';
import { WhiteboardView } from './views/WhiteboardView';
import { TaskListView } from './views/TaskListView';
import { PageLinkSuggestion, SlashCommand, suggestionRenderer } from './suggestions';
import { SuggestionDelete, SuggestionInsert, SuggestionMode } from './suggestionMode';

export const lowlight = createLowlight(common);

/* ------------------------------------------------------------------ */
/* Eigene Knoten                                                        */
/* ------------------------------------------------------------------ */

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

type AttrDefault = string | number | boolean | null;

function dataAttrs(defs: Record<string, AttrDefault>) {
  const result: Record<string, { default: AttrDefault; parseHTML: (el: HTMLElement) => AttrDefault; renderHTML: (attrs: Record<string, unknown>) => Record<string, string> }> = {};
  for (const [name, def] of Object.entries(defs)) {
    const attr = `data-${kebab(name)}`;
    result[name] = {
      default: def,
      parseHTML: (el) => {
        const raw = el.getAttribute(attr);
        if (raw === null) return def;
        if (typeof def === 'number') return Number.isFinite(Number(raw)) ? Number(raw) : def;
        if (typeof def === 'boolean') return raw === 'true';
        return raw;
      },
      renderHTML: (attrs) => {
        const v = attrs[name];
        return v === null || v === undefined || v === '' ? {} : { [attr]: String(v) };
      },
    };
  }
  return result;
}

/** Fabrik für Block-Makros (atomare Knoten mit data-*-Attributen). */
function macroNode(name: string, type: string, defs: Record<string, AttrDefault>, view: Parameters<typeof ReactNodeViewRenderer>[0]) {
  return Node.create({
    name,
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    addAttributes() {
      return dataAttrs(defs);
    },
    parseHTML() {
      return [{ tag: `div[data-type="${type}"]` }];
    },
    renderHTML({ HTMLAttributes }) {
      return ['div', mergeAttributes({ 'data-type': type }, HTMLAttributes)];
    },
    addNodeView() {
      return ReactNodeViewRenderer(view);
    },
  });
}

/** Tastenkürzel-Darstellung (<kbd>), z. B. aus importiertem Markdown. */
export const Kbd = Mark.create({
  name: 'kbd',
  excludes: '_',
  parseHTML() {
    return [{ tag: 'kbd' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['kbd', mergeAttributes(HTMLAttributes), 0];
  },
});

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: 'info',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-variant') || 'info',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-variant': String(attrs.variant) }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="callout"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes({ 'data-type': 'callout' }, HTMLAttributes), 0];
  },
  addNodeView() {
    return ReactNodeViewRenderer(CalloutView);
  },
});

export const Status = Node.create({
  name: 'status',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      color: {
        default: 'gray',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-color') || 'gray',
        renderHTML: (attrs: Record<string, unknown>) => ({ 'data-color': String(attrs.color) }),
      },
      text: {
        default: 'OFFEN',
        parseHTML: (el: HTMLElement) => (el.textContent ?? '').trim(),
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-type="status"]' }];
  },
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-type': 'status' }, HTMLAttributes), node.attrs.text as string];
  },
  renderText({ node }) {
    return `[${node.attrs.text as string}]`;
  },
  addNodeView() {
    return ReactNodeViewRenderer(StatusView);
  },
});

export const Mermaid = macroNode('mermaid', 'mermaid', { code: 'flowchart LR\n  A[Start] --> B{?}\n  B -- ✓ --> C[OK]\n  B -- ✗ --> A' }, MermaidView);
export const Toc = macroNode('toc', 'toc', { maxLevel: 3 }, TocView);
export const Children = macroNode('children', 'children', { depth: 1, sort: 'position', excerpt: false, scope: null }, ChildrenView);
export const IncludePage = macroNode('includePage', 'include-page', { pageId: null }, IncludePageView);
export const ChangelogMacro = macroNode('changelog', 'changelog', { pageId: null, limit: 10 }, ChangelogView);
export const RecentPages = macroNode('recentPages', 'recent-pages', { limit: 8, scope: 'space', label: '' }, RecentPagesView);
export const AttachmentsMacro = macroNode('attachmentsMacro', 'attachments', {}, AttachmentsView);
export const PropertiesReport = macroNode('propertiesReport', 'properties-report', { scope: 'children', label: '', columns: '' }, PropertiesReportView);
export const ApiData = macroNode(
  'apiData',
  'api-data',
  { connector: '', path: '', select: '', display: 'table', columns: '', template: '', title: '', limit: 50 },
  ApiDataView,
);
export const Embed = macroNode('embed', 'embed', { src: '', height: 420 }, EmbedView);
export const Gallery = macroNode('gallery', 'gallery', { items: '[]', columns: 3, layout: 'grid' }, GalleryView);
export const FileCard = macroNode('fileCard', 'file', { attachmentId: null, name: '', size: 0, mime: '' }, FileCardView);
export const PdfViewerNode = macroNode('pdfViewer', 'pdf', { attachmentId: null, name: '', height: 600 }, PdfMacroView);
export const Drawio = macroNode('drawio', 'drawio', { xml: '', svg: '', title: '' }, DrawioView);
export const Whiteboard = macroNode('whiteboard', 'whiteboard', { scene: '', svg: '', title: '' }, WhiteboardView);
export const TaskListMacro = macroNode('plannerTasks', 'task-list', { boardId: null, filter: 'open', limit: 10 }, TaskListView);
export const PluginMacroNode = macroNode('pluginMacro', 'plugin-macro', { plugin: '', macro: '', params: '{}' }, PluginMacroView);

/* ------------------------------------------------------------------ */
/* Zusammenstellung                                                     */
/* ------------------------------------------------------------------ */

export interface BuildOptions {
  mode: 'edit' | 'view';
  t: TFn;
  placeholder?: string;
  onFiles?: (editor: Editor, files: File[], pos?: number) => void;
  onUploadImage?: (editor: Editor) => void;
  onUploadFile?: (editor: Editor) => void;
  onTaskToggle?: (index: number, checked: boolean) => void;
  getEditor?: () => Editor | null;
  pluginMacros?: () => PluginMacro[];
  prompt?: (label: string, value: string) => Promise<string | null>;
  /** Reduzierter Umfang (z. B. Kommentare). */
  minimal?: boolean;
  /** Zusammenhang für Erwähnungen: Beteiligte stehen vorn, Personen ohne Zugriff sind gekennzeichnet */
  mentionContext?: MentionScope;
  /** Formatierung im Vorschlagsmodus verhindert */
  onSuggestionBlocked?: () => void;
  /**
   * Gemeinsame Bearbeitung aktiv: Rückgängig/Wiederholen übernimmt Yjs. Die Collaboration-Erweiterungen
   * selbst ergänzt der Editor (editor/collab/extensions.ts) – so bleiben sie aus der Seitenansicht heraus.
   */
  collab?: boolean;
}

function taskIndex(doc: PMNode, target: PMNode): number {
  let index = -1;
  let i = 0;
  doc.descendants((node) => {
    if (index >= 0) return false;
    if (node.type.name === 'taskItem') {
      if (node === target) index = i;
      i++;
    }
    return true;
  });
  return index;
}

export function buildExtensions(options: BuildOptions): AnyExtension[] {
  const { mode, t } = options;
  const edit = mode === 'edit';

  const mention = Mention.configure({
    HTMLAttributes: { class: 'mention' },
    renderText: ({ node }) => `@${(node.attrs.label as string) ?? node.attrs.id}`,
    renderHTML: ({ node }) => [
      'span',
      { 'data-type': 'mention', class: 'mention', 'data-id': node.attrs.id, 'data-label': node.attrs.label },
      `@${(node.attrs.label as string) ?? node.attrs.id}`,
    ],
    suggestion: {
      char: '@',
      items: async ({ query }: { query: string }) => {
        if (!edit) return [];
        try {
          return await api.get<MentionCandidate[]>('/api/v1/users/search', {
            q: query,
            limit: 8,
            task: options.mentionContext?.taskId,
            page: options.mentionContext?.pageId,
          });
        } catch {
          return [];
        }
      },
      render: suggestionRenderer<MentionCandidate>(t('editor.mentionEmpty'), (u) => ({
        id: String(u.id),
        title: u.displayName,
        description: u.access === false ? `@${u.username} · ${t('editor.mentionNoAccess')}` : `@${u.username}`,
        icon: createElement('span', { className: 'avatar', style: { width: 24, height: 24, fontSize: 10, background: u.avatarColor ?? '#64748b' } }, u.displayName.slice(0, 2).toUpperCase()),
      })) as never,
      command: (({ editor, range, props }: { editor: Editor; range: Range; props: UserRef }) => {
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            { type: 'mention', attrs: { id: String(props.id), label: props.displayName } },
            { type: 'text', text: ' ' },
          ])
          .run();
      }) as never,
    },
  });

  const base: AnyExtension[] = [
    StarterKit.configure({
      codeBlock: false,
      heading: { levels: [1, 2, 3, 4] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: 'https',
        HTMLAttributes: { rel: 'noopener noreferrer', target: null },
      },
      trailingNode: edit ? {} : false,
      dropcursor: edit ? { color: 'var(--accent)', width: 2 } : false,
      // Bei gemeinsamer Bearbeitung übernimmt Yjs Rückgängig/Wiederholen (nur eigene Änderungen)
      undoRedo: edit && !options.collab ? {} : false,
    }),
    TextStyle,
    Color,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Subscript,
    Superscript,
    Kbd,
    Typography.configure({ openDoubleQuote: '„', closeDoubleQuote: '“', openSingleQuote: '‚', closeSingleQuote: '‘' }),
    TaskList,
    TaskItem.configure({
      nested: true,
      onReadOnlyChecked: (node, checked) => {
        const editor = options.getEditor?.();
        if (!editor || !options.onTaskToggle) return false;
        const index = taskIndex(editor.state.doc, node);
        if (index < 0) return false;
        options.onTaskToggle(index, checked);
        return true;
      },
    }),
    CodeBlockLowlight.extend({
      addNodeView() {
        return ReactNodeViewRenderer(CodeBlockView);
      },
    }).configure({ lowlight, defaultLanguage: null }),
    mention,
    HeadingIds,
    // Vorschläge werden überall gelesen und angezeigt, erzeugt nur im Editor
    SuggestionInsert,
    SuggestionDelete,
  ];

  if (options.minimal) {
    if (edit) base.push(Placeholder.configure({ placeholder: options.placeholder ?? '' }));
    return base;
  }

  base.push(
    TableKit.configure({ table: { resizable: edit, allowTableNodeSelection: true } }),
    Image.configure({
      inline: false,
      allowBase64: false,
      // Bebilderte Anleitungen haben schnell 20 Screenshots; ohne das lädt der Browser alle sofort.
      HTMLAttributes: { loading: 'lazy', decoding: 'async' },
      resize: { enabled: edit, directions: ['bottom-right', 'bottom-left', 'top-right', 'top-left'], minWidth: 60, alwaysPreserveAspectRatio: true },
    }),
    Details.configure({ persist: edit, HTMLAttributes: { class: 'details' } }),
    DetailsSummary,
    DetailsContent,
    InlineMath.configure({
      katexOptions: { throwOnError: false },
      onClick: edit
        ? (node, pos) => {
            void options.prompt?.(t('macros.mathPrompt'), node.attrs.latex as string).then((latex) => {
              if (latex !== null && latex !== undefined) options.getEditor?.()?.chain().updateInlineMath({ latex, pos }).focus().run();
            });
          }
        : undefined,
    }),
    BlockMath.configure({
      katexOptions: { throwOnError: false, displayMode: true },
      onClick: edit
        ? (node, pos) => {
            void options.prompt?.(t('macros.mathPrompt'), node.attrs.latex as string).then((latex) => {
              if (latex !== null && latex !== undefined) options.getEditor?.()?.chain().updateBlockMath({ latex, pos }).focus().run();
            });
          }
        : undefined,
    }),
    Callout,
    Status,
    Mermaid,
    Toc,
    Children,
    IncludePage,
    ChangelogMacro,
    RecentPages,
    AttachmentsMacro,
    PropertiesReport,
    ApiData,
    Embed,
    Gallery,
    FileCard,
    PdfViewerNode,
    Drawio,
    Whiteboard,
    TaskListMacro,
    PluginMacroNode,
  );

  if (edit) {
    base.push(
      Placeholder.configure({
        placeholder: ({ node }) => (node.type.name === 'heading' ? t('editor.heading', { n: node.attrs.level as number }) : (options.placeholder ?? t('editor.placeholder'))),
        includeChildren: false,
      }),
      CharacterCount,
      SlashCommand({
        t,
        onUploadImage: options.onUploadImage ?? (() => {}),
        onUploadFile: options.onUploadFile ?? (() => {}),
        pluginMacros: options.pluginMacros ?? (() => []),
      }),
      PageLinkSuggestion(t),
      SuggestionMode.configure({ onBlocked: options.onSuggestionBlocked }),
      FileHandler.configure({
        onPaste: (editor, files, pasteContent) => {
          if (pasteContent) return;
          options.onFiles?.(editor, files);
        },
        onDrop: (editor, files, pos) => options.onFiles?.(editor, files, pos),
      }),
    );
  }
  return base;
}

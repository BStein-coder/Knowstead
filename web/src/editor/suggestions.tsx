import { createElement, type ReactNode } from 'react';
import { Extension, type Editor, type Range } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';
import {
  AlertOctagon,
  CalendarDays,
  CheckCircle2,
  ChevronRightSquare,
  Clock,
  Code2,
  FileText,
  FolderTree,
  GitBranch,
  Heading1,
  Heading2,
  Heading3,
  History,
  Image as ImageIcon,
  Images,
  Info,
  KanbanSquare,
  Lightbulb,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  Minus,
  MonitorPlay,
  Paperclip,
  PenTool,
  Pilcrow,
  Plug,
  Presentation,
  Puzzle,
  Quote,
  Sigma,
  Table,
  Table2,
  Tag,
  TriangleAlert,
  type LucideIcon,
  Workflow,
} from 'lucide-react';
import { api } from '../api/client';
import type { PageSummary } from '../api/types';
import { activeLocale, localeTag, type TFn } from '../i18n';
import type { PluginMacro } from '../lib/plugins';
import { SuggestionList, type SuggestionEntry, type SuggestionListProps, type SuggestionListRef } from './SuggestionList';

/* ------------------------------------------------------------------ */
/* Vorschläge (/, @, [[)                                                */
/* ------------------------------------------------------------------ */

export function suggestionRenderer<T>(emptyText: string, toEntry: (item: T) => SuggestionEntry) {
  return () => {
    let component: ReactRenderer<SuggestionListRef, SuggestionListProps> | null = null;
    let unmount: (() => void) | null = null;
    const mapProps = (props: SuggestionProps<T, T>): SuggestionListProps => {
      const entries = props.items.map(toEntry);
      return {
        items: entries,
        emptyText,
        command: (entry) => {
          const item = props.items[entries.indexOf(entry)];
          if (item !== undefined) props.command(item);
        },
      };
    };
    return {
      onStart: (props: SuggestionProps<T, T>) => {
        // Eigene Klasse am Träger: Er wird am Cursor positioniert und muss über Dialogen liegen (siehe editor.css)
        component = new ReactRenderer(SuggestionList, { props: mapProps(props), editor: props.editor, className: 'suggestion-popup' });
        unmount = props.mount(component.element as HTMLElement);
      },
      onUpdate: (props: SuggestionProps<T, T>) => {
        component?.updateProps(mapProps(props));
      },
      onKeyDown: (props: { event: KeyboardEvent }) => {
        if (props.event.key === 'Escape') {
          // Escape schließt nur das Menü (das erledigt die Erweiterung selbst) – ein Dialog dahinter bleibt offen
          props.event.stopPropagation();
          return false;
        }
        return component?.ref?.onKeyDown(props) ?? false;
      },
      onExit: () => {
        unmount?.();
        unmount = null;
        component?.destroy();
        component = null;
      },
    };
  };
}

export interface SlashItem {
  id: string;
  title: string;
  description?: string;
  group: string;
  icon: ReactNode;
  keywords?: string;
  run: (editor: Editor, range: Range) => void;
}

function icon(Icon: LucideIcon): ReactNode {
  return createElement(Icon, { size: 16 });
}

export interface SlashContext {
  t: TFn;
  onUploadImage: (editor: Editor) => void;
  onUploadFile: (editor: Editor) => void;
  pluginMacros: () => PluginMacro[];
}

export function slashItems(ctx: SlashContext): SlashItem[] {
  const { t } = ctx;
  const g = (k: string) => t(`editor.groups.${k}`);
  const block = (editor: Editor, range: Range) => editor.chain().focus().deleteRange(range);
  const insertMacro = (type: string, attrs: Record<string, unknown> = {}) => (editor: Editor, range: Range) =>
    block(editor, range).insertContent({ type, attrs }).run();
  const callout = (variant: string) => (editor: Editor, range: Range) =>
    block(editor, range)
      .insertContent({ type: 'callout', attrs: { variant }, content: [{ type: 'paragraph' }] })
      .run();
  // Heutiges Datum in der Schreibweise der Oberfläche: 05.10.2026 bzw. 05/10/2026
  const today = () => new Intl.DateTimeFormat(localeTag(activeLocale()), { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date());
  const items: SlashItem[] = [
    { id: 'p', title: t('editor.paragraph'), group: g('basic'), icon: icon(Pilcrow), keywords: 'text absatz paragraph', run: (e, r) => block(e, r).setParagraph().run() },
    { id: 'h1', title: t('editor.heading', { n: 1 }), group: g('basic'), icon: icon(Heading1), keywords: 'h1 titel überschrift heading', run: (e, r) => block(e, r).setHeading({ level: 1 }).run() },
    { id: 'h2', title: t('editor.heading', { n: 2 }), group: g('basic'), icon: icon(Heading2), keywords: 'h2 überschrift heading', run: (e, r) => block(e, r).setHeading({ level: 2 }).run() },
    { id: 'h3', title: t('editor.heading', { n: 3 }), group: g('basic'), icon: icon(Heading3), keywords: 'h3 überschrift heading', run: (e, r) => block(e, r).setHeading({ level: 3 }).run() },
    { id: 'quote', title: t('editor.quote'), group: g('basic'), icon: icon(Quote), keywords: 'zitat quote blockquote', run: (e, r) => block(e, r).setBlockquote().run() },
    { id: 'hr', title: t('editor.hr'), group: g('basic'), icon: icon(Minus), keywords: 'linie trenner divider hr', run: (e, r) => block(e, r).setHorizontalRule().run() },
    { id: 'code', title: t('editor.codeBlock'), group: g('basic'), icon: icon(Code2), keywords: 'code quelltext snippet', run: (e, r) => block(e, r).setCodeBlock().run() },
    {
      id: 'date',
      title: t('common.today'),
      description: today(),
      group: g('basic'),
      icon: icon(CalendarDays),
      keywords: 'datum date heute today',
      run: (e, r) => block(e, r).insertContent(today()).run(),
    },
    { id: 'ul', title: t('editor.bulletList'), group: g('lists'), icon: icon(List), keywords: 'liste aufzählung bullet', run: (e, r) => block(e, r).toggleBulletList().run() },
    { id: 'ol', title: t('editor.orderedList'), group: g('lists'), icon: icon(ListOrdered), keywords: 'nummeriert ordered liste', run: (e, r) => block(e, r).toggleOrderedList().run() },
    { id: 'tasks', title: t('editor.taskList'), group: g('lists'), icon: icon(ListChecks), keywords: 'aufgaben todo checkliste tasks', run: (e, r) => block(e, r).toggleTaskList().run() },
    {
      id: 'table',
      title: t('editor.table'),
      group: g('media'),
      icon: icon(Table),
      keywords: 'tabelle table',
      run: (e, r) => block(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
    },
    {
      id: 'image',
      title: t('editor.image'),
      group: g('media'),
      icon: icon(ImageIcon),
      keywords: 'bild image foto grafik',
      run: (e, r) => {
        block(e, r).run();
        ctx.onUploadImage(e);
      },
    },
    {
      id: 'file',
      title: t('editor.file'),
      group: g('media'),
      icon: icon(Paperclip),
      keywords: 'datei anhang file upload',
      run: (e, r) => {
        block(e, r).run();
        ctx.onUploadFile(e);
      },
    },
    {
      id: 'gallery',
      title: t('macros.gallery'),
      description: t('macros.galleryDesc'),
      group: g('media'),
      icon: icon(Images),
      keywords: 'galerie gallery bilder fotos slideshow lightbox',
      run: insertMacro('gallery'),
    },
    {
      id: 'pdf',
      title: t('macros.pdf'),
      description: t('macros.pdfDesc'),
      group: g('media'),
      icon: icon(FileText),
      keywords: 'pdf dokument betrachter viewer powerpoint pptx visio vsdx word excel office vorschau',
      run: insertMacro('pdfViewer'),
    },
    {
      id: 'drawio',
      title: t('macros.drawio'),
      description: t('macros.drawioDesc'),
      group: g('media'),
      icon: icon(PenTool),
      keywords: 'draw.io drawio diagramm zeichnung visio flussdiagramm organigramm netzwerkplan',
      run: insertMacro('drawio'),
    },
    {
      id: 'whiteboard',
      title: t('macros.whiteboard'),
      description: t('macros.whiteboardDesc'),
      group: g('media'),
      icon: icon(Presentation),
      keywords: 'whiteboard excalidraw skizze zeichnen freihand scribble tafel brainstorming',
      run: insertMacro('whiteboard'),
    },
    {
      id: 'tasklist',
      title: t('macros.tasks'),
      description: t('macros.tasksDesc'),
      group: g('macros'),
      icon: icon(KanbanSquare),
      keywords: 'aufgaben planner plan board kanban verantwortlich frist todo projekt',
      run: insertMacro('plannerTasks'),
    },
    { id: 'embed', title: t('macros.embed'), description: t('macros.embedDesc'), group: g('media'), icon: icon(MonitorPlay), keywords: 'einbetten embed video youtube vimeo figma iframe', run: insertMacro('embed') },
    { id: 'info', title: `${t('macros.callout')}: ${t('macros.calloutInfo')}`, description: t('macros.calloutDesc'), group: g('macros'), icon: icon(Info), keywords: 'info hinweis panel callout', run: callout('info') },
    { id: 'note', title: `${t('macros.callout')}: ${t('macros.calloutNote')}`, group: g('macros'), icon: icon(Lightbulb), keywords: 'notiz note panel callout', run: callout('note') },
    { id: 'tip', title: `${t('macros.callout')}: ${t('macros.calloutSuccess')}`, group: g('macros'), icon: icon(CheckCircle2), keywords: 'tipp erfolg success panel', run: callout('success') },
    { id: 'warning', title: `${t('macros.callout')}: ${t('macros.calloutWarning')}`, group: g('macros'), icon: icon(TriangleAlert), keywords: 'warnung achtung warning panel', run: callout('warning') },
    { id: 'error', title: `${t('macros.callout')}: ${t('macros.calloutError')}`, group: g('macros'), icon: icon(AlertOctagon), keywords: 'fehler error gefahr panel', run: callout('error') },
    { id: 'expand', title: t('macros.expand'), description: t('macros.expandDesc'), group: g('macros'), icon: icon(ChevronRightSquare), keywords: 'aufklappen expand details collapse', run: (e, r) => block(e, r).setDetails().run() },
    {
      id: 'status',
      title: t('macros.status'),
      description: t('macros.statusDesc'),
      group: g('macros'),
      icon: icon(Tag),
      keywords: 'status lozenge etikett label',
      run: (e, r) => block(e, r).insertContent({ type: 'status', attrs: { text: t('macros.statusDefault').toUpperCase(), color: 'blue' } }).insertContent(' ').run(),
    },
    { id: 'toc', title: t('macros.toc'), description: t('macros.tocDesc'), group: g('macros'), icon: icon(ListTree), keywords: 'inhaltsverzeichnis toc inhalt', run: insertMacro('toc') },
    { id: 'children', title: t('macros.children'), description: t('macros.childrenDesc'), group: g('macros'), icon: icon(FolderTree), keywords: 'unterseiten children kinder', run: insertMacro('children') },
    { id: 'include', title: t('macros.include'), description: t('macros.includeDesc'), group: g('macros'), icon: icon(GitBranch), keywords: 'einbinden include transclusion', run: insertMacro('includePage') },
    { id: 'changelog', title: t('macros.changelog'), description: t('macros.changelogDesc'), group: g('macros'), icon: icon(History), keywords: 'änderungshistorie changelog versionen historie', run: insertMacro('changelog') },
    { id: 'recent', title: t('macros.recent'), description: t('macros.recentDesc'), group: g('macros'), icon: icon(Clock), keywords: 'zuletzt geändert recent aktualisiert', run: insertMacro('recentPages') },
    { id: 'attachments', title: t('macros.attachments'), description: t('macros.attachmentsDesc'), group: g('macros'), icon: icon(Paperclip), keywords: 'anhänge dateien attachments', run: insertMacro('attachmentsMacro') },
    { id: 'props', title: t('macros.propsReport'), description: t('macros.propsReportDesc'), group: g('macros'), icon: icon(Table2), keywords: 'eigenschaften bericht properties report tabelle', run: insertMacro('propertiesReport') },
    { id: 'api', title: t('macros.apiData'), description: t('macros.apiDataDesc'), group: g('advanced'), icon: icon(Plug), keywords: 'api daten rest json konnektor integration', run: insertMacro('apiData') },
    { id: 'mermaid', title: t('macros.mermaid'), description: t('macros.mermaidDesc'), group: g('advanced'), icon: icon(Workflow), keywords: 'diagramm mermaid flowchart sequenz gantt', run: insertMacro('mermaid') },
    {
      id: 'math',
      title: t('macros.math'),
      description: t('macros.mathDesc'),
      group: g('advanced'),
      icon: icon(Sigma),
      keywords: 'formel mathe latex katex math',
      run: (e, r) => block(e, r).insertBlockMath({ latex: 'E = mc^2' }).run(),
    },
    {
      id: 'math-inline',
      title: t('macros.mathInline'),
      group: g('advanced'),
      icon: icon(Sigma),
      keywords: 'formel inline latex',
      run: (e, r) => block(e, r).insertInlineMath({ latex: 'x^2' }).run(),
    },
  ];
  for (const m of ctx.pluginMacros()) {
    items.push({
      id: `plugin-${m.plugin}-${m.name}`,
      title: m.label,
      description: m.description,
      group: g('plugins'),
      icon: m.icon ?? icon(Puzzle),
      keywords: `${m.name} ${m.plugin} plugin`,
      run: (e, r) => {
        const defaults: Record<string, unknown> = {};
        for (const p of m.params ?? []) if (p.default !== undefined) defaults[p.key] = p.default;
        block(e, r)
          .insertContent({ type: 'pluginMacro', attrs: { plugin: m.plugin, macro: m.name, params: JSON.stringify(defaults) } })
          .run();
      },
    });
  }
  return items;
}

function filterSlash(items: SlashItem[], query: string): SlashItem[] {
  const q = query.toLowerCase().trim();
  if (!q) return items;
  return items.filter((i) => `${i.title} ${i.description ?? ''} ${i.keywords ?? ''}`.toLowerCase().includes(q)).slice(0, 30);
}

export function SlashCommand(ctx: SlashContext) {
  return Extension.create({
    name: 'slashCommand',
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem, SlashItem>({
          editor: this.editor,
          pluginKey: new PluginKey('slashCommand'),
          char: '/',
          allowSpaces: false,
          items: ({ query }) => filterSlash(slashItems(ctx), query),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: suggestionRenderer<SlashItem>(ctx.t('editor.slashEmpty'), (item) => ({
            id: item.id,
            title: item.title,
            description: item.description,
            icon: item.icon,
            group: item.group,
          })),
        }),
      ];
    },
  });
}

export function PageLinkSuggestion(t: TFn) {
  return Extension.create({
    name: 'pageLinkSuggestion',
    addProseMirrorPlugins() {
      return [
        Suggestion<PageSummary, PageSummary>({
          editor: this.editor,
          pluginKey: new PluginKey('pageLink'),
          char: '[[',
          allowSpaces: true,
          allowedPrefixes: null,
          items: async ({ query }) => {
            if (!query.trim()) return [];
            try {
              const res = await api.get<{ pages: PageSummary[] }>('/api/v1/search/quick', { q: query, limit: 8 });
              return res.pages;
            } catch {
              return [];
            }
          },
          command: ({ editor, range, props }) => {
            editor
              .chain()
              .focus()
              .deleteRange(range)
              .insertContent([
                { type: 'text', text: props.title, marks: [{ type: 'link', attrs: { href: props.url } }] },
                { type: 'text', text: ' ' },
              ])
              .run();
          },
          render: suggestionRenderer<PageSummary>(t('editor.pageLinkEmpty'), (p) => ({
            id: String(p.id),
            title: p.title,
            description: [p.spaceName, ...(p.path ?? [])].join(' › '),
            icon: p.icon ?? createElement(FileText, { size: 16 }),
          })),
        }),
      ];
    },
  });
}

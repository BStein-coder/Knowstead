import { useState } from 'react';
import { useEditorState, type Editor } from '@tiptap/react';
import {
  ClipboardList,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Baseline,
  Bold,
  Code,
  Code2,
  Highlighter,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Paperclip,
  Plus,
  Quote,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Subscript as SubIcon,
  Superscript as SupIcon,
  Table,
  Underline,
  Undo2,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { IconButton, Menu, Popover, type MenuEntry } from '../components/ui';
import { usePluginRegistry } from '../lib/plugins';
import { AiEditorMenu } from '../lib/ai';
import { ClipboardPanel, useAddClip } from '../components/Clipboard';
import { DOMSerializer } from '@tiptap/pm/model';
import { LinkEditor } from './LinkEditor';
import { slashItems } from './suggestions';

export const TEXT_COLORS = ['#111827', '#6b7280', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#2563eb', '#7c3aed', '#db2777'];
export const HIGHLIGHT_COLORS = ['#fef08a', '#bbf7d0', '#bfdbfe', '#fbcfe8', '#fed7aa', '#ddd6fe', '#e5e7eb'];

export function ColorMenu({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="color-menu" onMouseDown={(e) => e.preventDefault()}>
      <div className="color-menu-title">{t('editor.color')}</div>
      <div className="color-grid">
        {TEXT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            style={{ color: c, background: 'var(--bg)' }}
            title={c}
            onClick={() => {
              editor.chain().focus().setColor(c).run();
              onClose();
            }}
          >
            A
          </button>
        ))}
      </div>
      <div className="color-menu-title">{t('editor.highlight')}</div>
      <div className="color-grid">
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            style={{ background: c }}
            title={c}
            onClick={() => {
              editor.chain().focus().setHighlight({ color: c }).run();
              onClose();
            }}
          />
        ))}
      </div>
      <button
        type="button"
        className="btn btn-sm btn-ghost btn-block"
        onClick={() => {
          editor.chain().focus().unsetColor().unsetHighlight().run();
          onClose();
        }}
      >
        {t('common.reset')}
      </button>
    </div>
  );
}

interface ToolbarProps {
  editor: Editor;
  onUploadImage: () => void;
  onUploadFile: () => void;
  /** Für KI-Anfragen und Herkunftsangaben der Zwischenablage */
  pageId?: number | null;
}

export function Toolbar({ editor, onUploadImage, onUploadFile, pageId }: ToolbarProps) {
  const { t } = useI18n();
  const registry = usePluginRegistry();
  const [colorAnchor, setColorAnchor] = useState<HTMLElement | null>(null);
  const [colorOpen, setColorOpen] = useState(false);
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
      sub: e.isActive('subscript'),
      sup: e.isActive('superscript'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      task: e.isActive('taskList'),
      quote: e.isActive('blockquote'),
      codeBlock: e.isActive('codeBlock'),
      table: e.isActive('table'),
      h: [1, 2, 3, 4].find((l) => e.isActive('heading', { level: l })) ?? 0,
      align: (['center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const blockValue = s.codeBlock ? 'code' : s.h ? `h${s.h}` : 'p';
  const setBlock = (v: string) => {
    const c = editor.chain().focus();
    if (v === 'p') c.setParagraph().run();
    else if (v === 'code') c.setCodeBlock().run();
    else c.setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 }).run();
  };

  const AlignIcon = s.align === 'center' ? AlignCenter : s.align === 'right' ? AlignRight : s.align === 'justify' ? AlignJustify : AlignLeft;

  const insertItems: MenuEntry[] = (() => {
    const items = slashItems({ t, onUploadImage: () => onUploadImage(), onUploadFile: () => onUploadFile(), pluginMacros: () => registry.macros });
    const entries: MenuEntry[] = [];
    let group = '';
    for (const item of items) {
      if (['p', 'h1', 'h2', 'h3', 'ul', 'ol', 'tasks', 'quote', 'code', 'hr'].includes(item.id)) continue;
      if (item.group !== group) {
        entries.push({ heading: item.group });
        group = item.group;
      }
      entries.push({
        label: item.title,
        onClick: () => {
          const pos = editor.state.selection.from;
          item.run(editor, { from: pos, to: pos });
        },
      });
    }
    return entries;
  })();

  const tableItems: MenuEntry[] = [
    { label: t('editor.tableAddRowBefore'), onClick: () => editor.chain().focus().addRowBefore().run() },
    { label: t('editor.tableAddRowAfter'), onClick: () => editor.chain().focus().addRowAfter().run() },
    { label: t('editor.tableAddColBefore'), onClick: () => editor.chain().focus().addColumnBefore().run() },
    { label: t('editor.tableAddColAfter'), onClick: () => editor.chain().focus().addColumnAfter().run() },
    { separator: true },
    { label: t('editor.tableHeaderRow'), onClick: () => editor.chain().focus().toggleHeaderRow().run() },
    { label: t('editor.tableHeaderCol'), onClick: () => editor.chain().focus().toggleHeaderColumn().run() },
    { label: t('editor.tableMerge'), onClick: () => editor.chain().focus().mergeCells().run() },
    { label: t('editor.tableSplit'), onClick: () => editor.chain().focus().splitCell().run() },
    { separator: true },
    { label: t('editor.tableDeleteRow'), onClick: () => editor.chain().focus().deleteRow().run(), danger: true },
    { label: t('editor.tableDeleteCol'), onClick: () => editor.chain().focus().deleteColumn().run(), danger: true },
    { label: t('editor.tableDelete'), onClick: () => editor.chain().focus().deleteTable().run(), danger: true },
  ];

  return (
    <div className="toolbar" role="toolbar" aria-label={t('a11y.formatting')}>
      <IconButton icon={Undo2} label={t('editor.undo')} disabled={!s.canUndo} onClick={() => editor.chain().focus().undo().run()} />
      <IconButton icon={Redo2} label={t('editor.redo')} disabled={!s.canRedo} onClick={() => editor.chain().focus().redo().run()} />
      <span className="toolbar-sep" />
      <select className="input select toolbar-select" value={blockValue} onChange={(e) => setBlock(e.target.value)} aria-label={t('a11y.blockFormat')}>
        <option value="p">{t('editor.paragraph')}</option>
        {[1, 2, 3, 4].map((l) => (
          <option key={l} value={`h${l}`}>
            {t('editor.heading', { n: l })}
          </option>
        ))}
        <option value="code">{t('editor.codeBlock')}</option>
      </select>
      <span className="toolbar-sep" />
      <IconButton icon={Bold} label={t('editor.bold')} active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <IconButton icon={Italic} label={t('editor.italic')} active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <IconButton icon={Underline} label={t('editor.underline')} active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <IconButton icon={Strikethrough} label={t('editor.strike')} active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <IconButton icon={Code} label={t('editor.code')} active={s.code} onClick={() => editor.chain().focus().toggleCode().run()} />
      <IconButton ref={setColorAnchor} icon={Baseline} label={t('editor.color')} onClick={() => setColorOpen(true)} />
      <Popover anchor={colorAnchor} open={colorOpen} onClose={() => setColorOpen(false)}>
        <ColorMenu editor={editor} onClose={() => setColorOpen(false)} />
      </Popover>
      <IconButton icon={Highlighter} label={t('editor.highlight')} onClick={() => editor.chain().focus().toggleHighlight({ color: HIGHLIGHT_COLORS[0] }).run()} />
      <IconButton ref={setLinkAnchor} icon={LinkIcon} label={t('editor.link')} active={s.link} onClick={() => setLinkOpen(true)} />
      <Popover anchor={linkAnchor} open={linkOpen} onClose={() => setLinkOpen(false)}>
        {linkOpen && <LinkEditor editor={editor} onClose={() => setLinkOpen(false)} />}
      </Popover>
      <IconButton icon={SubIcon} label={t('editor.subscript')} active={s.sub} onClick={() => editor.chain().focus().toggleSubscript().run()} />
      <IconButton icon={SupIcon} label={t('editor.superscript')} active={s.sup} onClick={() => editor.chain().focus().toggleSuperscript().run()} />
      <span className="toolbar-sep" />
      <IconButton icon={List} label={t('editor.bulletList')} active={s.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
      <IconButton icon={ListOrdered} label={t('editor.orderedList')} active={s.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      <IconButton icon={ListChecks} label={t('editor.taskList')} active={s.task} onClick={() => editor.chain().focus().toggleTaskList().run()} />
      <Menu
        placement="bottom-start"
        trigger={(p) => <IconButton {...p} ref={p.ref as never} icon={AlignIcon} label={t('editor.alignLeft')} />}
        items={[
          { label: t('editor.alignLeft'), icon: AlignLeft, checked: s.align === 'left', onClick: () => editor.chain().focus().setTextAlign('left').run() },
          { label: t('editor.alignCenter'), icon: AlignCenter, checked: s.align === 'center', onClick: () => editor.chain().focus().setTextAlign('center').run() },
          { label: t('editor.alignRight'), icon: AlignRight, checked: s.align === 'right', onClick: () => editor.chain().focus().setTextAlign('right').run() },
          { label: t('editor.alignJustify'), icon: AlignJustify, checked: s.align === 'justify', onClick: () => editor.chain().focus().setTextAlign('justify').run() },
        ]}
      />
      <span className="toolbar-sep" />
      <IconButton icon={Quote} label={t('editor.quote')} active={s.quote} onClick={() => editor.chain().focus().toggleBlockquote().run()} />
      <IconButton icon={Code2} label={t('editor.codeBlock')} active={s.codeBlock} onClick={() => editor.chain().focus().toggleCodeBlock().run()} />
      <IconButton icon={Minus} label={t('editor.hr')} onClick={() => editor.chain().focus().setHorizontalRule().run()} />
      {s.table ? (
        <Menu placement="bottom-start" trigger={(p) => <IconButton {...p} ref={p.ref as never} icon={Table} label={t('editor.table')} active />} items={tableItems} />
      ) : (
        <IconButton icon={Table} label={t('editor.table')} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
      )}
      <IconButton icon={ImageIcon} label={t('editor.image')} onClick={onUploadImage} />
      <IconButton icon={Paperclip} label={t('editor.file')} onClick={onUploadFile} />
      <span className="toolbar-sep" />
      <Menu
        placement="bottom-start"
        className="menu-scroll"
        trigger={(p) => (
          <button {...p} ref={p.ref as never} type="button" className="toolbar-btn-text">
            <Plus size={15} />
            {t('editor.insert')}
          </button>
        )}
        items={insertItems}
      />
      <AiEditorMenu editor={editor} pageId={pageId} />
      <EditorClipboard editor={editor} pageId={pageId} />
      <span className="spacer" />
      <IconButton icon={RemoveFormatting} label={t('editor.clearFormat')} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()} />
    </div>
  );
}

/** Zwischenablage im Editor: Markierung ablegen, Einträge einfügen. */
function EditorClipboard({ editor, pageId }: { editor: Editor; pageId?: number | null }) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const addClip = useAddClip();

  const capture = () => {
    const { from, to, empty } = editor.state.selection;
    if (empty) return;
    const slice = editor.state.doc.slice(from, to);
    const div = document.createElement('div');
    div.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(slice.content));
    addClip.mutate({ content: div.innerHTML, kind: 'html', sourcePageId: pageId ?? null });
  };

  return (
    <>
      <IconButton ref={setAnchor} icon={ClipboardList} label={t('clipboard.title')} active={open} onClick={() => setOpen((o) => !o)} />
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom-start">
        {open && (
          <ClipboardPanel
            onCapture={editor.state.selection.empty ? undefined : capture}
            onInsert={(clip) => {
              const content = clip.kind === 'html' ? clip.content : clip.kind === 'link' ? `<p><a href="${clip.content.replace(/"/g, '&quot;')}">${clip.title.replace(/</g, '&lt;')}</a></p>` : `<p>${clip.content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`;
              editor.chain().focus().insertContent(content).run();
              setOpen(false);
            }}
          />
        )}
      </Popover>
    </>
  );
}

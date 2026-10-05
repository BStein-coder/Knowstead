import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { NodeSelection } from '@tiptap/pm/state';
import { Baseline, Bold, Code, Italic, Link as LinkIcon, Strikethrough, Underline } from 'lucide-react';
import { uploadWithProgress } from '../api/client';
import type { Attachment } from '../api/types';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';
import { useDialogs } from '../lib/dialogs';
import { usePluginRegistry } from '../lib/plugins';
import { IconButton, Popover, cx } from '../components/ui';
import { DocContext } from './context';
import { buildExtensions } from './extensions';
import { Toolbar, ColorMenu } from './Toolbar';
import { LinkEditor } from './LinkEditor';
import type { CollabSession, CollabUser } from './collab/session';
import { collabExtensions } from './collab/extensions';
import { collectSuggestions, type SuggestionInfo } from './suggestionMode';

interface Props {
  initialContent: string;
  pageId: number | null;
  spaceKey: string | null;
  onChange: (html: string) => void;
  onReady?: (editor: Editor) => void;
  /** Container für die Werkzeugleiste (z. B. in der sticky Kopfzeile). */
  toolbarTarget?: (toolbar: React.ReactNode) => React.ReactNode;
  className?: string;
  autofocus?: boolean;
  /** Gemeinsame Bearbeitung – der Inhalt kommt dann aus der Sitzung statt aus initialContent */
  collab?: { session: CollabSession; user: CollabUser };
  /** Vorschlagsmodus: Änderungen als Vorschläge dieser Person */
  suggestion?: { enabled: boolean; user: { id: number; name: string } };
  onSuggestionsChange?: (suggestions: SuggestionInfo[]) => void;
}

function BubbleButtons({ editor, onColor, onLink }: { editor: Editor; onColor: () => void; onLink: () => void }) {
  const { t } = useI18n();
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      code: e.isActive('code'),
      link: e.isActive('link'),
    }),
  });
  return (
    <>
      <IconButton icon={Bold} label={t('editor.bold')} active={s.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
      <IconButton icon={Italic} label={t('editor.italic')} active={s.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
      <IconButton icon={Underline} label={t('editor.underline')} active={s.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
      <IconButton icon={Strikethrough} label={t('editor.strike')} active={s.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
      <IconButton icon={Code} label={t('editor.code')} active={s.code} onClick={() => editor.chain().focus().toggleCode().run()} />
      <span className="toolbar-sep" />
      <IconButton icon={Baseline} label={t('editor.color')} onClick={onColor} />
      <IconButton icon={LinkIcon} label={t('editor.link')} active={s.link} onClick={onLink} />
    </>
  );
}

/** Vollwertiger Rich-Text-Editor mit Werkzeugleiste, Makros, Uploads und Vorschlägen. */
export function RichEditor({ initialContent, pageId, spaceKey, onChange, onReady, toolbarTarget, className, autofocus, collab, suggestion, onSuggestionsChange }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const registry = usePluginRegistry();
  const editorRef = useRef<Editor | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const macrosRef = useRef(registry.macros);
  macrosRef.current = registry.macros;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSuggestionsRef = useRef(onSuggestionsChange);
  onSuggestionsRef.current = onSuggestionsChange;
  const blockedAt = useRef(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [bubbleColorOpen, setBubbleColorOpen] = useState(false);
  const [bubbleEl, setBubbleEl] = useState<HTMLElement | null>(null);

  const upload = useCallback(
    async (editor: Editor, files: File[], pos?: number) => {
      if (!pageId) {
        toast.error(t('editor.uploadFailed'));
        return;
      }
      let at = pos;
      for (const file of files) {
        const form = new FormData();
        form.append('file', file, file.name);
        try {
          const [att] = await uploadWithProgress<Attachment[]>(`/api/v1/pages/${pageId}/attachments`, form);
          // Bilder inline, PDFs direkt als Betrachter, alle anderen Dateien als Karte mit Download/Vorschau.
          const node = att.isImage
            ? { type: 'image', attrs: { src: att.url, alt: att.filename, title: att.filename } }
            : att.preview === 'pdf'
              ? { type: 'pdfViewer', attrs: { attachmentId: att.id, name: att.filename, height: 600 } }
              : { type: 'fileCard', attrs: { attachmentId: att.id, name: att.filename, size: att.size, mime: att.mimeType } };
          const { selection } = editor.state;
          const chain = editor.chain().focus();
          if (at !== undefined) chain.insertContentAt(at, node).run();
          // Ein gerade eingefügter Block ist ausgewählt – die nächste Datei gehört dahinter, nicht an seine Stelle.
          else if (selection instanceof NodeSelection) chain.insertContentAt(selection.to, node).run();
          else chain.insertContent(node).run();
          if (at !== undefined) {
            const after = editor.state.selection;
            at = after instanceof NodeSelection ? after.to : after.$from.depth > 0 ? after.$from.before() : after.from;
          }
        } catch (err) {
          toast.error(err);
        }
      }
    },
    [pageId, toast, t],
  );

  const extensions = useMemo(
    () => [
      ...buildExtensions({
        mode: 'edit',
        t,
        getEditor: () => editorRef.current,
        onFiles: (editor, files, pos) => void upload(editor, files, pos),
        onUploadImage: () => imageInput.current?.click(),
        onUploadFile: () => fileInput.current?.click(),
        pluginMacros: () => macrosRef.current,
        prompt: (label, value) => dialogs.prompt({ title: label, defaultValue: value }),
        mentionContext: pageId ? { pageId } : undefined,
        collab: !!collab,
        onSuggestionBlocked: () => {
          if (Date.now() - blockedAt.current < 4000) return;
          blockedAt.current = Date.now();
          toast.info(t('suggest.blocked'));
        },
      }),
      ...(collab ? collabExtensions(collab.session, collab.user) : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    extensions,
    content: collab ? undefined : initialContent,
    autofocus: autofocus ? 'start' : false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(e.getHTML());
      onSuggestionsRef.current?.(collectSuggestions(e.state.doc));
    },
    editorProps: {
      // Eigene Attribute ersetzen die Vorgaben von TipTap – Rolle deshalb ausdrücklich setzen
      attributes: { role: 'textbox', spellcheck: 'true', 'aria-label': t('page.contentLabel'), 'aria-multiline': 'true' },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
          event.preventDefault();
          setLinkOpen(true);
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    if (editor) {
      onReady?.(editor);
      onSuggestionsRef.current?.(collectSuggestions(editor.state.doc));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  const suggestEnabled = !!suggestion?.enabled;
  const suggestUserId = suggestion?.user.id ?? 0;
  const suggestUserName = suggestion?.user.name ?? '';
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.commands.setSuggestionMode(suggestEnabled, suggestUserId ? { id: suggestUserId, name: suggestUserName } : null);
  }, [editor, suggestEnabled, suggestUserId, suggestUserName]);

  if (!editor) return null;

  const pick = (input: HTMLInputElement | null) => {
    const files = input?.files ? [...input.files] : [];
    if (input) input.value = '';
    if (files.length) void upload(editor, files);
  };

  const toolbar = <Toolbar editor={editor} pageId={pageId} onUploadImage={() => imageInput.current?.click()} onUploadFile={() => fileInput.current?.click()} />;

  return (
    <DocContext.Provider value={{ mode: 'edit', pageId, spaceKey, depth: 0 }}>
      {toolbarTarget ? toolbarTarget(toolbar) : toolbar}
      <div className={cx('doc editing', className)}>
        <EditorContent editor={editor} />
      </div>
      <BubbleMenu
        editor={editor}
        options={{ placement: 'top', offset: 8 }}
        shouldShow={({ editor: e, state }) => {
          const { selection } = state;
          if (selection.empty || selection instanceof NodeSelection) return false;
          if (e.isActive('codeBlock') || e.isActive('image')) return false;
          return e.isEditable;
        }}
      >
        <div className="bubble-menu" ref={setBubbleEl}>
          <BubbleButtons editor={editor} onColor={() => setBubbleColorOpen(true)} onLink={() => setLinkOpen(true)} />
        </div>
      </BubbleMenu>
      <Popover anchor={bubbleEl} open={bubbleColorOpen} onClose={() => setBubbleColorOpen(false)} placement="bottom-start">
        <ColorMenu editor={editor} onClose={() => setBubbleColorOpen(false)} />
      </Popover>
      <Popover
        anchor={bubbleEl && !editor.state.selection.empty ? bubbleEl : (editor.view.dom as HTMLElement)}
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        placement="bottom-start"
      >
        {linkOpen && <LinkEditor editor={editor} onClose={() => setLinkOpen(false)} />}
      </Popover>
      <input ref={imageInput} type="file" accept="image/*" multiple hidden onChange={(e) => pick(e.currentTarget)} />
      <input ref={fileInput} type="file" multiple hidden onChange={(e) => pick(e.currentTarget)} />
    </DocContext.Provider>
  );
}

import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { ExternalLink, FileText, Unlink } from 'lucide-react';
import { useI18n } from '../i18n';
import { Button, Input } from '../components/ui';
import { usePageSearch } from '../components/Pickers';

/** Popover-Inhalt zum Setzen/Bearbeiten eines Links (extern oder interne Seite). */
export function LinkEditor({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const { t } = useI18n();
  const current = (editor.getAttributes('link').href as string | undefined) ?? '';
  const [value, setValue] = useState(current);
  const [newTab, setNewTab] = useState((editor.getAttributes('link').target as string | undefined) === '_blank');
  const isUrl = /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(value.trim()) || /^[\w-]+(\.[\w-]+)+/.test(value.trim());
  const { data: pages } = usePageSearch(isUrl ? '' : value);

  useEffect(() => setValue(current), [current]);

  const apply = (href: string, text?: string) => {
    let url = href.trim();
    if (!url) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      onClose();
      return;
    }
    if (!/^(https?:\/\/|mailto:|tel:|\/|#)/i.test(url)) url = `https://${url}`;
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive('link')) {
      chain.insertContent({ type: 'text', text: text ?? url, marks: [{ type: 'link', attrs: { href: url, target: newTab ? '_blank' : null } }] }).run();
    } else {
      chain.extendMarkRange('link').setLink({ href: url, target: newTab ? '_blank' : null }).run();
    }
    onClose();
  };

  return (
    <div className="link-editor" onMouseDown={(e) => e.stopPropagation()}>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          apply(value);
        }}
      >
        <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('editor.linkUrl')} />
        <Button type="submit" variant="primary" size="sm">
          {t('common.ok')}
        </Button>
      </form>
      <label className="checkbox-row small">
        <input type="checkbox" checked={newTab} onChange={(e) => setNewTab(e.target.checked)} />
        <span>{t('editor.openInNewTab')}</span>
      </label>
      {!isUrl && value.trim() && (
        <div className="picker-list" style={{ maxHeight: 220, padding: 0 }}>
          <div className="suggestion-group">{t('editor.linkSearchPages')}</div>
          {(pages ?? []).map((p) => (
            <button key={p.id} type="button" className="picker-item" onClick={() => apply(p.url, p.title)}>
              <span>{p.icon ?? <FileText size={14} />}</span>
              <span className="grow">
                <div className="truncate">{p.title}</div>
                <div className="picker-sub truncate">{p.spaceName}</div>
              </span>
            </button>
          ))}
          <button type="button" className="picker-item" onClick={() => apply(value)}>
            <ExternalLink size={14} />
            <span className="grow truncate">
              {t('editor.linkExternal')}: {value}
            </span>
          </button>
        </div>
      )}
      {current && (
        <div className="row">
          <a className="small truncate grow" href={current} target="_blank" rel="noopener noreferrer">
            {current}
          </a>
          <Button size="sm" variant="ghost" icon={Unlink} onClick={() => apply('')}>
            {t('editor.unlink')}
          </Button>
        </div>
      )}
    </div>
  );
}

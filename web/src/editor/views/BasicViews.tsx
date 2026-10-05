import { useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { AlertOctagon, CheckCircle2, Copy, Info, Lightbulb, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Input, Popover, cx } from '../../components/ui';
import { COMMON_LANGUAGES } from '../render';

/* ------------------------------ Hinweisbox ------------------------------ */

export const CALLOUT_VARIANTS: { value: string; icon: LucideIcon; labelKey: string }[] = [
  { value: 'info', icon: Info, labelKey: 'macros.calloutInfo' },
  { value: 'note', icon: Lightbulb, labelKey: 'macros.calloutNote' },
  { value: 'success', icon: CheckCircle2, labelKey: 'macros.calloutSuccess' },
  { value: 'warning', icon: TriangleAlert, labelKey: 'macros.calloutWarning' },
  { value: 'error', icon: AlertOctagon, labelKey: 'macros.calloutError' },
];

export function CalloutView(props: NodeViewProps) {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const variant = CALLOUT_VARIANTS.find((v) => v.value === props.node.attrs.variant) ?? CALLOUT_VARIANTS[0];
  const Icon = variant.icon;
  const editable = props.editor.isEditable;
  return (
    <NodeViewWrapper className="callout" data-variant={variant.value}>
      {editable ? (
        <button ref={setAnchor} type="button" className="callout-icon" contentEditable={false} onClick={() => setOpen(true)} title={t(variant.labelKey)}>
          <Icon size={18} />
        </button>
      ) : (
        <span className="callout-icon" contentEditable={false}>
          <Icon size={18} />
        </span>
      )}
      <NodeViewContent className="callout-content" />
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} className="menu">
        {CALLOUT_VARIANTS.map((v) => {
          const VIcon = v.icon;
          return (
            <button
              key={v.value}
              type="button"
              className="menu-item"
              onClick={() => {
                props.updateAttributes({ variant: v.value });
                setOpen(false);
              }}
            >
              <span className="menu-icon">
                <VIcon size={15} />
              </span>
              <span className="menu-label">{t(v.labelKey)}</span>
            </button>
          );
        })}
      </Popover>
    </NodeViewWrapper>
  );
}

/* ------------------------------ Status ------------------------------ */

export const STATUS_COLORS = ['gray', 'blue', 'green', 'yellow', 'red', 'purple'] as const;

export function StatusView(props: NodeViewProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const { text, color } = props.node.attrs as { text: string; color: string };
  const editable = props.editor.isEditable;
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      {editable ? (
        <button ref={setAnchor} type="button" className="status-lozenge" data-color={color} contentEditable={false} onClick={() => setOpen(true)}>
          {text || '…'}
        </button>
      ) : (
        <span className="status-lozenge" data-color={color}>
          {text}
        </span>
      )}
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)}>
        <div style={{ padding: '0.6rem', width: 240 }} className="col">
          <Input
            autoFocus
            value={text}
            maxLength={40}
            onChange={(e) => props.updateAttributes({ text: e.target.value.toUpperCase() })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape') {
                e.preventDefault();
                setOpen(false);
                props.editor.commands.focus();
              }
            }}
          />
          <div className="row gap-xs">
            {STATUS_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={cx('status-lozenge', c === color && 'active')}
                data-color={c}
                style={{ outline: c === color ? '2px solid var(--accent)' : undefined, outlineOffset: 1 }}
                onClick={() => props.updateAttributes({ color: c })}
              >
                {c === color ? '✓' : ' '}
              </button>
            ))}
          </div>
        </div>
      </Popover>
    </NodeViewWrapper>
  );
}

/* ------------------------------ Codeblock ------------------------------ */

export function CodeBlockView(props: NodeViewProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const language = (props.node.attrs.language as string | null) ?? '';
  const editable = props.editor.isEditable;
  return (
    <NodeViewWrapper className="code-block-wrapper">
      <div className="code-block-header" contentEditable={false}>
        {editable ? (
          <select className="input select" value={language} onChange={(e) => props.updateAttributes({ language: e.target.value || null })}>
            <option value="">auto</option>
            {COMMON_LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
            {language && !COMMON_LANGUAGES.includes(language) && <option value={language}>{language}</option>}
          </select>
        ) : (
          language && <span className="code-block-lang">{language}</span>
        )}
        <button
          type="button"
          className="icon-btn code-copy"
          title={t('common.copy')}
          onClick={async () => {
            await navigator.clipboard.writeText(props.node.textContent);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}
        </button>
      </div>
      <pre>
        <NodeViewContent<'code'> as="code" className={language ? `language-${language}` : undefined} />
      </pre>
    </NodeViewWrapper>
  );
}

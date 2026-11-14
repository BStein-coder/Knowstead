import { useState } from 'react';
import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { AlertOctagon, CheckCircle2, Copy, Info, Lightbulb, TriangleAlert, type LucideIcon } from 'lucide-react';
import { usePage } from '../../api/hooks';
import type { Page, UserRef } from '../../api/types';
import { useI18n } from '../../i18n';
import { Checkbox, Field, Input, Popover, cx } from '../../components/ui';
import { useDoc } from '../context';
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

/* ------------------------------ Stand der Seite ------------------------------ */

export const STAND_SOURCES = ['auto', 'updated', 'verified'] as const;
export type StandSource = (typeof STAND_SOURCES)[number];

/**
 * Welches Datum der Baustein „Stand“ zeigt: die letzte Änderung, die letzte Bestätigung („als aktuell bestätigt“,
 * Wiedervorlage) oder – Vorgabe – das spätere von beiden. Dieselbe Regel gilt im Export (`TransferService.renderStatic`).
 */
export function resolveStand(page: Pick<Page, 'updatedAt' | 'updatedBy' | 'reviewCycle'>, source: StandSource): { at: string; by: UserRef | null } | null {
  const updated = { at: page.updatedAt, by: page.updatedBy };
  const verified = page.reviewCycle?.verifiedAt ? { at: page.reviewCycle.verifiedAt, by: page.reviewCycle.verifiedBy } : null;
  if (source === 'updated') return updated;
  if (source === 'verified') return verified;
  return verified && verified.at > updated.at ? verified : updated;
}

/**
 * „Stand: 14.11.2026, 13:36“ – das Datum kommt aus der Seite selbst und stimmt deshalb immer; niemand muss es pflegen,
 * und es entsteht nie eine Version dafür. In eingebundenen Seiten zeigt der Baustein den Stand der eingebundenen Seite.
 */
export function PageStandView(props: NodeViewProps) {
  const { t, fmt } = useI18n();
  const doc = useDoc();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const attrs = props.node.attrs as { source: string; time: boolean; person: boolean; label: string };
  const source: StandSource = STAND_SOURCES.includes(attrs.source as StandSource) ? (attrs.source as StandSource) : 'auto';
  const { data: page, isError } = usePage(doc.pageId ?? undefined, { render: false });
  const stand = page ? resolveStand(page, source) : null;
  const value = !doc.pageId
    ? t('macros.standNoPage')
    : isError
      ? '–'
      : !page
        ? '…'
        : !stand
          ? t('macros.standNever')
          : `${attrs.time ? fmt.dateTime(stand.at) : fmt.date(stand.at)}${attrs.person && stand.by ? ` · ${stand.by.displayName}` : ''}`;
  const text = `${attrs.label || t('macros.standLabel')}: ${value}`;
  const editable = props.editor.isEditable;
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline' }}>
      {editable ? (
        <button ref={setAnchor} type="button" className="page-stand" contentEditable={false} title={t('macros.standHint')} onClick={() => setOpen(true)}>
          {text}
        </button>
      ) : (
        <span className="page-stand" title={t(`macros.standSources.${source}`)}>
          {text}
        </span>
      )}
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)}>
        <div style={{ padding: '0.75rem', width: 280 }} className="col">
          <Field label={t('macros.standSource')}>
            <select className="input select" value={source} onChange={(e) => props.updateAttributes({ source: e.target.value })}>
              {STAND_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`macros.standSources.${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t('macros.standCustomLabel')}>
            <Input
              value={attrs.label}
              maxLength={40}
              placeholder={t('macros.standLabel')}
              onChange={(e) => props.updateAttributes({ label: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  e.preventDefault();
                  setOpen(false);
                  props.editor.commands.focus();
                }
              }}
            />
          </Field>
          <Checkbox checked={!!attrs.time} onChange={(time) => props.updateAttributes({ time })} label={t('macros.standTime')} />
          <Checkbox checked={!!attrs.person} onChange={(person) => props.updateAttributes({ person })} label={t('macros.standPerson')} />
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

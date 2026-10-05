import type { ReactNode } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { Settings2, Trash2, type LucideIcon } from 'lucide-react';
import { IconButton, cx } from '../../components/ui';
import { useI18n } from '../../i18n';

interface MacroFrameProps {
  props: NodeViewProps;
  title?: ReactNode;
  icon?: LucideIcon;
  onConfigure?: () => void;
  /** Ohne Rahmen darstellen (z. B. Inhaltsverzeichnis, Unterseiten). */
  plain?: boolean;
  headerRight?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Gemeinsamer Rahmen für Block-Makros (Kopfzeile, Werkzeugleiste im Editor). */
export function MacroFrame({ props, title, icon: Icon, onConfigure, plain, headerRight, className, children }: MacroFrameProps) {
  const { t } = useI18n();
  const editable = props.editor.isEditable;
  return (
    <NodeViewWrapper
      // „selected“ nur im Editor – in der Leseansicht soll nichts hervorgehoben sein.
      className={cx('macro', plain && 'macro-plain', editable && props.selected && 'selected', className)}
      contentEditable={false}
      data-drag-handle=""
    >
      {editable && (
        <div className="macro-toolbar">
          {onConfigure && <IconButton icon={Settings2} label={t('macros.configure')} onClick={onConfigure} />}
          <IconButton icon={Trash2} label={t('common.remove')} onClick={() => props.deleteNode()} />
        </div>
      )}
      {title && !plain && (
        <div className="macro-header">
          <span className="macro-name">
            {Icon && <Icon size={14} />}
            {title}
          </span>
          <span className="spacer" />
          {headerRight}
        </div>
      )}
      <div className="macro-body">{children}</div>
    </NodeViewWrapper>
  );
}

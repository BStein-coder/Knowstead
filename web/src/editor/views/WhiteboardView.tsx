import { Suspense, lazy, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { Presentation } from 'lucide-react';
import { useI18n } from '../../i18n';
import { Button, Loading, Modal } from '../../components/ui';
import { MacroFrame } from './MacroFrame';

const WhiteboardEditor = lazy(() => {
  // Schriften vom eigenen Server laden (kein CDN – passt zur Content-Security-Policy)
  (window as unknown as { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = `${window.location.origin}/excalidraw/`;
  return import('./WhiteboardEditor');
});

const SAFE_SVG = /^data:image\/svg\+xml;base64,[a-z0-9+/=]+$/i;

/**
 * Whiteboard für freie Skizzen (Excalidraw). Die Szene liegt als JSON in der
 * Seite, dazu ein SVG für Anzeige, Suche nach Änderungen und PDF/Word-Export.
 */
export function WhiteboardView(props: NodeViewProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState(false);
  const svg = String(props.node.attrs.svg || '');
  const scene = String(props.node.attrs.scene || '');
  const title = String(props.node.attrs.title || '');
  const editable = props.editor.isEditable;
  const safeSvg = SAFE_SVG.test(svg) ? svg : '';

  return (
    <MacroFrame props={props} title={title || t('whiteboard.title')} icon={Presentation} onConfigure={editable ? () => setEditing(true) : undefined} className="whiteboard-macro">
      {safeSvg ? (
        <button type="button" className="drawio-preview whiteboard-preview" onClick={() => (editable ? setEditing(true) : setZoom(true))} title={editable ? t('whiteboard.edit') : t('files.enlarge')}>
          <img src={safeSvg} alt={title || t('whiteboard.title')} />
        </button>
      ) : (
        <div className="macro-empty">
          {t('whiteboard.empty')}
          {editable && (
            <Button size="sm" icon={Presentation} onClick={() => setEditing(true)} style={{ marginLeft: '0.75rem' }}>
              {t('whiteboard.open')}
            </Button>
          )}
        </div>
      )}
      {editing && (
        <Suspense
          fallback={
            <div className="whiteboard-editor">
              <Loading label={t('whiteboard.loading')} />
            </div>
          }
        >
          <WhiteboardEditor scene={scene} title={title} onClose={() => setEditing(false)} onSave={(next) => props.updateAttributes(next)} />
        </Suspense>
      )}
      {zoom && safeSvg && (
        <Modal open onClose={() => setZoom(false)} title={title || t('whiteboard.title')} size="xl">
          <div className="drawio-zoom">
            <img src={safeSvg} alt={title} />
          </div>
        </Modal>
      )}
    </MacroFrame>
  );
}

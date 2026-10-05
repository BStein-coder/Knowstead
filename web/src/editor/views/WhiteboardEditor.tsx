/**
 * Whiteboard-Editor auf Basis von Excalidraw. Wird erst beim Öffnen geladen
 * (eigener Chunk), Schriften kommen vom eigenen Server (/excalidraw/fonts).
 */
import '@excalidraw/excalidraw/index.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Excalidraw, MainMenu, exportToSvg, getSceneVersion, serializeAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';
import { Check, Save, X } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { currentTheme } from '../../lib/theme';
import { Button, IconButton, Input } from '../../components/ui';

/** Obergrenze für Szene + Vorschau in der Seite (Bilder im Whiteboard zählen mit). */
export const MAX_WHITEBOARD_BYTES = 4 * 1024 * 1024;

interface Props {
  scene: string;
  title: string;
  onSave: (next: { scene: string; svg: string; title: string }) => void;
  onClose: () => void;
}

function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Gespeicherte Szene (serializeAsJSON) für Excalidraw aufbereiten – Excalidraw prüft und ergänzt die Daten selbst. */
function parseScene(scene: string): ExcalidrawInitialDataState | null {
  if (!scene) return null;
  try {
    const data = JSON.parse(scene) as ExcalidrawInitialDataState;
    return {
      elements: Array.isArray(data.elements) ? data.elements : [],
      appState: data.appState ?? {},
      files: data.files ?? {},
      scrollToContent: true,
    };
  } catch {
    return null;
  }
}

export default function WhiteboardEditor({ scene, title: initialTitle, onSave, onClose }: Props) {
  const { t, locale } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const initialData = useMemo(() => parseScene(scene), [scene]);
  const savedVersion = useRef<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const titleChanged = title !== initialTitle;

  const save = useCallback(
    async (close: boolean) => {
      const excalidraw = api.current;
      if (!excalidraw || saving) return;
      setSaving(true);
      try {
        const elements = excalidraw.getSceneElements();
        const appState = excalidraw.getAppState();
        const files = excalidraw.getFiles();
        let next = { scene: '', svg: '', title };
        if (elements.length) {
          const json = serializeAsJSON(elements, appState, files, 'local');
          const svgElement = await exportToSvg({
            elements,
            appState: { ...appState, exportBackground: true, exportWithDarkMode: false, exportEmbedScene: false },
            files,
            exportPadding: 16,
          });
          const svg = `data:image/svg+xml;base64,${toBase64(new XMLSerializer().serializeToString(svgElement))}`;
          if (json.length + svg.length > MAX_WHITEBOARD_BYTES) {
            toast.error(t('whiteboard.tooLarge'));
            return;
          }
          next = { scene: json, svg, title };
        }
        onSave(next);
        savedVersion.current = getSceneVersion(elements);
        setDirty(false);
        if (close) onClose();
        else toast.success(t('common.saved'));
      } catch (err) {
        toast.error(err);
      } finally {
        setSaving(false);
      }
    },
    [onClose, onSave, saving, t, title, toast],
  );

  const requestClose = useCallback(async () => {
    if (dirty || titleChanged) {
      const discard = await dialogs.confirm({ title: t('whiteboard.discardTitle'), message: t('whiteboard.discardText'), danger: true, confirmLabel: t('whiteboard.discard') });
      if (!discard) return;
    }
    onClose();
  }, [dialogs, dirty, onClose, t, titleChanged]);

  // Strg+S speichert das Whiteboard statt die ganze Seite zu veröffentlichen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopImmediatePropagation();
        void save(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [save]);

  return (
    <div className="whiteboard-editor" role="dialog" aria-modal="true" aria-label={t('whiteboard.title')}>
      <div className="whiteboard-shell">
        <div className="whiteboard-bar">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('whiteboard.titlePlaceholder')} maxLength={120} className="whiteboard-title" aria-label={t('common.title')} />
          <span className="spacer" />
          {(dirty || titleChanged) && <span className="small muted">{t('whiteboard.unsaved')}</span>}
          <Button icon={Save} loading={saving} onClick={() => void save(false)}>
            {t('common.save')}
          </Button>
          <Button variant="primary" icon={Check} disabled={saving} onClick={() => void save(true)}>
            {t('whiteboard.saveClose')}
          </Button>
          <IconButton icon={X} label={t('common.close')} onClick={() => void requestClose()} />
        </div>
        <div className="whiteboard-canvas">
          <Excalidraw
            excalidrawAPI={(instance) => {
              api.current = instance;
            }}
            initialData={initialData}
            langCode={locale === 'de' ? 'de-DE' : 'en'}
            theme={currentTheme() === 'dark' ? 'dark' : 'light'}
            UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, toggleTheme: null } }}
            onChange={(elements) => {
              const version = getSceneVersion(elements);
              if (savedVersion.current === null) savedVersion.current = version;
              else if (version !== savedVersion.current) setDirty(true);
            }}
          >
            <MainMenu>
              <MainMenu.DefaultItems.SaveAsImage />
              <MainMenu.DefaultItems.ClearCanvas />
              <MainMenu.Separator />
              <MainMenu.DefaultItems.ChangeCanvasBackground />
              <MainMenu.DefaultItems.Help />
            </MainMenu>
          </Excalidraw>
        </div>
      </div>
    </div>
  );
}

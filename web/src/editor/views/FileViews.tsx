import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Download,
  Eye,
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Maximize2,
  PenTool,
  Play,
  Presentation,
  Shapes,
  Upload,
} from 'lucide-react';
import { api, uploadWithProgress } from '../../api/client';
import type { Attachment } from '../../api/types';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Button, Field, Loading, Modal, Select } from '../../components/ui';
import { useDoc } from '../context';
import { MacroFrame } from './MacroFrame';

const PdfViewer = lazy(() => import('../../components/PdfViewer'));

/* ------------------------------ Hilfsfunktionen ------------------------------ */

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function iconFor(name: string, mime = '') {
  const ext = extOf(name);
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('video/')) return FileVideo;
  if (mime.startsWith('audio/')) return FileAudio;
  if (ext === 'pdf') return FileText;
  if (['ppt', 'pptx', 'pps', 'ppsx', 'odp', 'key'].includes(ext)) return Presentation;
  if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return FileSpreadsheet;
  if (['vsd', 'vsdx', 'vdx', 'drawio'].includes(ext)) return Shapes;
  if (['zip', '7z', 'rar', 'gz', 'tar'].includes(ext)) return FileArchive;
  if (['doc', 'docx', 'odt', 'rtf', 'txt', 'md'].includes(ext)) return FileText;
  return File;
}

function useAttachments(pageId: number | null) {
  return useQuery({
    queryKey: ['attachments', pageId, false],
    queryFn: () => api.get<Attachment[]>(`/api/v1/pages/${pageId}/attachments`),
    enabled: !!pageId,
    staleTime: 30_000,
  });
}

const VIDEO_EXT = new Set(['mp4', 'webm', 'ogv', 'mov', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus']);

/** Video oder Ton? Ältere Inhalte haben keinen Medientyp gespeichert – dann entscheidet die Endung. */
function mediaKind(mime: string, name: string): 'video' | 'audio' | null {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = extOf(name);
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return null;
}

/* ------------------------------ Dateikarte ------------------------------ */

/** Datei im Fließtext: Symbol, Name, Größe, Download und – wenn möglich – Vorschau. */
export function FileCardView(props: NodeViewProps) {
  const { t, fmt } = useI18n();
  const { pageId } = useDoc();
  const [preview, setPreview] = useState(false);
  const id = Number(props.node.attrs.attachmentId) || null;
  const name = String(props.node.attrs.name || t('files.file'));
  const mime = String(props.node.attrs.mime || '');
  const size = Number(props.node.attrs.size) || 0;
  const { data: attachments } = useAttachments(pageId);
  const attachment = attachments?.find((a) => a.id === id) ?? null;
  const Icon = iconFor(name, mime);
  const previewKind = attachment?.preview ?? (extOf(name) === 'pdf' ? 'pdf' : null);
  // Video und Ton spielt der Browser selbst ab; der Server liefert dafür Bereiche aus (Springen).
  const media = mediaKind(mime, name);
  const editable = props.editor.isEditable;

  const toPdfViewer = () => {
    const pos = props.getPos();
    if (typeof pos !== 'number') return;
    props.editor
      .chain()
      .focus()
      .insertContentAt({ from: pos, to: pos + props.node.nodeSize }, { type: 'pdfViewer', attrs: { attachmentId: id, name, height: 600 } })
      .run();
  };

  return (
    <MacroFrame props={props} plain className="file-card-macro">
      <div className="file-card">
        <span className="file-card-icon" data-ext={extOf(name)}>
          <Icon size={22} />
        </span>
        <div className="file-card-body">
          <div className="file-card-name truncate" title={name}>
            {name}
          </div>
          <div className="file-card-meta">
            {extOf(name).toUpperCase() || t('files.file')}
            {size ? ` · ${fmt.bytes(size)}` : ''}
            {attachment === null && attachments && id ? ` · ${t('files.missing')}` : ''}
          </div>
        </div>
        <div className="file-card-actions">
          {(previewKind || (media && id)) && (
            <Button size="sm" variant="ghost" icon={media ? Play : Eye} onClick={() => setPreview(true)}>
              {media ? t('files.play') : t('files.preview')}
            </Button>
          )}
          {id && (
            <a className="btn btn-sm btn-ghost" href={`/api/v1/attachments/${id}/raw?download=1`}>
              <Download size={14} /> {t('common.download')}
            </a>
          )}
          {editable && previewKind && (
            <Button size="sm" variant="ghost" icon={Maximize2} onClick={toPdfViewer} title={t('files.embedViewer')}>
              {t('files.embed')}
            </Button>
          )}
        </div>
      </div>
      {preview && id && (
        <Modal open onClose={() => setPreview(false)} title={name} size="xl">
          {media === 'video' ? (
            <video className="media-preview" src={`/api/v1/attachments/${id}/raw`} controls autoPlay preload="metadata">
              {t('files.mediaUnsupported')}
            </video>
          ) : media === 'audio' ? (
            <audio className="media-preview" src={`/api/v1/attachments/${id}/raw`} controls autoPlay preload="metadata">
              {t('files.mediaUnsupported')}
            </audio>
          ) : (
            <Suspense fallback={<Loading />}>
              <PdfViewer src={`/api/v1/attachments/${id}/preview`} downloadUrl={`/api/v1/attachments/${id}/raw?download=1`} height={Math.round(window.innerHeight * 0.72)} />
            </Suspense>
          )}
        </Modal>
      )}
    </MacroFrame>
  );
}

/* ------------------------------ PDF-Betrachter ------------------------------ */

export function PdfMacroView(props: NodeViewProps) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { pageId } = useDoc();
  const [config, setConfig] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const id = Number(props.node.attrs.attachmentId) || null;
  const name = String(props.node.attrs.name || '');
  const height = Number(props.node.attrs.height) || 600;
  const { data: attachments } = useAttachments(pageId);
  const candidates = (attachments ?? []).filter((a) => a.preview);
  const editable = props.editor.isEditable;

  useEffect(() => {
    if (editable && !id) setConfig(true);
  }, [editable, id]);

  const upload = async (files: FileList | null) => {
    if (!files?.length || !pageId) return;
    const form = new FormData();
    form.append('file', files[0]);
    try {
      const [att] = await uploadWithProgress<Attachment[]>(`/api/v1/pages/${pageId}/attachments`, form);
      props.updateAttributes({ attachmentId: att.id, name: att.filename });
      void qc.invalidateQueries({ queryKey: ['attachments', pageId] });
      if (!att.preview) toast.info(t('files.noPreviewHint'));
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <MacroFrame props={props} title={name || t('files.pdfViewer')} icon={FileText} onConfigure={editable ? () => setConfig(true) : undefined}>
      {id ? (
        <Suspense fallback={<Loading />}>
          <PdfViewer src={`/api/v1/attachments/${id}/preview`} height={height} title={name} downloadUrl={`/api/v1/attachments/${id}/raw?download=1`} />
        </Suspense>
      ) : (
        <div className="macro-empty">{t('files.pdfEmpty')}</div>
      )}
      {editable && config && (
        <Modal
          open
          onClose={() => setConfig(false)}
          title={t('files.pdfViewer')}
          size="sm"
          footer={
            <Button variant="primary" onClick={() => setConfig(false)}>
              {t('common.done')}
            </Button>
          }
        >
          <Field label={t('files.chooseAttachment')} help={t('files.chooseHelp')}>
            <Select
              value={id ? String(id) : ''}
              onChange={(e) => {
                const att = candidates.find((a) => a.id === Number(e.target.value));
                props.updateAttributes({ attachmentId: att?.id ?? null, name: att?.filename ?? '' });
              }}
            >
              <option value="">{t('common.none')}</option>
              {candidates.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.filename}
                  {a.preview === 'office' ? ` (${t('files.officePreview')})` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <input ref={fileRef} type="file" hidden accept=".pdf,.pptx,.ppt,.docx,.doc,.xlsx,.xls,.vsdx,.vsd,.odt,.odp,.ods" onChange={(e) => void upload(e.target.files)} />
          <Button icon={Upload} onClick={() => fileRef.current?.click()} disabled={!pageId}>
            {t('files.uploadFile')}
          </Button>
          <Field label={t('files.height')}>
            <Select value={String(height)} onChange={(e) => props.updateAttributes({ height: Number(e.target.value) })}>
              {[400, 600, 800, 1000].map((h) => (
                <option key={h} value={h}>
                  {h} px
                </option>
              ))}
            </Select>
          </Field>
        </Modal>
      )}
    </MacroFrame>
  );
}

/* ------------------------------ draw.io ------------------------------ */

const SAFE_IMAGE = /^data:image\/(svg\+xml|png);base64,[a-z0-9+/=]+$/i;

/**
 * draw.io-Diagramm: Anzeige als eingebettetes SVG, Bearbeitung im
 * draw.io-Editor (embed.diagrams.net oder eine eigene Installation).
 * Das Diagramm-XML liegt in der Seite – Versionen und Vergleich funktionieren
 * dadurch wie bei jedem anderen Inhalt.
 */
export function DrawioView(props: NodeViewProps) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [zoom, setZoom] = useState(false);
  const svg = String(props.node.attrs.svg || '');
  const xml = String(props.node.attrs.xml || '');
  const title = String(props.node.attrs.title || '');
  const editable = props.editor.isEditable;
  const safeSvg = SAFE_IMAGE.test(svg) ? svg : '';

  return (
    <MacroFrame
      props={props}
      title={title || t('files.drawio')}
      icon={PenTool}
      onConfigure={editable ? () => setEditing(true) : undefined}
      className="drawio-macro"
    >
      {safeSvg ? (
        <button type="button" className="drawio-preview" onClick={() => (editable ? setEditing(true) : setZoom(true))} title={editable ? t('files.drawioEdit') : t('files.enlarge')}>
          <img src={safeSvg} alt={title || t('files.drawio')} />
        </button>
      ) : (
        <div className="macro-empty">
          {t('files.drawioEmpty')}
          {editable && (
            <Button size="sm" icon={PenTool} onClick={() => setEditing(true)} style={{ marginLeft: '0.75rem' }}>
              {t('files.drawioEdit')}
            </Button>
          )}
        </div>
      )}
      {editing && (
        <DrawioEditor
          xml={xml}
          onClose={() => setEditing(false)}
          onSave={(nextXml, nextSvg) => {
            props.updateAttributes({ xml: nextXml, svg: nextSvg });
          }}
        />
      )}
      {zoom && safeSvg && (
        <Modal open onClose={() => setZoom(false)} title={title || t('files.drawio')} size="xl">
          <div className="drawio-zoom">
            <img src={safeSvg} alt={title} />
          </div>
        </Modal>
      )}
    </MacroFrame>
  );
}

function DrawioEditor({ xml, onSave, onClose }: { xml: string; onSave: (xml: string, svg: string) => void; onClose: () => void }) {
  const { settings } = useAuth();
  const { t, locale } = useI18n();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const base = (settings.drawioUrl || 'https://embed.diagrams.net').replace(/\/+$/, '');
  const origin = useMemo(() => {
    try {
      return new URL(base).origin;
    } catch {
      return 'https://embed.diagrams.net';
    }
  }, [base]);
  const src = `${base}/?embed=1&ui=min&spin=1&proto=json&saveAndExit=1&noSaveBtn=0&libraries=1&lang=${locale}`;
  const pendingXml = useRef(xml);
  const exitAfterExport = useRef(false);

  useEffect(() => {
    const send = (msg: object) => frameRef.current?.contentWindow?.postMessage(JSON.stringify(msg), origin);
    const onMessage = (e: MessageEvent) => {
      // Nur Nachrichten des eingebetteten Editors verarbeiten.
      if (e.origin !== origin || e.source !== frameRef.current?.contentWindow || typeof e.data !== 'string') return;
      let msg: { event?: string; xml?: string; data?: string; exit?: boolean };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.event === 'init') {
        send({ action: 'load', xml: pendingXml.current || '', autosave: 0, title: t('files.drawio') });
      } else if (msg.event === 'save' && typeof msg.xml === 'string') {
        pendingXml.current = msg.xml;
        exitAfterExport.current = !!msg.exit;
        send({ action: 'export', format: 'xmlsvg', xml: msg.xml, spin: t('common.saving') });
      } else if (msg.event === 'export' && typeof msg.data === 'string') {
        const ok = SAFE_IMAGE.test(msg.data);
        if (ok) onSave(pendingXml.current, msg.data);
        // „Speichern“ lässt den Editor offen, „Speichern & Beenden“ schließt ihn.
        if (exitAfterExport.current || !ok) onClose();
        else send({ action: 'status', message: t('common.saved'), modified: false });
      } else if (msg.event === 'exit') {
        onClose();
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [origin, onSave, onClose, t]);

  return (
    <div className="drawio-editor" role="dialog" aria-modal="true" aria-label={t('files.drawio')}>
      <iframe ref={frameRef} src={src} title={t('files.drawio')} />
    </div>
  );
}

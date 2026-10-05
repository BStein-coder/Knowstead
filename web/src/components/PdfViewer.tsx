import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Expand, Minus, Plus, ScanLine } from 'lucide-react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { IconButton, Spinner, cx } from './ui';
import { useI18n } from '../i18n';

/** pdf.js wird erst geladen, wenn tatsächlich ein PDF angezeigt wird. */
let pdfjsPromise: Promise<typeof import('pdfjs-dist')> | null = null;

function loadPdfjs() {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });
  return pdfjsPromise;
}

interface Props {
  /** Adresse der PDF-Datei – nur eigene Anhänge (gleicher Ursprung). */
  src: string;
  /** Anzeigehöhe in Pixeln */
  height?: number;
  initialPage?: number;
  downloadUrl?: string;
  title?: string;
  className?: string;
}

/**
 * Eingebetteter PDF-Betrachter auf Basis von pdf.js: Seitenweise Anzeige mit
 * Blättern, Zoom, Seitenbreite und Vollbild. Rendert auf ein Canvas, dadurch
 * ist keine Browser-Erweiterung nötig und die Darstellung überall gleich.
 */
export function PdfViewer({ src, height = 640, initialPage = 1, downloadUrl, title, className }: Props) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderRef = useRef<RenderTask | null>(null);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(Math.max(1, initialPage));
  const [scale, setScale] = useState<number | 'fit'>('fit');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  // Dokument laden
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;
    setBusy(true);
    setError(null);
    setDoc(null);
    void (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return;
        task = pdfjs.getDocument({
          url: src,
          withCredentials: true,
          // WebAssembly würde 'wasm-unsafe-eval' in der CSP verlangen – die JS-Variante genügt.
          useWasm: false,
          cMapUrl: '/pdfjs/cmaps/',
          cMapPacked: true,
          standardFontDataUrl: '/pdfjs/standard_fonts/',
          enableXfa: false,
        });
        const loaded = await task.promise;
        if (cancelled) return;
        setDoc(loaded);
        setPage((p) => Math.min(Math.max(1, p), loaded.numPages));
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();
    return () => {
      cancelled = true;
      renderRef.current?.cancel();
      // Beendet Netzwerkzugriffe und den Worker des Dokuments.
      if (task) void task.destroy();
    };
  }, [src]);

  // Seite zeichnen
  const draw = useCallback(async () => {
    if (!doc || !canvasRef.current || !wrapRef.current) return;
    renderRef.current?.cancel();
    const pdfPage = await doc.getPage(page);
    const base = pdfPage.getViewport({ scale: 1 });
    const available = wrapRef.current.clientWidth - 24;
    const effective = scale === 'fit' ? Math.max(0.2, available / base.width) : scale;
    const ratio = window.devicePixelRatio || 1;
    const viewport = pdfPage.getViewport({ scale: effective * ratio });
    const canvas = canvasRef.current;
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(viewport.width / ratio)}px`;
    canvas.style.height = `${Math.floor(viewport.height / ratio)}px`;
    const task = pdfPage.render({ canvas, viewport });
    renderRef.current = task;
    try {
      await task.promise;
    } catch (err) {
      if ((err as { name?: string })?.name !== 'RenderingCancelledException') setError(err instanceof Error ? err.message : String(err));
    }
  }, [doc, page, scale]);

  useEffect(() => {
    void draw();
  }, [draw]);

  // Bei Größenänderung neu zeichnen (nur im Modus „Seitenbreite“)
  useEffect(() => {
    if (scale !== 'fit' || !wrapRef.current) return;
    const observer = new ResizeObserver(() => void draw());
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, [draw, scale]);

  const pages = doc?.numPages ?? 0;
  const zoom = (delta: number) => setScale((s) => Math.max(0.3, Math.min(4, Number(((s === 'fit' ? 1 : s) + delta).toFixed(2)))));

  return (
    <div className={cx('pdf-viewer', className)}>
      <div className="pdf-toolbar">
        <span className="pdf-title truncate">{title}</span>
        <span className="spacer" />
        <IconButton icon={ChevronLeft} label={t('a11y.previousPage')} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} />
        <span className="pdf-pages">
          <input
            className="input input-sm"
            type="number"
            min={1}
            max={pages || 1}
            value={page}
            onChange={(e) => setPage(Math.min(Math.max(1, Number(e.target.value) || 1), pages || 1))}
            aria-label={t('a11y.pageNumber')}
          />
          <span className="muted">/ {pages || '–'}</span>
        </span>
        <IconButton icon={ChevronRight} label={t('a11y.nextPage')} disabled={!pages || page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))} />
        <span className="toolbar-sep" />
        <IconButton icon={Minus} label={t('a11y.zoomOut')} onClick={() => zoom(-0.2)} />
        <IconButton icon={ScanLine} label={t('a11y.fitWidth')} active={scale === 'fit'} onClick={() => setScale('fit')} />
        <IconButton icon={Plus} label={t('a11y.zoomIn')} onClick={() => zoom(0.2)} />
        <IconButton icon={Expand} label={t('a11y.fullscreen')} onClick={() => void wrapRef.current?.parentElement?.requestFullscreen?.()} />
        {downloadUrl && (
          <a className="icon-btn" href={downloadUrl} title={t('common.download')} aria-label={t('common.download')}>
            <Download size={16} />
          </a>
        )}
      </div>
      <div
        ref={wrapRef}
        className="pdf-stage"
        style={{ height }}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'PageDown') setPage((p) => Math.min(pages, p + 1));
          if (e.key === 'ArrowLeft' || e.key === 'PageUp') setPage((p) => Math.max(1, p - 1));
        }}
      >
        {busy && (
          <div className="pdf-state">
            <Spinner /> {t('pdfViewer.loading')}
          </div>
        )}
        {error && <div className="pdf-state error">{t('pdfViewer.error', { error })}</div>}
        <canvas ref={canvasRef} className={cx('pdf-canvas', (busy || error) && 'hidden')} />
      </div>
    </div>
  );
}

export default PdfViewer;

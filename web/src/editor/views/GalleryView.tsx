import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeViewProps } from '@tiptap/react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, GripVertical, Images, Plus, Trash2, Upload, X, ZoomIn } from 'lucide-react';
import { api, uploadWithProgress } from '../../api/client';
import type { Attachment } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Button, IconButton, Input, Modal, Select, cx } from '../../components/ui';
import { useDoc } from '../context';
import { MacroFrame } from './MacroFrame';

export interface GalleryItem {
  src: string;
  alt: string;
  caption: string;
  /** Anhang-ID, falls das Bild aus den Seitenanhängen stammt. */
  attachmentId?: number;
}

/** Nur Bildquellen zulassen, die gefahrlos in ein <img> dürfen. */
function safeSrc(src: unknown): string | null {
  if (typeof src !== 'string' || !src.trim()) return null;
  const value = src.trim();
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^data:image\/(png|jpe?g|gif|webp|avif|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(value)) return value;
  return null;
}

export function parseItems(raw: unknown): GalleryItem[] {
  try {
    const list = JSON.parse(String(raw || '[]')) as GalleryItem[];
    if (!Array.isArray(list)) return [];
    const items: GalleryItem[] = [];
    for (const entry of list.slice(0, 200)) {
      const src = safeSrc(entry?.src);
      if (!src) continue;
      items.push({
        src,
        alt: String(entry.alt ?? '').slice(0, 300),
        caption: String(entry.caption ?? '').slice(0, 300),
        attachmentId: typeof entry.attachmentId === 'number' ? entry.attachmentId : undefined,
      });
    }
    return items;
  } catch {
    return [];
  }
}

/* --------------------------------- Lightbox --------------------------------- */

export function Lightbox({ items, index, onClose }: { items: GalleryItem[]; index: number; onClose: () => void }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState(index);
  const item = items[current];
  const go = useCallback((delta: number) => setCurrent((c) => (c + delta + items.length) % items.length), [items.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (!item) return null;
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={item.caption || item.alt || t('macros.gallery')}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lightbox-count">
          {current + 1} / {items.length}
        </span>
        <span className="spacer" />
        <IconButton icon={X} label={t('common.close')} onClick={onClose} />
      </div>
      {items.length > 1 && (
        <button className="lightbox-nav prev" onClick={(e) => (e.stopPropagation(), go(-1))} aria-label={t('a11y.previousImage')}>
          <ChevronLeft size={28} />
        </button>
      )}
      <figure className="lightbox-figure" onClick={(e) => e.stopPropagation()}>
        <img src={item.src} alt={item.alt || item.caption} />
        {(item.caption || item.alt) && <figcaption>{item.caption || item.alt}</figcaption>}
      </figure>
      {items.length > 1 && (
        <button className="lightbox-nav next" onClick={(e) => (e.stopPropagation(), go(1))} aria-label={t('a11y.nextImage')}>
          <ChevronRight size={28} />
        </button>
      )}
    </div>
  );
}

/* ---------------------------------- Galerie ---------------------------------- */

export function GalleryGrid({
  items,
  columns,
  layout,
  onOpen,
}: {
  items: GalleryItem[];
  columns: number;
  layout: string;
  onOpen: (index: number) => void;
}) {
  return (
    <div
      className={cx('gallery', `gallery-${layout}`)}
      style={{ '--gallery-columns': String(Math.max(1, Math.min(6, columns))) } as React.CSSProperties}
    >
      {items.map((item, i) => (
        <figure key={`${item.src}-${i}`} className="gallery-item">
          <button type="button" className="gallery-thumb" onClick={() => onOpen(i)} aria-label={item.caption || item.alt || `Bild ${i + 1}`}>
            <img src={item.src} alt={item.alt || item.caption} loading="lazy" />
            <span className="gallery-zoom">
              <ZoomIn size={16} />
            </span>
          </button>
          {item.caption && <figcaption>{item.caption}</figcaption>}
        </figure>
      ))}
    </div>
  );
}

/** Galerie-Makro: Bildraster mit Lightbox, im Editor mit Verwaltung. */
export function GalleryView(props: NodeViewProps) {
  const { t } = useI18n();
  const toast = useToast();
  const { pageId } = useDoc();
  const editable = props.editor.isEditable;
  const items = useMemo(() => parseItems(props.node.attrs.items), [props.node.attrs.items]);
  const columns = Number(props.node.attrs.columns) || 3;
  const layout = String(props.node.attrs.layout || 'grid');
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [picker, setPicker] = useState(false);

  const setItems = (next: GalleryItem[]) => props.updateAttributes({ items: JSON.stringify(next) });

  return (
    <MacroFrame
      props={props}
      title={t('macros.gallery')}
      icon={Images}
      plain={!editable && items.length > 0}
      onConfigure={editable ? () => setPicker(true) : undefined}
      className="gallery-macro"
    >
      {items.length === 0 ? (
        <div className="macro-empty">
          {t('gallery.empty')}
          {editable && (
            <Button size="sm" icon={Plus} onClick={() => setPicker(true)} style={{ marginLeft: '0.75rem' }}>
              {t('gallery.add')}
            </Button>
          )}
        </div>
      ) : (
        <GalleryGrid items={items} columns={columns} layout={layout} onOpen={setLightbox} />
      )}
      {lightbox !== null && <Lightbox items={items} index={lightbox} onClose={() => setLightbox(null)} />}
      {editable && picker && (
        <GalleryEditor
          open={picker}
          onClose={() => setPicker(false)}
          pageId={pageId}
          items={items}
          columns={columns}
          layout={layout}
          onChange={(next, attrs) => {
            setItems(next);
            if (attrs) props.updateAttributes(attrs);
          }}
          onError={(msg) => toast.error(msg)}
        />
      )}
    </MacroFrame>
  );
}

/* ------------------------------ Bearbeiten-Dialog ------------------------------ */

function GalleryEditor({
  open,
  onClose,
  pageId,
  items,
  columns,
  layout,
  onChange,
  onError,
}: {
  open: boolean;
  onClose: () => void;
  pageId: number | null;
  items: GalleryItem[];
  columns: number;
  layout: string;
  onChange: (items: GalleryItem[], attrs?: Record<string, unknown>) => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const { data: attachments, refetch } = useQuery({
    queryKey: ['attachments', pageId, false],
    queryFn: () => api.get<Attachment[]>(`/api/v1/pages/${pageId}/attachments`),
    enabled: !!pageId && open,
  });
  const images = (attachments ?? []).filter((a) => a.isImage);
  const used = new Set(items.map((i) => i.attachmentId).filter(Boolean));

  const upload = async (files: FileList | null) => {
    if (!files?.length || !pageId) return;
    setBusy(true);
    try {
      const added: GalleryItem[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const form = new FormData();
        form.append('file', file);
        const result = await uploadWithProgress<Attachment[]>(`/api/v1/pages/${pageId}/attachments`, form);
        for (const a of result) added.push({ src: a.url, alt: a.filename, caption: '', attachmentId: a.id });
      }
      if (added.length) onChange([...items, ...added]);
      void refetch();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('macros.gallery')}
      size="lg"
      footer={
        <Button variant="primary" onClick={onClose}>
          {t('common.done')}
        </Button>
      }
    >
      <div className="row gap-md wrap" style={{ marginBottom: '1rem' }}>
        <label className="field-inline">
          <span>{t('gallery.columns')}</span>
          <Select value={String(columns)} onChange={(e) => onChange(items, { columns: Number(e.target.value) })}>
            {[2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </Select>
        </label>
        <label className="field-inline">
          <span>{t('gallery.layout')}</span>
          <Select value={layout} onChange={(e) => onChange(items, { layout: e.target.value })}>
            <option value="grid">{t('gallery.layoutGrid')}</option>
            <option value="masonry">{t('gallery.layoutMasonry')}</option>
            <option value="strip">{t('gallery.layoutStrip')}</option>
          </Select>
        </label>
        <span className="spacer" />
        <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void upload(e.target.files)} />
        <Button icon={Upload} loading={busy} onClick={() => fileRef.current?.click()} disabled={!pageId}>
          {t('gallery.upload')}
        </Button>
      </div>

      {items.length > 0 && (
        <ul className="gallery-editor-list">
          {items.map((item, i) => (
            <li
              key={`${item.src}-${i}`}
              className={cx('gallery-editor-row', dragIndex === i && 'dragging')}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (dragIndex !== null) move(dragIndex, i);
                setDragIndex(null);
              }}
            >
              <GripVertical size={14} className="muted" />
              <img src={item.src} alt="" />
              <Input
                value={item.caption}
                placeholder={t('gallery.caption')}
                onChange={(e) => {
                  const next = [...items];
                  next[i] = { ...item, caption: e.target.value };
                  onChange(next);
                }}
              />
              <IconButton icon={ChevronLeft} label={t('gallery.moveLeft')} onClick={() => move(i, i - 1)} />
              <IconButton icon={ChevronRight} label={t('gallery.moveRight')} onClick={() => move(i, i + 1)} />
              <IconButton icon={Trash2} label={t('common.remove')} onClick={() => onChange(items.filter((_, x) => x !== i))} />
            </li>
          ))}
        </ul>
      )}

      {images.length > 0 && (
        <>
          <h4 className="section-title">{t('gallery.fromAttachments')}</h4>
          <div className="gallery-picker">
            {images.map((a) => (
              <button
                key={a.id}
                type="button"
                className={cx('gallery-picker-item', used.has(a.id) && 'used')}
                onClick={() => onChange([...items, { src: a.url, alt: a.filename, caption: '', attachmentId: a.id }])}
                title={a.filename}
              >
                <img src={a.url} alt={a.filename} loading="lazy" />
              </button>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

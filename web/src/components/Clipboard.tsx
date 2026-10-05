import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, ClipboardPaste, ClipboardPlus, Copy, Pin, PinOff, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { Clip } from '../api/types';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';
import { EmptyState, IconButton, Loading, Popover, Time, cx } from './ui';

export function useClips(enabled = true) {
  const { user } = useAuth();
  return useQuery({ queryKey: ['clips'], queryFn: () => api.get<{ items: Clip[] }>('/api/v1/clips'), enabled: enabled && !!user, staleTime: 10_000 });
}

export function useAddClip() {
  const qc = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  return useMutation({
    mutationFn: (input: { content: string; kind?: Clip['kind']; title?: string; sourcePageId?: number | null }) => api.post<Clip>('/api/v1/clips', input),
    onSuccess: () => {
      toast.success(t('clipboard.added'));
      void qc.invalidateQueries({ queryKey: ['clips'] });
    },
    onError: (err) => toast.error(err),
  });
}

/** Klartext eines Eintrags für die System-Zwischenablage. */
function plain(clip: Clip): string {
  if (clip.kind !== 'html') return clip.content;
  // DOMParser lädt keine Bilder und führt nichts aus (anders als innerHTML auf einem Element)
  const doc = new DOMParser().parseFromString(clip.content, 'text/html');
  return doc.body.innerText || doc.body.textContent || '';
}

/**
 * Liste der persönlichen Zwischenablage. Mit `onInsert` (im Editor) lassen sich
 * Einträge direkt einfügen, mit `onCapture` die aktuelle Markierung ablegen.
 */
export function ClipboardPanel({ onInsert, onCapture, onClose }: { onInsert?: (clip: Clip) => void; onCapture?: () => void; onClose?: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useClips();
  const items = data?.items ?? [];

  const refresh = () => void qc.invalidateQueries({ queryKey: ['clips'] });
  const pin = async (clip: Clip) => {
    await api.patch(`/api/v1/clips/${clip.id}`, { pinned: !clip.pinned });
    refresh();
  };
  const remove = async (clip: Clip) => {
    await api.del(`/api/v1/clips/${clip.id}`);
    refresh();
  };
  const clear = async () => {
    await api.del('/api/v1/clips');
    refresh();
  };
  const copy = async (clip: Clip) => {
    try {
      if (clip.kind === 'html' && 'ClipboardItem' in window) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([clip.content], { type: 'text/html' }),
            'text/plain': new Blob([plain(clip)], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain(clip));
      }
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('clipboard.copyFailed'));
    }
  };

  return (
    <div className="clip-panel">
      <div className="clip-panel-head">
        <ClipboardList size={15} />
        <strong>{t('clipboard.title')}</strong>
        <span className="spacer" />
        {onCapture && <IconButton icon={ClipboardPlus} label={t('clipboard.captureSelection')} onClick={onCapture} />}
        {items.some((c) => !c.pinned) && <IconButton icon={Trash2} label={t('clipboard.clear')} onClick={() => void clear()} />}
      </div>
      {isLoading ? (
        <Loading inline />
      ) : !items.length ? (
        <EmptyState compact icon={ClipboardList} title={t('clipboard.empty')} text={t('clipboard.emptyHint')} />
      ) : (
        <ul className="clip-list">
          {items.map((clip) => (
            <li key={clip.id} className={cx('clip-item', clip.pinned && 'pinned')}>
              <div className="clip-main">
                <div className="clip-title truncate">{clip.title}</div>
                <div className="clip-preview">{clip.preview}</div>
                <div className="clip-meta">
                  <Time value={clip.createdAt} />
                  {clip.source && (
                    <>
                      {' · '}
                      <Link to={clip.source.url} onClick={onClose}>
                        {clip.source.title}
                      </Link>
                    </>
                  )}
                </div>
              </div>
              <div className="clip-actions">
                {onInsert && <IconButton icon={ClipboardPaste} label={t('clipboard.insert')} onClick={() => onInsert(clip)} />}
                <IconButton icon={Copy} label={t('common.copy')} onClick={() => void copy(clip)} />
                <IconButton icon={clip.pinned ? PinOff : Pin} label={clip.pinned ? t('clipboard.unpin') : t('clipboard.pin')} onClick={() => void pin(clip)} />
                <IconButton icon={Trash2} label={t('common.delete')} onClick={() => void remove(clip)} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Schaltfläche in der Kopfleiste. */
export function ClipboardButton() {
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton ref={setAnchor} icon={ClipboardList} label={t('clipboard.title')} onClick={() => setOpen((o) => !o)} active={open} />
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom-end">
        {open && <ClipboardPanel onClose={() => setOpen(false)} />}
      </Popover>
    </>
  );
}

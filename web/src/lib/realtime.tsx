import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { MeResponse, PresenceUser } from '../api/types';
import { useToast } from './toast';
import { useI18n } from '../i18n';

export interface PageEventDetail {
  type: string;
  pageId: number;
  spaceId: number;
  spaceKey: string;
  version: number;
  actor: { id: number; displayName: string } | null;
}

/** Verbindet sich per Server-Sent Events mit dem Server (Benachrichtigungen, Live-Updates, Anwesenheit). */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { t } = useI18n();

  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    let source: EventSource | null = null;
    let retry: number | undefined;
    let closed = false;

    const connect = () => {
      source = new EventSource('/api/v1/stream');
      source.addEventListener('hello', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as { unread: number };
        qc.setQueryData<MeResponse>(['me'], (old) => (old ? { ...old, unreadNotifications: data.unread } : old));
      });
      source.addEventListener('notification', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as { title: string; link: string };
        qc.setQueryData<MeResponse>(['me'], (old) => (old ? { ...old, unreadNotifications: (old.unreadNotifications ?? 0) + 1 } : old));
        void qc.invalidateQueries({ queryKey: ['notifications'] });
        toast.info(data.title, { action: data.link ? { label: t('common.open'), onClick: () => navigate(data.link) } : undefined, duration: 6000 });
      });
      source.addEventListener('page', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as PageEventDetail;
        void qc.invalidateQueries({ queryKey: ['tree', data.spaceKey] });
        void qc.invalidateQueries({ queryKey: ['comments', data.pageId] });
        void qc.invalidateQueries({ queryKey: ['attachments', data.pageId] });
        void qc.invalidateQueries({ queryKey: ['activity'] });
        window.dispatchEvent(new CustomEvent<PageEventDetail>('knowstead:page-event', { detail: data }));
      });
      source.addEventListener('task', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as { spaceKey: string; taskId: number | null };
        void qc.invalidateQueries({ queryKey: ['board'] });
        void qc.invalidateQueries({ queryKey: ['boards', data.spaceKey] });
        void qc.invalidateQueries({ queryKey: ['tasks'] });
        // Offener Aufgabendialog: neue Nachrichten im Chat ohne Neuladen
        if (data.taskId) void qc.invalidateQueries({ queryKey: ['task-comments', data.taskId] });
      });
      source.addEventListener('presence', (e) => {
        const data = JSON.parse((e as MessageEvent).data) as { pageId: number; users: PresenceUser[] };
        qc.setQueryData(['presence', data.pageId], data.users);
      });
      source.onerror = () => {
        source?.close();
        if (!closed) retry = window.setTimeout(connect, 5000);
      };
    };
    connect();
    return () => {
      closed = true;
      window.clearTimeout(retry);
      source?.close();
    };
  }, [enabled, qc, toast, navigate, t]);
}

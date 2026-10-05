import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck } from 'lucide-react';
import { api } from '../api/client';
import type { MeResponse, Notification } from '../api/types';
import { useNotifications } from '../api/hooks';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { Avatar, EmptyState, IconButton, Loading, Popover, Time, cx } from './ui';

export function NotificationsBell() {
  const { data } = useAuth();
  const { t } = useI18n();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const unread = data?.unreadNotifications ?? 0;
  return (
    <>
      <span className="notif-button">
        <IconButton ref={setAnchor} icon={Bell} label={t('app.notifications')} onClick={() => setOpen((o) => !o)} active={open} />
        {unread > 0 && <span className="notif-dot">{unread > 99 ? '99+' : unread}</span>}
      </span>
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)} placement="bottom-end">
        {open && <NotificationPanel onClose={() => setOpen(false)} />}
      </Popover>
    </>
  );
}

function NotificationPanel({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useNotifications(false);

  const setUnread = (unread: number) => qc.setQueryData<MeResponse>(['me'], (old) => (old ? { ...old, unreadNotifications: unread } : old));

  const markAll = async () => {
    const res = await api.post<{ unread: number }>('/api/v1/me/notifications/read', { all: true });
    setUnread(res.unread);
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  const open = async (n: Notification) => {
    onClose();
    if (!n.read) {
      const res = await api.post<{ unread: number }>('/api/v1/me/notifications/read', { ids: [n.id] });
      setUnread(res.unread);
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    }
    if (n.link) navigate(n.link);
  };

  return (
    <div className="notif-panel">
      <div className="notif-panel-head">
        <span>{t('notifications.title')}</span>
        <div className="row gap-xs">
          <IconButton icon={CheckCheck} label={t('notifications.markAllRead')} onClick={markAll} />
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => {
              onClose();
              navigate('/notifications');
            }}
          >
            {t('notifications.showAll')}
          </button>
        </div>
      </div>
      <div className="notif-list">
        {isLoading && <Loading />}
        {data && data.items.length === 0 && <EmptyState compact icon={BellOff} title={t('notifications.empty')} />}
        {data?.items.slice(0, 20).map((n) => (
          <button key={n.id} type="button" className={cx('notif-item', !n.read && 'unread')} onClick={() => void open(n)}>
            <Avatar user={n.actor} size={30} />
            <div className="grow">
              <div className="notif-title">{n.title}</div>
              {n.body && <div className="notif-body">{n.body}</div>}
              <div className="notif-time">
                <Time value={n.createdAt} />
              </div>
            </div>
            {!n.read && <span className="unread-dot" />}
          </button>
        ))}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckCheck, Trash2 } from 'lucide-react';
import { api } from '../api/client';
import type { MeResponse, Notification } from '../api/types';
import { useNotifications } from '../api/hooks';
import { useI18n } from '../i18n';
import { Avatar, Button, Checkbox, EmptyState, Loading, PageHeader, Time, cx } from '../components/ui';

export default function NotificationsPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const { data, isLoading, refetch } = useNotifications(unreadOnly);
  const setUnread = (unread: number) => qc.setQueryData<MeResponse>(['me'], (old) => (old ? { ...old, unreadNotifications: unread } : old));

  const open = async (n: Notification) => {
    if (!n.read) {
      const res = await api.post<{ unread: number }>('/api/v1/me/notifications/read', { ids: [n.id] });
      setUnread(res.unread);
    }
    if (n.link) navigate(n.link);
  };

  return (
    <div className="container container-narrow">
      <PageHeader
        icon={Bell}
        title={t('notifications.title')}
        actions={
          <>
            <Checkbox checked={unreadOnly} onChange={setUnreadOnly} label={t('notifications.unreadOnly')} />
            <Button
              icon={CheckCheck}
              onClick={async () => {
                const res = await api.post<{ unread: number }>('/api/v1/me/notifications/read', { all: true });
                setUnread(res.unread);
                await refetch();
              }}
            >
              {t('notifications.markAllRead')}
            </Button>
            <Button
              icon={Trash2}
              variant="ghost"
              onClick={async () => {
                await api.del('/api/v1/me/notifications/read');
                await refetch();
              }}
            >
              {t('notifications.clearRead')}
            </Button>
          </>
        }
      />
      {isLoading && <Loading />}
      {data && data.items.length === 0 && <EmptyState icon={BellOff} title={t('notifications.empty')} />}
      {data && data.items.length > 0 && (
        <div className="card" style={{ overflow: 'hidden' }}>
          {data.items.map((n) => (
            <button key={n.id} type="button" className={cx('notif-item', !n.read && 'unread')} onClick={() => void open(n)}>
              <Avatar user={n.actor} size={32} />
              <div className="grow">
                <div className="notif-title">{n.title}</div>
                {n.body && <div className="notif-body">{n.body}</div>}
                <div className="notif-time">
                  <Time value={n.createdAt} mode="datetime" />
                </div>
              </div>
              {!n.read && <span className="unread-dot" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

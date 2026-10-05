import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { Activity, User } from '../../api/types';
import { useI18n } from '../../i18n';
import { Avatar, Badge, Card, EmptyState, ErrorView, Loading, Time } from '../../components/ui';
import { ActivityList } from '../../components/ActivityList';

export default function UserProfilePage() {
  const { username } = useParams();
  const { t } = useI18n();
  const { data, isLoading, error } = useQuery({
    queryKey: ['profile', username],
    queryFn: () => api.get<{ user: User; activity: Activity[]; stats: { pagesCreated: number; edits: number; comments: number } }>(`/api/v1/users/${encodeURIComponent(username!)}`),
    enabled: !!username,
  });
  if (isLoading) return <Loading />;
  if (error || !data) return <div className="container"><ErrorView error={error} /></div>;
  const { user, activity, stats } = data;
  return (
    <div className="container container-narrow">
      <div className="row gap-lg mb-3">
        <Avatar user={user} size={72} />
        <div>
          <h1 style={{ fontSize: 24 }}>{user.displayName}</h1>
          <div className="muted">
            @{user.username} {user.kind === 'bot' && <Badge color="purple">Bot</Badge>} {user.status === 'disabled' && <Badge color="red">{t('common.disabled')}</Badge>}
          </div>
          {user.email && (
            <div className="small">
              <a href={`mailto:${user.email}`}>{user.email}</a>
            </div>
          )}
          <div className="small muted mt-1">{t('profile.stats', { pages: stats.pagesCreated, edits: stats.edits, comments: stats.comments })}</div>
          {user.groups && user.groups.length > 0 && (
            <div className="row gap-xs mt-1">
              {user.groups.map((g) => (
                <Badge key={g.id}>{g.name}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      {user.bio && (
        <Card className="mb-3">
          <p style={{ whiteSpace: 'pre-wrap' }}>{user.bio}</p>
        </Card>
      )}
      <h3 className="mb-1">{t('profile.recentActivity')}</h3>
      {activity.length ? <ActivityList items={activity} /> : <EmptyState compact title={t('activity.empty')} />}
      <div className="small faint mt-2">
        {t('common.user')} seit <Time value={user.createdAt} mode="date" />
      </div>
    </div>
  );
}

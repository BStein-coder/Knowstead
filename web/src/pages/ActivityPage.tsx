import { Activity as ActivityIcon } from 'lucide-react';
import { useActivity } from '../api/hooks';
import { useI18n } from '../i18n';
import { Button, EmptyState, Loading, PageHeader } from '../components/ui';
import { ActivityList } from '../components/ActivityList';

export default function ActivityPage() {
  const { t } = useI18n();
  const query = useActivity();
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <div className="container container-narrow">
      <PageHeader icon={ActivityIcon} title={t('activity.title')} subtitle={t('activity.subtitle')} />
      {query.isLoading && <Loading />}
      {!query.isLoading && items.length === 0 && <EmptyState icon={ActivityIcon} title={t('activity.empty')} />}
      <ActivityList items={items} />
      {query.hasNextPage && (
        <div className="center mt-2">
          <Button loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {t('activity.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

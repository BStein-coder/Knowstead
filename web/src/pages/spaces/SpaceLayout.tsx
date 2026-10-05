import { lazy, Suspense } from 'react';
import { Link, Outlet, useOutletContext, useParams } from 'react-router';
import { Archive, FolderX } from 'lucide-react';
import { useSpace } from '../../api/hooks';
import type { Space } from '../../api/types';
import { useI18n } from '../../i18n';
import { EmptyState, Loading } from '../../components/ui';

export interface SpaceOutletContext {
  space: Space;
}

export function useSpaceContext(): SpaceOutletContext {
  return useOutletContext<SpaceOutletContext>();
}

export function SpaceLayout() {
  const { spaceKey } = useParams();
  const { t } = useI18n();
  const { data: space, isLoading, error } = useSpace(spaceKey);
  if (isLoading) return <Loading />;
  if (error || !space) {
    return (
      <div className="container">
        <EmptyState
          icon={FolderX}
          title={t('errors.notFoundTitle')}
          text={(error as Error | null)?.message ?? t('errors.notFoundText')}
          action={
            <Link className="btn btn-primary" to="/spaces">
              {t('dashboard.allSpaces')}
            </Link>
          }
        />
      </div>
    );
  }
  return (
    <>
      {space.archivedAt && (
        <div className="banner">
          <Archive size={16} />
          <span>{t('spaces.archivedBanner')}</span>
        </div>
      )}
      <Outlet context={{ space } satisfies SpaceOutletContext} />
    </>
  );
}

const PageView = lazy(() => import('../page/PageView').then((m) => ({ default: m.PageView })));

export function SpaceHome() {
  const { space } = useSpaceContext();
  const { t } = useI18n();
  if (!space.homePageId) {
    return (
      <div className="container">
        <EmptyState icon={FolderX} title={space.name} text={space.description || t('spaces.treeEmpty')} />
      </div>
    );
  }
  return (
    <Suspense fallback={<Loading />}>
      <PageView pageId={space.homePageId} />
    </Suspense>
  );
}

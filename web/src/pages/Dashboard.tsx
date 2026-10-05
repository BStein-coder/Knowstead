import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Activity as ActivityIcon, CalendarDays, Clock, FilePen, FilePlus2, FolderOpen, Search, Star } from 'lucide-react';
import { api } from '../api/client';
import type { Activity, PageSummary } from '../api/types';
import { useSpaces } from '../api/hooks';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { useCountUp } from '../lib/motion';
import { OnboardingChecklist } from '../lib/onboarding';
import { useToast } from '../lib/toast';
import { Card, EmptyState, Loading, Time } from '../components/ui';
import { ActivityList } from '../components/ActivityList';
import { ChooseSpaceDialog } from '../components/ChooseSpaceDialog';
import { Reveal } from '../components/Reveal';
import { Scene3D } from '../components/Scene3D';

function PageRows({ pages, empty, timeKey = 'updatedAt' }: { pages: PageSummary[] | undefined; empty: string; timeKey?: 'updatedAt' | 'viewedAt' | 'draftUpdatedAt' }) {
  if (!pages) return <Loading inline />;
  if (!pages.length) return <div className="small muted" style={{ padding: '0.25rem 0.75rem' }}>{empty}</div>;
  return (
    <div className="list">
      {pages.map((p) => (
        <Link key={`${p.id}-${p.kind ?? ''}`} to={p.kind === 'new' || p.kind === 'edit' ? `/s/${encodeURIComponent(p.spaceKey)}/edit/${p.id}` : p.url} className="list-item">
          <span className="list-item-icon">{p.icon ?? '📄'}</span>
          <span className="list-item-body">
            <div className="list-item-title">{p.title || '(ohne Titel)'}</div>
            <div className="list-item-meta">{p.spaceName}</div>
          </span>
          <span className="small muted nowrap">
            <Time value={(p[timeKey] as string | undefined) ?? p.updatedAt} />
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Kennzahl im Kopf der Startseite: zählt beim Erscheinen hoch und führt zur passenden Ansicht. */
function HeroStat({ to, value, one, many }: { to: string; value: number | undefined; one: string; many: string }) {
  const shown = useCountUp(value);
  if (value === undefined) return null;
  return (
    <Link to={to} className="hero-stat">
      <b>{shown ?? value}</b> {value === 1 ? one : many}
    </Link>
  );
}

export function Dashboard() {
  const { t, locale } = useI18n();
  const { user, settings, data } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [choose, setChoose] = useState(false);
  const recent = useQuery({ queryKey: ['recent'], queryFn: () => api.get<PageSummary[]>('/api/v1/me/recent', { limit: 8 }), enabled: !!user });
  const favorites = useQuery({ queryKey: ['favorites'], queryFn: () => api.get<PageSummary[]>('/api/v1/me/favorites'), enabled: !!user });
  const drafts = useQuery({ queryKey: ['drafts'], queryFn: () => api.get<PageSummary[]>('/api/v1/me/drafts'), enabled: !!user });
  const activity = useQuery({ queryKey: ['activity', 'dashboard'], queryFn: () => api.get<{ items: Activity[] }>('/api/v1/activity', { limit: 15 }) });
  const { data: spaces } = useSpaces({});

  const hour = new Date().getHours();
  const greeting = hour < 11 ? 'dashboard.greetingMorning' : hour < 18 ? 'dashboard.greetingDay' : 'dashboard.greetingEvening';
  const allTeam = useMemo(() => (spaces ?? []).filter((s) => s.kind === 'team'), [spaces]);
  const teamSpaces = allTeam.slice(0, 8);
  const pageTotal = useMemo(() => (spaces ? allTeam.reduce((sum, s) => sum + (s.pageCount ?? 0), 0) : undefined), [spaces, allTeam]);
  const today = useMemo(() => new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : 'de-DE', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()), [locale]);

  const openJournal = async () => {
    try {
      const res = await api.post<{ url: string }>('/api/v1/journal/today', {});
      navigate(res.url);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="container container-wide">
      <section className="hero" data-spot="">
        <Scene3D variant="hero" scroll />
        <div className="hero-content">
          <p className="hero-eyebrow">{today}</p>
          <h1 className="hero-title">{user ? t(greeting, { name: user.displayName.split(' ')[0] }) : settings.siteName}</h1>
          <p className="hero-sub">{user ? settings.siteTagline : t('dashboard.welcomeAnon')}</p>
          <div className="hero-stats">
            <HeroStat to="/spaces" value={spaces ? allTeam.length : undefined} one={t('dashboard.statSpace')} many={t('dashboard.statSpaces')} />
            <HeroStat to="/search" value={pageTotal} one={t('dashboard.statPage')} many={t('dashboard.statPages')} />
            {user && !!data?.openTasks && <HeroStat to="/tasks" value={data.openTasks} one={t('dashboard.statTask')} many={t('dashboard.statTasks')} />}
            {user && !!data?.unreadNotifications && (
              <HeroStat to="/notifications" value={data.unreadNotifications} one={t('dashboard.statUnreadOne')} many={t('dashboard.statUnread')} />
            )}
          </div>
        </div>
      </section>

      {user && (
        <div className="quick-actions stagger">
          <button type="button" className="quick-action" data-tilt="5" onClick={() => setChoose(true)}>
            <span className="quick-action-icon">
              <FilePlus2 size={18} />
            </span>
            {t('app.newPage')}
          </button>
          {settings.personalSpaces && (
            <button type="button" className="quick-action" data-tilt="5" onClick={() => void openJournal()}>
              <span className="quick-action-icon">
                <CalendarDays size={18} />
              </span>
              {t('app.today')}
            </button>
          )}
          <Link to="/search" className="quick-action" data-tilt="5">
            <span className="quick-action-icon">
              <Search size={18} />
            </span>
            {t('nav.search')}
          </Link>
          <Link to="/spaces" className="quick-action" data-tilt="5">
            <span className="quick-action-icon">
              <FolderOpen size={18} />
            </span>
            {t('dashboard.allSpaces')}
          </Link>
        </div>
      )}

      <OnboardingChecklist />

      <div className="dashboard-grid">
        <div className="col gap-lg">
          {user && (
            <Reveal>
              <Card spot title={<><Clock size={15} /> {t('dashboard.recent')}</>} padded={false}>
                <div style={{ padding: '0.4rem' }}>
                  <PageRows pages={recent.data} empty={t('dashboard.noRecent')} timeKey="viewedAt" />
                </div>
              </Card>
            </Reveal>
          )}
          <Reveal index={1}>
            <Card spot title={<><ActivityIcon size={15} /> {t('dashboard.activity')}</>} actions={<Link to="/activity" className="small">{t('common.showMore')}</Link>}>
              {activity.isLoading ? <Loading inline /> : activity.data?.items.length ? <ActivityList items={activity.data.items} compact /> : <EmptyState compact title={t('dashboard.noActivity')} />}
            </Card>
          </Reveal>
        </div>
        <div className="col gap-lg">
          {user && (
            <Reveal index={1}>
              <Card spot title={<><Star size={15} /> {t('dashboard.favorites')}</>} padded={false}>
                <div style={{ padding: '0.4rem' }}>
                  <PageRows pages={favorites.data} empty={t('dashboard.noFavorites')} />
                </div>
              </Card>
            </Reveal>
          )}
          {user && drafts.data && drafts.data.length > 0 && (
            <Reveal index={2}>
              <Card spot title={<><FilePen size={15} /> {t('dashboard.drafts')}</>} padded={false} actions={<Link to="/drafts" className="small">{t('common.showMore')}</Link>}>
                <div style={{ padding: '0.4rem' }}>
                  <PageRows pages={drafts.data.slice(0, 5)} empty={t('dashboard.noDrafts')} timeKey="draftUpdatedAt" />
                </div>
              </Card>
            </Reveal>
          )}
          <Reveal index={2}>
            <Card spot title={<><FolderOpen size={15} /> {t('dashboard.mySpaces')}</>} padded={false} actions={<Link to="/spaces" className="small">{t('common.all')}</Link>}>
              <div className="list" style={{ padding: '0.4rem' }}>
                {teamSpaces.map((s) => (
                  <Link key={s.key} to={`/s/${encodeURIComponent(s.key)}`} className="list-item">
                    <span className="space-icon" style={{ width: 30, height: 30, fontSize: 16, background: s.color ? `${s.color}22` : undefined }}>
                      {s.icon ?? '📘'}
                    </span>
                    <span className="list-item-body">
                      <div className="list-item-title">{s.name}</div>
                      <div className="list-item-meta">{t('spaces.pagesCount', { n: s.pageCount ?? 0 })}</div>
                    </span>
                  </Link>
                ))}
                {teamSpaces.length === 0 && <div className="small muted" style={{ padding: '0.25rem 0.75rem' }}>{t('spaces.empty')}</div>}
              </div>
            </Card>
          </Reveal>
        </div>
      </div>
      <ChooseSpaceDialog open={choose} onClose={() => setChoose(false)} />
    </div>
  );
}

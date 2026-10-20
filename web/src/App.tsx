import { lazy, Suspense, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, useLocation } from 'react-router';
import { useAuth } from './lib/auth';
import { Loading } from './components/ui';
import { AppShell } from './layout/AppShell';
import { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/auth/AuthPages';
import { SetupPage } from './pages/auth/SetupPage';
import { Dashboard } from './pages/Dashboard';
import { SpacesPage } from './pages/spaces/SpacesPage';
import { SpaceLayout, SpaceHome } from './pages/spaces/SpaceLayout';
import { NotFound } from './pages/NotFound';
import { RouteError } from './pages/RouteError';

// Seitenansicht und Editor bringen TipTap, ProseMirror und Syntaxhervorhebung mit – erst laden, wenn eine Seite geöffnet wird
const PageView = lazyPage(() => import('./pages/page/PageView').then((m) => ({ default: m.PageView })));
const PageEdit = lazyPage(() => import('./pages/page/PageEdit'));
const NewPage = lazyPage(() => import('./pages/page/NewPage'));
const PageHistory = lazyPage(() => import('./pages/page/PageHistory'));
const PageDiff = lazyPage(() => import('./pages/page/PageDiff'));
const RevisionView = lazyPage(() => import('./pages/page/RevisionView'));
const SpaceChangelog = lazyPage(() => import('./pages/spaces/SpaceChangelog'));
const SpaceTrash = lazyPage(() => import('./pages/spaces/SpaceTrash'));
const SpaceSettings = lazyPage(() => import('./pages/spaces/SpaceSettings'));
const SearchPage = lazyPage(() => import('./pages/SearchPage'));
const ActivityPage = lazyPage(() => import('./pages/ActivityPage'));
const NotificationsPage = lazyPage(() => import('./pages/NotificationsPage'));
const DraftsPage = lazyPage(() => import('./pages/DraftsPage'));
const ProfilePage = lazyPage(() => import('./pages/profile/ProfilePage'));
const UserProfilePage = lazyPage(() => import('./pages/profile/UserProfilePage'));
const JournalPage = lazyPage(() => import('./pages/JournalPage'));
const ReviewsPage = lazyPage(() => import('./pages/ReviewsPage'));
const ChangesPage = lazyPage(() => import('./pages/ChangesPage'));
const TagsPage = lazyPage(() => import('./pages/TagsPage'));
const ContentReviewsPage = lazyPage(() => import('./pages/ContentReviewsPage'));
const AnalyticsPage = lazyPage(() => import('./pages/AnalyticsPage'));
const ReadConfirmationsPage = lazyPage(() => import('./pages/ReadConfirmationsPage'));
const MyTasksPage = lazyPage(() => import('./pages/tasks/MyTasksPage'));
const BoardPage = lazyPage(() => import('./pages/tasks/BoardPage'));
const CalendarPage = lazyPage(() => import('./pages/tasks/CalendarPage'));
const ProjectsPage = lazyPage(() => import('./pages/tasks/ProjectsPage'));
const AdminRoutes = lazyPage(() => import('./pages/admin/AdminRoutes'));

const RELOAD_KEY = 'knowstead.reloadedForUpdate';

/**
 * Lazy geladene Seite. Nach einem Update gibt es die Programmteile der alten Version nicht mehr – ein
 * geöffneter Tab lädt dann einmal neu und erhält die aktuelle Oberfläche statt einer Fehlermeldung.
 */
function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load();
    } catch (err) {
      try {
        const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
        if (Date.now() - last > 30_000) {
          sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
          window.location.reload();
          return await new Promise<never>(() => {});
        }
      } catch {
        /* Speicher gesperrt: nicht in eine Neulade-Schleife laufen */
      }
      throw err;
    }
  });
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

/** Leitet nicht angemeldete Besucher zur Anmeldung um (außer bei öffentlichem Zugriff). */
function Guard({ children, requireUser }: { children: ReactNode; requireUser?: boolean }) {
  const { data, user, loading, settings } = useAuth();
  const location = useLocation();
  if (loading || !data) return <Loading />;
  if (data.needsSetup) return <Navigate to="/setup" replace />;
  if (!user && (requireUser || !settings.anonymousAccess)) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  }
  return <>{children}</>;
}

export const router = createBrowserRouter([
  { path: '/setup', element: <SetupPage />, errorElement: <RouteError /> },
  { path: '/login', element: <LoginPage />, errorElement: <RouteError /> },
  { path: '/register', element: <RegisterPage />, errorElement: <RouteError /> },
  { path: '/forgot-password', element: <ForgotPasswordPage />, errorElement: <RouteError /> },
  { path: '/reset-password/:token', element: <ResetPasswordPage />, errorElement: <RouteError /> },
  { path: '/verify-email/:token', element: <VerifyEmailPage />, errorElement: <RouteError /> },
  {
    element: (
      <Guard>
        <AppShell />
      </Guard>
    ),
    errorElement: <RouteError />,
    children: [
      {
        // Fehler einer Unterseite: Kopfleiste und Navigation bleiben stehen
        errorElement: <RouteError />,
        children: [
      { index: true, element: <Dashboard /> },
      { path: 'spaces', element: <SpacesPage /> },
      {
        path: 's/:spaceKey',
        element: <SpaceLayout />,
        children: [
          { index: true, element: <SpaceHome /> },
          { path: 'p/:pageId/:slug?', element: <Lazy><PageView /></Lazy> },
          { path: 'edit/:pageId', element: <Lazy><Guard requireUser><PageEdit /></Guard></Lazy> },
          { path: 'new', element: <Lazy><Guard requireUser><NewPage /></Guard></Lazy> },
          { path: 'history/:pageId', element: <Lazy><PageHistory /></Lazy> },
          { path: 'history/:pageId/v/:version', element: <Lazy><RevisionView /></Lazy> },
          { path: 'diff/:pageId', element: <Lazy><PageDiff /></Lazy> },
          { path: 'changelog', element: <Lazy><SpaceChangelog /></Lazy> },
          { path: 'trash', element: <Lazy><SpaceTrash /></Lazy> },
          { path: 'tasks', element: <Lazy><Guard requireUser><BoardPage /></Guard></Lazy> },
          { path: 'settings/:tab?', element: <Lazy><SpaceSettings /></Lazy> },
        ],
      },
      { path: 'search', element: <Lazy><SearchPage /></Lazy> },
      { path: 'activity', element: <Lazy><ActivityPage /></Lazy> },
      { path: 'notifications', element: <Lazy><Guard requireUser><NotificationsPage /></Guard></Lazy> },
      { path: 'drafts', element: <Lazy><Guard requireUser><DraftsPage /></Guard></Lazy> },
      { path: 'journal', element: <Lazy><Guard requireUser><JournalPage /></Guard></Lazy> },
      { path: 'reviews', element: <Lazy><Guard requireUser><ReviewsPage /></Guard></Lazy> },
      { path: 'changes', element: <Lazy><Guard requireUser><ChangesPage /></Guard></Lazy> },
      { path: 'tasks', element: <Lazy><Guard requireUser><MyTasksPage /></Guard></Lazy> },
      { path: 'projects', element: <Lazy><Guard requireUser><ProjectsPage /></Guard></Lazy> },
      { path: 'calendar', element: <Lazy><Guard requireUser><CalendarPage /></Guard></Lazy> },
      { path: 'content-reviews', element: <Lazy><Guard requireUser><ContentReviewsPage /></Guard></Lazy> },
      { path: 'analytics', element: <Lazy><Guard requireUser><AnalyticsPage /></Guard></Lazy> },
      { path: 'read-confirmations', element: <Lazy><Guard requireUser><ReadConfirmationsPage /></Guard></Lazy> },
      { path: 'tags', element: <Lazy><TagsPage /></Lazy> },
      { path: 'people/:username', element: <Lazy><UserProfilePage /></Lazy> },
      { path: 'profile/:tab?', element: <Lazy><Guard requireUser><ProfilePage /></Guard></Lazy> },
      { path: 'admin/*', element: <Lazy><Guard requireUser><AdminRoutes /></Guard></Lazy> },
      { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
]);

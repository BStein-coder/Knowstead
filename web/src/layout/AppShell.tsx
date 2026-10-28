import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { useAuth } from '../lib/auth';
import { useRealtime } from '../lib/realtime';
import { bindPluginRuntime, loadClientPlugins } from '../lib/plugins';
import { useToast } from '../lib/toast';
import { useI18n } from '../i18n';
import { cx } from '../components/ui';
import { TopBar } from './TopBar';
import { Sidebar } from './Sidebar';
import { CommandPalette } from '../components/CommandPalette';
import { OnboardingTour, useOnboarding } from '../lib/onboarding';
import { ShortcutHelp } from '../components/ShortcutHelp';

const SIDEBAR_KEY = 'knowstead.sidebar';

export function AppShell() {
  const { user } = useAuth();
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const editing = !!useMatch('/s/:spaceKey/edit/:pageId');
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === 'collapsed';
    } catch {
      return false;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const onboarding = useOnboarding();
  const [tourOpen, setTourOpen] = useState(false);

  useRealtime(!!user);

  // Seitenansicht im Leerlauf vorladen: die erste geöffnete Seite erscheint ohne Wartezeit
  useEffect(() => {
    const load = () => void import('../pages/page/PageView').catch(() => undefined);
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(load, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(load, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Rundgang beim ersten Besuch bzw. nach „Rundgang erneut ansehen“.
  const tourStarted = useRef(false);
  useEffect(() => {
    if (!user) return;
    // Ausdrücklich angefordert (Hilfemenü) – hat immer Vorrang.
    if (onboarding.state.tourDone === false) {
      setTourOpen(true);
      return;
    }
    if (tourStarted.current) return;
    const params = new URLSearchParams(window.location.search);
    // Direkt aus der Ersteinrichtung zu „Nächste Schritte“: Rundgang in dieser Sitzung nicht über die Liste legen
    if (params.get('tour') === '0') {
      tourStarted.current = true;
      params.delete('tour');
      const rest = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
      return;
    }
    if (params.get('tour') === '1') {
      tourStarted.current = true;
      setTourOpen(true);
      // Parameter entfernen, damit ein Neuladen den Rundgang nicht erneut startet.
      params.delete('tour');
      const rest = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
      return;
    }
    if (onboarding.state.tourDone === undefined) {
      const timer = window.setTimeout(() => {
        tourStarted.current = true;
        setTourOpen(true);
      }, 900);
      return () => window.clearTimeout(timer);
    }
  }, [user, onboarding.state.tourDone]);

  useEffect(() => {
    bindPluginRuntime((m, kind) => toast.show(kind ?? 'info', m), (to) => navigate(to));
    void loadClientPlugins();
  }, [toast, navigate]);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  const toggleSidebar = useCallback(() => {
    if (window.matchMedia('(max-width: 760px)').matches) {
      setMobileOpen((o) => !o);
      return;
    }
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? 'open' : 'collapsed');
      } catch {
        /* ignorieren */
      }
      return !c;
    });
  }, []);

  // Globale Tastenkürzel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !target.closest('.doc.editing')) {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '/') {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === '?') {
        setHelpOpen(true);
      } else if (e.key === '[') {
        toggleSidebar();
      } else if (e.key.toLowerCase() === 'g') {
        const next = (ev: KeyboardEvent) => {
          window.removeEventListener('keydown', next, true);
          const k = ev.key.toLowerCase();
          if (k === 'h') navigate('/');
          if (k === 's') navigate('/spaces');
          if (k === 'a') navigate('/activity');
          if (k === 'd') navigate('/drafts');
          if (k === 'n') navigate('/notifications');
        };
        window.addEventListener('keydown', next, true);
        window.setTimeout(() => window.removeEventListener('keydown', next, true), 1500);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, toggleSidebar]);

  // Kopfleiste hebt sich ab, sobald Inhalt darunter liegt. Als Attribut direkt am Element: Scrollen soll
  // die Anwendung nicht neu rendern.
  const appRef = useRef<HTMLDivElement>(null);
  const onMainScroll = useCallback((e: React.UIEvent<HTMLElement>) => {
    appRef.current?.toggleAttribute('data-scrolled', e.currentTarget.scrollTop > 6);
  }, []);

  return (
    <div ref={appRef} className={cx('app', (collapsed || editing) && 'sidebar-collapsed', mobileOpen && 'sidebar-open-mobile')}>
      <a className="skip-link" href="#main">
        {t('app.skipToContent')}
      </a>
      <TopBar onToggleSidebar={toggleSidebar} onOpenPalette={() => setPaletteOpen(true)} onOpenHelp={() => setHelpOpen(true)} />
      <Sidebar />
      {/* Pfeil an der Kante der Seitenleiste: zeigt, dass sie sich ein- und ausklappen lässt (wie „[“ und der Knopf oben links).
          Im Editor ist die Leiste ohnehin ausgeblendet, auf schmalen Fenstern gibt es die Schublade. */}
      {!editing && (
        <button
          type="button"
          className="sidebar-handle"
          onClick={toggleSidebar}
          aria-label={t(collapsed ? 'app.expandSidebar' : 'app.collapseSidebar')}
          title={`${t(collapsed ? 'app.expandSidebar' : 'app.collapseSidebar')} ( [ )`}
          aria-expanded={!collapsed}
          aria-controls="sidebar"
        >
          {collapsed ? <ChevronRight size={14} aria-hidden="true" /> : <ChevronLeft size={14} aria-hidden="true" />}
        </button>
      )}
      {/* Schleier hinter der Schublade der Seitenleiste (nur auf schmalen Fenstern sichtbar): Tippen schließt sie */}
      <div className="sidebar-backdrop" aria-hidden="true" onClick={() => setMobileOpen(false)} />
      <main className="main" id="main" onScroll={onMainScroll}>
        <Outlet />
      </main>
      <OnboardingTour
        open={tourOpen && !!user}
        onClose={() => {
          setTourOpen(false);
          onboarding.finishTour();
        }}
      />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

import { useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import {
  BookOpen,
  CalendarDays,
  FilePlus2,
  FileText,
  FolderPlus,
  HelpCircle,
  GlassWater,
  Keyboard,
  Languages,
  LayoutDashboard,
  LogIn,
  LogOut,
  Menu as MenuIcon,
  Monitor,
  Moon,
  Move3d,
  Plus,
  ScrollText,
  Sparkles,
  Search,
  Settings,
  Shield,
  Snowflake,
  Sun,
  User,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { useOnboarding } from '../lib/onboarding';
import { ClipboardButton } from '../components/Clipboard';
import { Avatar, Button, IconButton, Kbd, Menu } from '../components/ui';
import { NotificationsBell } from '../components/NotificationsBell';
import { CreateSpaceDialog } from '../components/CreateSpaceDialog';
import { ChooseSpaceDialog } from '../components/ChooseSpaceDialog';
import { api } from '../api/client';
import { useToast } from '../lib/toast';
import { applyTheme, storedTheme } from '../lib/theme';
import { applyMotion, useMotionMode } from '../lib/motion';
import { applyAppearance, useAppearance, type Appearance } from '../lib/appearance';
import { modKey } from '../lib/utils';

interface Props {
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  onOpenHelp: () => void;
}

export function TopBar({ onToggleSidebar, onOpenPalette, onOpenHelp }: Props) {
  const { user, settings, isAdmin, can, logout, updatePreferences, data } = useAuth();
  const { t, locale, setLocale } = useI18n();
  const onboarding = useOnboarding();
  const navigate = useNavigate();
  const toast = useToast();
  const spaceMatch = useMatch('/s/:spaceKey/*');
  const pageMatch = useMatch('/s/:spaceKey/p/:pageId/*');
  const [createSpace, setCreateSpace] = useState(false);
  const [chooseSpace, setChooseSpace] = useState(false);

  const newPage = () => {
    const key = spaceMatch?.params.spaceKey;
    if (key) {
      const parent = pageMatch?.params.pageId;
      navigate(`/s/${encodeURIComponent(key)}/new${parent ? `?parent=${parent}` : ''}`);
    } else setChooseSpace(true);
  };

  const openJournal = async () => {
    try {
      const res = await api.post<{ url: string }>('/api/v1/journal/today', {});
      navigate(res.url);
    } catch (err) {
      toast.error(err);
    }
  };

  const setTheme = (mode: 'light' | 'dark' | 'system') => {
    applyTheme(mode);
    if (user) void updatePreferences({ theme: mode });
  };

  const changeLocale = (next: 'de' | 'en') => {
    setLocale(next);
    if (user) void updatePreferences({ locale: next });
  };

  const theme = (user?.preferences.theme as 'light' | 'dark' | 'system' | undefined) ?? storedTheme();
  const appearance = useAppearance();
  const setAppearance = (next: Appearance) => {
    applyAppearance(next);
    if (user) void updatePreferences({ appearance: next });
  };
  const motion = useMotionMode();
  const toggleMotion = () => {
    const next = motion === 'full' ? 'reduced' : 'full';
    applyMotion(next, true);
    if (user) void updatePreferences({ motion: next });
  };

  return (
    <header className="topbar">
      <IconButton icon={MenuIcon} label={t('app.toggleSidebar')} onClick={onToggleSidebar} />
      <Link to="/" className="brand">
        <span className="brand-logo">
          <BookOpen size={16} />
        </span>
        <span className="brand-name">{settings.siteName}</span>
      </Link>

      <button type="button" className="topbar-search" onClick={onOpenPalette}>
        <Search size={15} />
        <span>{t('app.searchPlaceholder')}</span>
        <Kbd>{modKey(locale)} K</Kbd>
      </button>

      <div className="topbar-actions">
        {user && (
          <Menu
            placement="bottom-end"
            trigger={(p) => (
              <Button {...p} variant="primary" size="sm" icon={Plus} ref={p.ref as never} data-tour="create">
                {t('app.create')}
              </Button>
            )}
            items={[
              { label: t('app.newPage'), icon: FilePlus2, onClick: newPage, shortcut: 'C' },
              { label: t('app.newSpace'), icon: FolderPlus, onClick: () => setCreateSpace(true), hidden: !can('spaces.create') },
              { separator: true, hidden: !settings.personalSpaces },
              { label: t('app.today'), icon: CalendarDays, onClick: openJournal, hidden: !settings.personalSpaces },
            ]}
          />
        )}
        {user && <ClipboardButton />}
        {user && <NotificationsBell />}
        <Menu
          placement="bottom-end"
          trigger={(p) => <IconButton {...p} ref={p.ref as never} icon={HelpCircle} label={t('common.help')} />}
          items={[
            { label: t('app.shortcuts'), icon: Keyboard, onClick: onOpenHelp, shortcut: '?' },
            { label: t('app.apiDocs'), icon: FileText, href: '/api/docs' },
            { label: t('app.releaseNotes'), icon: ScrollText, onClick: () => navigate('/admin/about'), hint: `Knowstead ${data?.version ?? ''}` },
            { label: t('a11y.handbook'), icon: BookOpen, onClick: () => navigate('/s/HANDBUCH') },
            { label: t('onboarding.tourAgain'), icon: Sparkles, onClick: () => onboarding.resetTour(), hidden: !user },
          ]}
        />
        {user ? (
          <Menu
            placement="bottom-end"
            trigger={(p) => (
              <button {...p} ref={p.ref as never} type="button" className="user-button" aria-label={user.displayName} data-tour="user">
                <Avatar user={user} size={30} />
              </button>
            )}
            items={[
              { heading: user.displayName },
              { label: t('app.profile'), icon: User, onClick: () => navigate('/profile') },
              {
                label: t('app.personalSpace'),
                icon: BookOpen,
                hidden: !settings.personalSpaces,
                onClick: async () => {
                  try {
                    const sp = await api.post<{ key: string }>('/api/v1/me/personal-space', {});
                    navigate(`/s/${encodeURIComponent(sp.key)}`);
                  } catch (err) {
                    toast.error(err);
                  }
                },
              },
              { label: t('nav.drafts'), icon: FileText, onClick: () => navigate('/drafts') },
              { separator: true },
              { heading: t('app.theme') },
              { label: t('app.themeLight'), icon: Sun, checked: theme === 'light', onClick: () => setTheme('light') },
              { label: t('app.themeDark'), icon: Moon, checked: theme === 'dark', onClick: () => setTheme('dark') },
              { label: t('app.themeSystem'), icon: Monitor, checked: theme === 'system', onClick: () => setTheme('system') },
              { separator: true },
              { heading: t('app.appearance') },
              { label: t('app.appearanceClassic'), icon: LayoutDashboard, checked: appearance === 'classic', onClick: () => setAppearance('classic') },
              { label: t('app.appearanceGlass'), icon: GlassWater, checked: appearance === 'glass', onClick: () => setAppearance('glass') },
              { label: t('app.appearancePaper'), icon: FileText, checked: appearance === 'paper', onClick: () => setAppearance('paper') },
              { label: t('app.appearanceFrost'), icon: Snowflake, checked: appearance === 'frost', onClick: () => setAppearance('frost') },
              { separator: true },
              { label: t('app.motion'), icon: Move3d, checked: motion === 'full', onClick: toggleMotion },
              {
                label: `${t('app.language')}: ${locale === 'de' ? 'Deutsch' : 'English'}`,
                icon: Languages,
                onClick: () => changeLocale(locale === 'de' ? 'en' : 'de'),
              },
              { label: t('app.admin'), icon: isAdmin ? Shield : Settings, onClick: () => navigate('/admin'), hidden: !isAdmin && !can('users.manage') && !can('audit.view') && !can('integrations.manage') && !can('templates.manage') },
              { separator: true },
              { label: t('app.logout'), icon: LogOut, onClick: () => void logout() },
            ]}
          />
        ) : (
          <Button size="sm" icon={LogIn} onClick={() => navigate(`/login?next=${encodeURIComponent(window.location.pathname)}`)}>
            {t('app.login')}
          </Button>
        )}
      </div>
      <CreateSpaceDialog open={createSpace} onClose={() => setCreateSpace(false)} />
      <ChooseSpaceDialog open={chooseSpace} onClose={() => setChooseSpace(false)} />
    </header>
  );
}

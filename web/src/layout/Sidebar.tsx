import type { CSSProperties } from 'react';
import { NavLink, useLocation, useMatch, useNavigate } from 'react-router';
import {
  Activity,
  Archive,
  BarChart3,
  Bell,
  BookOpen,
  BrainCircuit,
  CalendarDays,
  ClipboardCheck,
  Database,
  FileClock,
  FileOutput,
  FileSignature,
  FileText,
  FolderKanban,
  FolderOpen,
  History,
  Home,
  Info,
  KanbanSquare,
  KeyRound,
  LayoutTemplate,
  ListChecks,
  Mail,
  Network,
  Plug,
  Plus,
  Puzzle,
  ScrollText,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  UsersRound,
  Webhook,
  Wrench,
} from 'lucide-react';
import { groupByCategory, useSpace, useSpaceCategories, useSpaces } from '../api/hooks';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { Badge, IconButton, cx } from '../components/ui';
import { PageTree } from './PageTree';

export function Sidebar() {
  const { t } = useI18n();
  const spaceMatch = useMatch('/s/:spaceKey/*');
  const adminMatch = useMatch('/admin/*');
  return (
    <aside className="sidebar" aria-label={t('a11y.navigation')}>
      {adminMatch ? <AdminNav /> : spaceMatch ? <SpaceNav spaceKey={spaceMatch.params.spaceKey!} /> : <GlobalNav />}
    </aside>
  );
}

function NavItem({ to, icon: Icon, label, end, count, emoji }: { to: string; icon?: typeof Home; label: string; end?: boolean; count?: number; emoji?: string | null }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => cx('nav-link', isActive && 'active')} data-spot="">
      {emoji ? <span className="nav-emoji">{emoji}</span> : Icon ? <Icon size={16} /> : null}
      <span className="truncate">{label}</span>
      {count !== undefined && count > 0 && <span className="nav-count">{count}</span>}
    </NavLink>
  );
}

function GlobalNav() {
  const { t } = useI18n();
  const { user, data, can } = useAuth();
  const { data: spaces } = useSpaces({});
  const team = (spaces ?? []).filter((s) => s.kind === 'team');
  // Inhaltsanalyse: globales Recht oder Verwaltung mindestens eines Bereichs
  const canAnalyse = !!user && (can('analytics.view') || team.some((s) => s.can.admin));
  const watched = team.filter((s) => s.isWatching);
  const shown = (watched.length ? [...watched, ...team.filter((s) => !s.isWatching)] : team).slice(0, 14);
  const { data: categories = [] } = useSpaceCategories();
  // Nach Kategorie gliedern (Reihenfolge aus der Administration), sonst eine Liste „Meine Bereiche“.
  const grouped = groupByCategory(shown, categories, t('spaces.otherCategory'));
  const spaceGroups = grouped.length && grouped[0].key !== 'other' ? grouped : [{ key: 'mine', title: t('nav.mySpaces'), icon: null, items: shown }];
  const personal = (spaces ?? []).find((s) => s.kind === 'personal' && s.ownerId === user?.id);
  return (
    <>
      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <NavItem to="/" end icon={Home} label={t('nav.home')} />
          <NavItem to="/spaces" icon={FolderOpen} label={t('nav.spaces')} />
          <NavItem to="/search" icon={Search} label={t('nav.search')} />
          <NavItem to="/activity" icon={Activity} label={t('nav.activity')} />
          <NavItem to="/tags" icon={Tag} label={t('tags.title')} />
          {user && <NavItem to="/tasks" icon={ListChecks} label={t('tasks.myTitle')} count={data?.openTasks} />}
          {user && <NavItem to="/projects" icon={FolderKanban} label={t('nav.projects')} />}
          {user && <NavItem to="/calendar" icon={CalendarDays} label={t('nav.calendar')} />}
          {user && <NavItem to="/content-reviews" icon={ShieldCheck} label={t('reviewCycle.overviewTitle')} count={data?.dueReviews} />}
          {user && <NavItem to="/read-confirmations" icon={FileSignature} label={t('reads.pageTitle')} count={data?.openReads} />}
          {user && <NavItem to="/changes" icon={History} label={t('changes.title')} />}
          {canAnalyse && <NavItem to="/analytics" icon={BarChart3} label={t('analytics.nav')} />}
          {user && (
            <span data-tour="reviews">
              <NavItem to="/reviews" icon={ClipboardCheck} label={t('review.inbox')} count={data?.openReviews} />
            </span>
          )}
          {user && <NavItem to="/drafts" icon={FileClock} label={t('nav.drafts')} />}
          {user && <NavItem to="/notifications" icon={Bell} label={t('app.notifications')} count={data?.unreadNotifications} />}
        </div>
        {personal && (
          <div className="sidebar-section">
            <div className="sidebar-heading">{t('app.personalSpace')}</div>
            <NavItem to={`/s/${encodeURIComponent(personal.key)}`} emoji={personal.icon ?? '👤'} label={personal.name} />
          </div>
        )}
        {spaceGroups.map((group) => (
          <div className="sidebar-section" key={group.key}>
            <div className="sidebar-heading">{group.title}</div>
            {group.items.map((s) => (
              <NavItem key={s.key} to={`/s/${encodeURIComponent(s.key)}`} emoji={s.icon ?? '📘'} label={s.name} />
            ))}
          </div>
        ))}
        {team.length > shown.length && (
          <div className="sidebar-section">
            <NavItem to="/spaces" icon={FolderOpen} label={`${t('common.all')} (${team.length})`} />
          </div>
        )}
      </div>
      <div className="sidebar-footer tiny faint">
        <BookOpen size={13} />
        <span className="truncate">Knowstead {data?.version}</span>
      </div>
    </>
  );
}

function SpaceNav({ spaceKey }: { spaceKey: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: space } = useSpace(spaceKey);
  const location = useLocation();
  const pageMatch = location.pathname.match(/^\/s\/[^/]+\/(?:p|edit|history|diff)\/(\d+)/);
  const currentPageId = pageMatch ? Number(pageMatch[1]) : undefined;
  const base = `/s/${encodeURIComponent(spaceKey)}`;
  return (
    <>
      <div className="sidebar-scroll">
        <div className="space-header">
          {/* Die Farbe des Bereichs färbt Kachel, Ring und Lichthof (shell.css) */}
          <span className="space-icon" style={space?.color ? ({ '--space-color': space.color } as CSSProperties) : undefined}>
            {space?.icon ?? '📘'}
          </span>
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="space-title truncate">{space?.name ?? spaceKey}</div>
            <div className="space-sub row gap-xs">
              <span className="mono space-key">{space?.key ?? spaceKey}</span>
              {space?.archivedAt && <Badge color="yellow">{t('spaces.archived')}</Badge>}
            </div>
          </div>
        </div>
        <div className="sidebar-section">
          <NavItem to={base} end icon={Home} label={t('nav.overview')} />
          <NavItem to={`${base}/tasks`} icon={KanbanSquare} label={t('tasks.title')} />
          <NavItem to={`${base}/changelog`} icon={ScrollText} label={t('nav.changelog')} />
          {space?.can.create && <NavItem to={`${base}/trash`} icon={Trash2} label={t('nav.trash')} />}
          {space?.can.admin && <NavItem to={`${base}/settings`} icon={Settings} label={t('nav.spaceSettings')} />}
        </div>
        <div className="sidebar-section">
          <div className="sidebar-heading">
            <span>{t('nav.pages')}</span>
            {space?.can.create && <IconButton icon={Plus} label={t('spaces.newPageHere')} onClick={() => navigate(`${base}/new`)} />}
          </div>
          <PageTree spaceKey={spaceKey} currentPageId={currentPageId} canEdit={!!space?.can.create} />
        </div>
      </div>
      <div className="sidebar-footer">
        <NavLink to="/spaces" className="nav-link grow" data-spot="">
          <FolderOpen size={15} />
          <span>{t('dashboard.allSpaces')}</span>
        </NavLink>
      </div>
    </>
  );
}

function AdminNav() {
  const { t } = useI18n();
  const { isAdmin, can } = useAuth();
  const sections: { title: string; items: { to: string; label: string; icon: typeof Home; show: boolean; end?: boolean }[] }[] = [
    {
      title: '',
      items: [
        { to: '/admin', label: t('admin.nav.overview'), icon: BarChart3, show: isAdmin, end: true },
        { to: '/admin/setup', label: t('admin.nav.setup'), icon: ListChecks, show: isAdmin },
      ],
    },
    {
      title: t('admin.sections.people'),
      items: [
        { to: '/admin/users', label: t('admin.nav.users'), icon: Users, show: can('users.manage') },
        { to: '/admin/groups', label: t('admin.nav.groups'), icon: UsersRound, show: can('users.manage') },
        { to: '/admin/permissions', label: t('admin.nav.permissions'), icon: KeyRound, show: can('users.manage') },
        { to: '/admin/directory', label: t('admin.nav.directory'), icon: Network, show: isAdmin },
        { to: '/admin/sso', label: t('admin.nav.sso'), icon: ShieldCheck, show: isAdmin },
      ],
    },
    {
      title: t('admin.sections.content'),
      items: [
        { to: '/admin/spaces', label: t('admin.nav.spaces'), icon: FolderOpen, show: isAdmin },
        { to: '/admin/templates', label: t('admin.nav.templates'), icon: LayoutTemplate, show: can('templates.manage') },
        { to: '/admin/export', label: t('admin.nav.exportTemplate'), icon: FileOutput, show: isAdmin },
      ],
    },
    {
      title: t('admin.sections.integrations'),
      items: [
        { to: '/admin/webhooks', label: t('admin.nav.webhooks'), icon: Webhook, show: can('integrations.manage') },
        { to: '/admin/connectors', label: t('admin.nav.connectors'), icon: Plug, show: can('integrations.manage') },
        { to: '/admin/plugins', label: t('admin.nav.plugins'), icon: Puzzle, show: isAdmin },
        { to: '/admin/ai', label: t('admin.nav.ai'), icon: BrainCircuit, show: isAdmin },
      ],
    },
    {
      title: t('admin.sections.system'),
      items: [
        { to: '/admin/settings', label: t('admin.nav.settings'), icon: Settings, show: isAdmin },
        { to: '/admin/mail', label: t('admin.nav.mail'), icon: Mail, show: isAdmin },
        { to: '/admin/audit', label: t('admin.nav.audit'), icon: Shield, show: can('audit.view') },
        { to: '/admin/backups', label: t('admin.nav.backups'), icon: Database, show: isAdmin },
        { to: '/admin/maintenance', label: t('admin.nav.maintenance'), icon: Wrench, show: isAdmin },
        { to: '/admin/about', label: t('admin.nav.about'), icon: Info, show: true },
      ],
    },
  ];
  return (
    <div className="sidebar-scroll">
      <div className="space-header">
        <span className="space-icon">
          <Shield size={18} />
        </span>
        <div className="space-title">{t('admin.title')}</div>
      </div>
      {sections.map((s, i) => {
        const items = s.items.filter((x) => x.show);
        if (!items.length) return null;
        return (
          <div key={i} className="sidebar-section">
            {s.title && <div className="sidebar-heading">{s.title}</div>}
            {items.map((item) => (
              <NavItem key={item.to} to={item.to} end={item.end} icon={item.icon} label={item.label} />
            ))}
          </div>
        );
      })}
      <div className="sidebar-section">
        <NavItem to="/" icon={Home} label={t('nav.home')} />
        <NavItem to="/s/HANDBUCH" icon={BookOpen} label="Handbuch" />
        <NavItem to="/activity" icon={Archive} label={t('nav.activity')} />
        <NavItem to="/spaces" icon={FileText} label={t('nav.spaces')} />
      </div>
    </div>
  );
}

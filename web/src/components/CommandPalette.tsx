import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  CalendarDays,
  FilePlus2,
  FileText,
  FolderOpen,
  Home,
  type LucideIcon,
  Moon,
  Search,
  Settings,
  Shield,
  Sun,
  User,
} from 'lucide-react';
import { api } from '../api/client';
import type { PageSummary, Space } from '../api/types';
import { useAuth } from '../lib/auth';
import { useI18n } from '../i18n';
import { applyTheme, currentTheme } from '../lib/theme';
import { cx } from './ui';

interface Item {
  id: string;
  group: 'pages' | 'spaces' | 'commands';
  label: string;
  sub?: string;
  icon?: LucideIcon;
  emoji?: string | null;
  run: () => void;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setIndex(0);
    }
  }, [open]);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(q.trim()), 120);
    return () => window.clearTimeout(id);
  }, [q]);

  const results = useQuery({
    queryKey: ['palette', debounced],
    queryFn: () => api.get<{ pages: PageSummary[]; spaces: Space[] }>('/api/v1/search/quick', { q: debounced, limit: 8 }),
    enabled: open && debounced.length > 0,
    staleTime: 10_000,
  });
  const recent = useQuery({
    queryKey: ['palette-recent'],
    queryFn: () => api.get<PageSummary[]>('/api/v1/me/recent', { limit: 6 }),
    enabled: open && !!user && debounced.length === 0,
    staleTime: 10_000,
  });

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const items = useMemo<Item[]>(() => {
    const commands: Item[] = [
      { id: 'c-home', group: 'commands', label: t('nav.home'), icon: Home, run: () => go('/') },
      { id: 'c-spaces', group: 'commands', label: t('nav.spaces'), icon: FolderOpen, run: () => go('/spaces') },
      { id: 'c-activity', group: 'commands', label: t('nav.activity'), icon: Activity, run: () => go('/activity') },
      ...(user
        ? [
            { id: 'c-drafts', group: 'commands' as const, label: t('nav.drafts'), icon: FileText, run: () => go('/drafts') },
            { id: 'c-journal', group: 'commands' as const, label: t('app.today'), icon: CalendarDays, run: () => go('/journal') },
            { id: 'c-profile', group: 'commands' as const, label: t('app.profile'), icon: User, run: () => go('/profile') },
          ]
        : []),
      ...(isAdmin ? [{ id: 'c-admin', group: 'commands' as const, label: t('app.admin'), icon: Shield, run: () => go('/admin') }] : []),
      {
        id: 'c-theme',
        group: 'commands',
        label: `${t('app.theme')}: ${currentTheme() === 'dark' ? t('app.themeLight') : t('app.themeDark')}`,
        icon: currentTheme() === 'dark' ? Sun : Moon,
        run: () => {
          applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
          onClose();
        },
      },
      { id: 'c-api', group: 'commands', label: t('app.apiDocs'), icon: Settings, run: () => { onClose(); window.open('/api/docs', '_blank'); } },
    ];
    const lower = debounced.toLowerCase();
    const filteredCommands = lower ? commands.filter((c) => c.label.toLowerCase().includes(lower)) : commands.slice(0, 5);
    const pages: Item[] = (debounced ? results.data?.pages ?? [] : recent.data ?? []).map((p) => ({
      id: `p-${p.id}`,
      group: 'pages',
      label: p.title,
      sub: [p.spaceName, ...(p.path ?? [])].join(' › '),
      emoji: p.icon,
      icon: FileText,
      run: () => go(p.url),
    }));
    const spaces: Item[] = (results.data?.spaces ?? []).map((s) => ({
      id: `s-${s.key}`,
      group: 'spaces',
      label: s.name,
      sub: s.key,
      emoji: s.icon,
      icon: FolderOpen,
      run: () => go(`/s/${encodeURIComponent(s.key)}`),
    }));
    const list = [...pages, ...spaces, ...filteredCommands];
    if (debounced) {
      list.push({ id: 'full', group: 'commands', label: t('palette.fullSearch', { q: debounced }), icon: Search, run: () => go(`/search?q=${encodeURIComponent(debounced)}`) });
    }
    if (user && lower && 'neue seite new page'.includes(lower)) {
      list.push({ id: 'c-new', group: 'commands', label: t('app.newPage'), icon: FilePlus2, run: () => go('/spaces') });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, results.data, recent.data, user, isAdmin, t]);

  useEffect(() => setIndex(0), [debounced]);

  useEffect(() => {
    listRef.current?.querySelector('.palette-item.selected')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setIndex((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[index]?.run();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const groupLabel = { pages: debounced ? t('palette.pages') : t('dashboard.recent'), spaces: t('palette.spaces'), commands: t('palette.commands') };
  let lastGroup = '';

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label={t('a11y.commandPalette')} onKeyDown={onKeyDown}>
        <div className="palette-input">
          <Search size={18} className="muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('palette.placeholder')} aria-label={t('palette.placeholder')} />
        </div>
        <div className="palette-results" ref={listRef}>
          {items.map((item, i) => {
            const header = item.group !== lastGroup && item.id !== 'full' ? <div className="palette-group">{groupLabel[item.group]}</div> : null;
            lastGroup = item.group;
            const Icon = item.icon;
            return (
              <div key={item.id}>
                {header}
                <button type="button" className={cx('palette-item', i === index && 'selected')} onMouseEnter={() => setIndex(i)} onClick={item.run}>
                  <span className="palette-item-icon">{item.emoji ? item.emoji : Icon ? <Icon size={16} /> : null}</span>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <div className="truncate">{item.label}</div>
                    {item.sub && <div className="palette-item-sub truncate">{item.sub}</div>}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-footer">{t('palette.hint')}</div>
      </div>
    </div>,
    document.body,
  );
}

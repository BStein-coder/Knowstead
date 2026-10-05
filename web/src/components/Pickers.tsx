import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Search, Users, X } from 'lucide-react';
import { api } from '../api/client';
import type { Group, PageSummary, Space, Subject, UserRef } from '../api/types';
import { useI18n } from '../i18n';
import { EMOJI_CHOICES, COLOR_CHOICES } from '../lib/utils';
import { Avatar, Input, Popover, cx } from './ui';

function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/* ------------------------------ Emoji ------------------------------ */

export function EmojiPicker({ value, onChange, allowClear = true, trigger }: { value: string | null; onChange: (v: string | null) => void; allowClear?: boolean; trigger?: (open: () => void, ref: (el: HTMLElement | null) => void) => ReactNode }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState('');
  const { t } = useI18n();
  return (
    <>
      {trigger ? (
        trigger(() => setOpen(true), setAnchor)
      ) : (
        <button ref={setAnchor} type="button" className="btn btn-icon-only" onClick={() => setOpen(true)} style={{ fontSize: 18 }}>
          {value || '📄'}
        </button>
      )}
      <Popover anchor={anchor} open={open} onClose={() => setOpen(false)}>
        <div className="emoji-grid">
          {EMOJI_CHOICES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                onChange(e);
                setOpen(false);
              }}
            >
              {e}
            </button>
          ))}
        </div>
        <div className="row" style={{ padding: '0 0.5rem 0.5rem' }}>
          <Input
            className="input-sm"
            value={custom}
            placeholder={t('emojiPicker.custom')}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && custom.trim()) {
                onChange([...custom.trim()].slice(0, 2).join(''));
                setOpen(false);
              }
            }}
          />
          {allowClear && value && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              {t('page.removeIcon')}
            </button>
          )}
        </div>
      </Popover>
    </>
  );
}

export function ColorPicker({ value, onChange }: { value: string | null; onChange: (v: string) => void }) {
  return (
    <div className="color-swatches">
      {COLOR_CHOICES.map((c) => (
        <button key={c} type="button" className={cx('color-swatch', value === c && 'active')} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
    </div>
  );
}

/* ------------------------------ Seitenauswahl ------------------------------ */

export function usePageSearch(q: string, spaceKey?: string) {
  const debounced = useDebounced(q.trim());
  return useQuery({
    queryKey: ['page-search', debounced, spaceKey ?? null],
    queryFn: async () => {
      if (!debounced) return [] as PageSummary[];
      if (spaceKey) {
        const res = await api.get<{ items: { id: number; title: string; icon: string | null; spaceKey: string; spaceName: string; url: string; path: string[] }[] }>(
          '/api/v1/search',
          { q: `${debounced} in:title`, space: spaceKey, limit: 15 },
        );
        return res.items.map((i) => ({ ...i, excerpt: '', spaceId: 0, parentId: null, contentType: 'richtext', status: 'current', version: 0, updatedAt: '', createdAt: '', updatedBy: null })) as PageSummary[];
      }
      const res = await api.get<{ pages: PageSummary[] }>('/api/v1/search/quick', { q: debounced, limit: 12 });
      return res.pages;
    },
    staleTime: 10_000,
  });
}

export function PagePicker({ value, onChange, spaceKey, placeholder, excludeId }: { value: { id: number; title: string } | null; onChange: (p: PageSummary | null) => void; spaceKey?: string; placeholder?: string; excludeId?: number }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { data } = usePageSearch(q, spaceKey);
  const { t } = useI18n();
  const items = (data ?? []).filter((p) => p.id !== excludeId);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {value && !open ? (
        <div className="subject-row">
          <FileText size={16} className="muted" />
          <span className="grow truncate">{value.title}</span>
          <button type="button" className="icon-btn" onClick={() => onChange(null)} aria-label={t('common.remove')}>
            <X size={14} />
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            {t('common.edit')}
          </button>
        </div>
      ) : (
        <Input icon={Search} value={q} autoFocus={open} placeholder={placeholder ?? t('editor.linkUrl')} onChange={(e) => setQ(e.target.value)} onFocus={() => setOpen(true)} />
      )}
      <Popover anchor={ref.current} open={open && items.length > 0} onClose={() => setOpen(false)} matchWidth>
        <div className="picker-list">
          {items.map((p) => (
            <button
              key={p.id}
              type="button"
              className="picker-item"
              onClick={() => {
                onChange(p);
                setOpen(false);
                setQ('');
              }}
            >
              <span>{p.icon ?? <FileText size={15} />}</span>
              <span className="grow">
                <div className="truncate">{p.title}</div>
                <div className="picker-sub truncate">
                  {p.spaceName}
                  {p.path?.length ? ` · ${p.path.join(' › ')}` : ''}
                </div>
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/* ------------------------------ Personen & Gruppen ------------------------------ */

export function useUserSearch(q: string) {
  const debounced = useDebounced(q.trim(), 150);
  return useQuery({
    queryKey: ['user-search', debounced],
    queryFn: () => api.get<UserRef[]>('/api/v1/users/search', { q: debounced, limit: 10 }),
    enabled: debounced.length > 0,
    staleTime: 30_000,
  });
}

interface SubjectPickerProps {
  onPick: (subject: Subject & { label: string; detail?: string; user?: UserRef }) => void;
  exclude?: Subject[];
  groups?: boolean;
  placeholder?: string;
}

/** Suchfeld für Benutzer und (optional) Gruppen. */
export function SubjectPicker({ onPick, exclude = [], groups = true, placeholder }: SubjectPickerProps) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const users = useUserSearch(q);
  const groupList = useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/api/v1/groups'), enabled: groups, staleTime: 60_000 });
  const { t } = useI18n();
  const excluded = new Set(exclude.map((s) => `${s.type}:${s.id}`));
  const lower = q.trim().toLowerCase();
  const matchedGroups = useMemo(
    () => (groups && lower ? (groupList.data ?? []).filter((g) => g.name.toLowerCase().includes(lower)) : []).filter((g) => !excluded.has(`group:${g.id}`)).slice(0, 6),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [groups, lower, groupList.data, exclude],
  );
  const matchedUsers = (users.data ?? []).filter((u) => !excluded.has(`user:${u.id}`));
  const show = open && lower.length > 0 && (matchedGroups.length > 0 || matchedUsers.length > 0);
  return (
    <div ref={ref}>
      <Input icon={Search} value={q} placeholder={placeholder ?? t('restrictions.addSubject')} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      <Popover anchor={ref.current} open={show} onClose={() => setOpen(false)} matchWidth>
        <div className="picker-list">
          {matchedUsers.map((u) => (
            <button key={`u${u.id}`} type="button" className="picker-item" onClick={() => { onPick({ type: 'user', id: u.id, label: u.displayName, detail: `@${u.username}`, user: u }); setQ(''); setOpen(false); }}>
              <Avatar user={u} size={24} />
              <span className="grow">
                <div>{u.displayName}</div>
                <div className="picker-sub">@{u.username}</div>
              </span>
            </button>
          ))}
          {matchedGroups.map((g) => (
            <button key={`g${g.id}`} type="button" className="picker-item" onClick={() => { onPick({ type: 'group', id: g.id, label: g.name, detail: t('common.group') }); setQ(''); setOpen(false); }}>
              <span className="group-icon" style={{ width: 24, height: 24 }}>
                <Users size={13} />
              </span>
              <span className="grow">
                <div>{g.name}</div>
                <div className="picker-sub">
                  {t('common.group')} · {g.memberCount}
                </div>
              </span>
            </button>
          ))}
        </div>
      </Popover>
    </div>
  );
}

/* ------------------------------ Bereichsauswahl ------------------------------ */

export function SpaceSelect({ value, onChange, onlyCreatable, includePersonal = true }: { value: string; onChange: (key: string) => void; onlyCreatable?: boolean; includePersonal?: boolean }) {
  const { data } = useQuery({ queryKey: ['spaces', { all: true }], queryFn: () => api.get<Space[]>('/api/v1/spaces'), staleTime: 30_000 });
  const spaces = (data ?? []).filter((s) => (onlyCreatable ? s.can.create : true)).filter((s) => includePersonal || s.kind === 'team');
  useEffect(() => {
    if (!value && spaces.length) onChange(spaces[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, spaces.length]);
  return (
    <select className="input select" value={value} onChange={(e) => onChange(e.target.value)}>
      {spaces.map((s) => (
        <option key={s.key} value={s.key}>
          {s.icon ?? '📘'} {s.name} ({s.key})
        </option>
      ))}
    </select>
  );
}

/* ------------------------------ Stichwort-Eingabe ------------------------------ */

export function TagInput({ value, onChange, placeholder, suggestions = [] }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const listId = useMemo(() => `tags-${Math.random().toString(36).slice(2)}`, []);
  const add = (raw: string) => {
    const tags = raw
      .split(/[,\s]+/)
      .map((s) => s.trim().toLowerCase().replace(/^#/, ''))
      .filter(Boolean);
    if (!tags.length) return;
    onChange([...new Set([...value, ...tags])]);
    setText('');
  };
  return (
    <div className="tag-input" onClick={(e) => (e.currentTarget.querySelector('input') as HTMLInputElement | null)?.focus()}>
      {value.map((tag) => (
        <span key={tag} className="chip">
          {tag}
          <button type="button" onClick={() => onChange(value.filter((v) => v !== tag))} aria-label={`${tag} entfernen`}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        value={text}
        list={listId}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
            if (text.trim()) {
              e.preventDefault();
              add(text);
            }
          } else if (e.key === 'Backspace' && !text && value.length) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => text.trim() && add(text)}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </div>
  );
}

import { useEffect, useMemo, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ChevronsDownUp, Copy, Crosshair, FileCode2, FileText, FileType2, Link2, Lock, MoreHorizontal, Plus, Search, Trash2, X } from 'lucide-react';
import { api } from '../api/client';
import type { TreeNode } from '../api/types';
import { useTree } from '../api/hooks';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';
import { useDialogs } from '../lib/dialogs';
import { pageUrl } from '../lib/utils';
import { IconButton, Input, Loading, Menu, cx } from '../components/ui';

type DropPos = 'before' | 'after' | 'inside';

interface Props {
  spaceKey: string;
  currentPageId?: number;
  canEdit: boolean;
}

const TYPE_ICON = { richtext: FileText, markdown: FileType2, code: FileCode2 };

function storageKey(spaceKey: string) {
  return `knowstead.tree.${spaceKey}`;
}

export function PageTree({ spaceKey, currentPageId, canEdit }: Props) {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: nodes, isLoading } = useTree(spaceKey);
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(storageKey(spaceKey)) ?? '[]') as number[]);
    } catch {
      return new Set();
    }
  });
  const [filter, setFilter] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const [focusId, setFocusId] = useState<number | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: number; pos: DropPos } | null>(null);

  const { byParent, byId } = useMemo(() => {
    const byId = new Map<number, TreeNode>();
    for (const n of nodes ?? []) byId.set(n.id, n);
    const byParent = new Map<number | null, TreeNode[]>();
    for (const n of nodes ?? []) {
      const parent = n.parentId !== null && byId.has(n.parentId) ? n.parentId : null;
      const list = byParent.get(parent) ?? [];
      list.push(n);
      byParent.set(parent, list);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.position - b.position || a.id - b.id);
    return { byParent, byId };
  }, [nodes]);

  const parentOf = (id: number): number | null => {
    const p = byId.get(id)?.parentId ?? null;
    return p !== null && byId.has(p) ? p : null;
  };

  // Vorfahren der aktuellen Seite aufklappen
  useEffect(() => {
    if (!currentPageId || !byId.size) return;
    const chain: number[] = [];
    let p = parentOf(currentPageId);
    while (p !== null) {
      chain.push(p);
      p = parentOf(p);
    }
    if (chain.some((id) => !expanded.has(id))) {
      setExpanded((prev) => new Set([...prev, ...chain]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId, byId]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(spaceKey), JSON.stringify([...expanded].slice(-500)));
    } catch {
      /* ignorieren */
    }
  }, [expanded, spaceKey]);

  // Filter: Treffer + deren Vorfahren
  const visibleByFilter = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<number>();
    for (const n of nodes ?? []) {
      if (n.title.toLowerCase().includes(q)) {
        let cur: number | null = n.id;
        while (cur !== null && !set.has(cur)) {
          set.add(cur);
          cur = parentOf(cur);
        }
      }
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, nodes]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const isDescendant = (id: number, ancestor: number): boolean => {
    let p = parentOf(id);
    while (p !== null) {
      if (p === ancestor) return true;
      p = parentOf(p);
    }
    return false;
  };

  const onDragOver = (e: DragEvent, node: TreeNode) => {
    if (dragId === null || dragId === node.id || isDescendant(node.id, dragId)) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pos: DropPos = y < rect.height * 0.28 ? 'before' : y > rect.height * 0.72 ? 'after' : 'inside';
    if (over?.id !== node.id || over.pos !== pos) setOver({ id: node.id, pos });
  };

  const onDrop = async (e: DragEvent, node: TreeNode) => {
    e.preventDefault();
    const target = over;
    const moving = dragId;
    setOver(null);
    setDragId(null);
    if (!target || moving === null || moving === node.id) return;
    let parentId: number | null;
    let index: number;
    if (target.pos === 'inside') {
      parentId = node.id;
      index = (byParent.get(node.id) ?? []).filter((n) => n.id !== moving).length;
      setExpanded((prev) => new Set([...prev, node.id]));
    } else {
      parentId = parentOf(node.id);
      const siblings = (byParent.get(parentId) ?? []).filter((n) => n.id !== moving);
      index = siblings.findIndex((n) => n.id === node.id) + (target.pos === 'after' ? 1 : 0);
    }
    try {
      await api.post(`/api/v1/pages/${moving}/move`, { parentId, index });
      await qc.invalidateQueries({ queryKey: ['tree', spaceKey] });
      void qc.invalidateQueries({ queryKey: ['page', moving] });
    } catch (err) {
      toast.error(err);
    }
  };

  const trash = async (node: TreeNode) => {
    const ok = await dialogs.confirm({ title: t('page.delete'), message: t('page.deleteConfirm', { title: node.title }), danger: true, confirmLabel: t('page.delete') });
    if (!ok) return;
    try {
      await api.del(`/api/v1/pages/${node.id}`);
      toast.success(t('page.deleted'));
      await qc.invalidateQueries({ queryKey: ['tree', spaceKey] });
      if (node.id === currentPageId) navigate(`/s/${encodeURIComponent(spaceKey)}`);
    } catch (err) {
      toast.error(err);
    }
  };

  const highlight = (title: string) => {
    const q = filter.trim();
    if (!q) return title;
    const i = title.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return title;
    return (
      <>
        {title.slice(0, i)}
        <mark className="tree-mark">{title.slice(i, i + q.length)}</mark>
        {title.slice(i + q.length)}
      </>
    );
  };

  const renderNodes = (parentId: number | null, depth: number) => {
    const list = (byParent.get(parentId) ?? []).filter((n) => !visibleByFilter || visibleByFilter.has(n.id));
    if (!list.length) return null;
    return (
      <ul className="tree" role={depth === 0 ? 'tree' : 'group'}>
        {list.map((node) => {
          const children = byParent.get(node.id) ?? [];
          const hasChildren = children.length > 0;
          const open = !!visibleByFilter || expanded.has(node.id);
          const Icon = TYPE_ICON[node.contentType] ?? FileText;
          return (
            <li key={node.id} role="treeitem" aria-expanded={hasChildren ? open : undefined}>
              <div
                className={cx(
                  'tree-row',
                  node.id === currentPageId && 'active',
                  dragId === node.id && 'dragging',
                  over?.id === node.id && `drop-${over.pos}`,
                )}
                draggable={canEdit && !visibleByFilter}
                onDragStart={(e) => {
                  setDragId(node.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(node.id));
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setOver(null);
                }}
                onDragOver={(e) => onDragOver(e, node)}
                onDragLeave={() => over?.id === node.id && setOver(null)}
                onDrop={(e) => void onDrop(e, node)}
              >
                <button
                  type="button"
                  className={cx('tree-toggle', open && 'open')}
                  style={{ visibility: hasChildren ? 'visible' : 'hidden' }}
                  onClick={() => toggle(node.id)}
                  tabIndex={-1}
                  aria-label={open ? t('a11y.collapse') : t('a11y.expand')}
                >
                  <ChevronRight size={14} />
                </button>
                <Link to={pageUrl(spaceKey, node.id, node.title)} className="tree-link" draggable={false}>
                  <span className="tree-icon">{node.icon ? node.icon : <Icon size={14} />}</span>
                  <span className="tree-title">{highlight(node.title)}</span>
                  {node.restricted && <Lock size={12} className="tree-lock" aria-label={t('page.restricted')} />}
                </Link>
                <span className="tree-actions">
                  {canEdit && (
                    <IconButton
                      icon={Plus}
                      label={t('page.createChild')}
                      onClick={() => navigate(`/s/${encodeURIComponent(spaceKey)}/new?parent=${node.id}`)}
                    />
                  )}
                  <Menu
                    placement="bottom-start"
                    trigger={(p) => <IconButton {...p} ref={p.ref as never} icon={MoreHorizontal} label={t('common.more')} />}
                    items={[
                      { label: t('page.createChild'), icon: Plus, hidden: !canEdit, onClick: () => navigate(`/s/${encodeURIComponent(spaceKey)}/new?parent=${node.id}`) },
                      { label: t('spaces.focus'), icon: Crosshair, hidden: !hasChildren, onClick: () => setFocusId(node.id) },
                      {
                        label: t('page.share'),
                        icon: Link2,
                        onClick: async () => {
                          await navigator.clipboard.writeText(window.location.origin + pageUrl(spaceKey, node.id, node.title));
                          toast.success(t('page.linkCopied'));
                        },
                      },
                      { label: t('page.copy'), icon: Copy, hidden: !canEdit, onClick: () => navigate(`${pageUrl(spaceKey, node.id, node.title)}?dialog=copy`) },
                      { separator: true, hidden: !canEdit },
                      { label: t('page.delete'), icon: Trash2, danger: true, hidden: !canEdit, onClick: () => void trash(node) },
                    ]}
                  />
                </span>
              </div>
              {hasChildren && open && renderNodes(node.id, depth + 1)}
            </li>
          );
        })}
      </ul>
    );
  };

  if (isLoading) return <Loading inline />;
  if (!nodes?.length) return <div className="small faint" style={{ padding: '0.25rem 0.6rem' }}>{t('spaces.treeEmpty')}</div>;

  const focused = focusId !== null ? byId.get(focusId) : undefined;

  return (
    <div>
      <div className="row gap-xs" style={{ padding: '0 0.25rem 0.3rem' }}>
        {showFilter ? (
          <div className="tree-filter grow" style={{ margin: 0 }}>
            <Input
              autoFocus
              icon={Search}
              value={filter}
              placeholder={t('spaces.treeFilter')}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setFilter('');
                  setShowFilter(false);
                }
              }}
            />
          </div>
        ) : (
          <span className="grow" />
        )}
        <IconButton
          icon={showFilter ? X : Search}
          label={t('spaces.treeFilter')}
          onClick={() => {
            setShowFilter((s) => !s);
            setFilter('');
          }}
        />
        <IconButton icon={ChevronsDownUp} label={t('spaces.collapseAll')} onClick={() => setExpanded(new Set())} />
      </div>
      {focused && (
        <div className="row small" style={{ padding: '0.2rem 0.6rem 0.4rem' }}>
          <Crosshair size={13} className="muted" />
          <span className="grow truncate strong">{focused.title}</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setFocusId(null)}>
            {t('spaces.unfocus')}
          </button>
        </div>
      )}
      {focused ? renderNodes(focused.id, 1) : renderNodes(null, 0)}
    </div>
  );
}

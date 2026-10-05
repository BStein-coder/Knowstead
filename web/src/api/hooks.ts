import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type {
  SpaceCategory,
  Activity,
  Attachment,
  Catalog,
  Comment,
  Group,
  Notification,
  Page,
  PageSummary,
  Paged,
  PresenceUser,
  Revision,
  Space,
  Template,
  TreeNode,
} from './types';

export function useSpaces(filter: { q?: string; archived?: boolean; kind?: 'team' | 'personal' } = {}, enabled = true) {
  return useQuery({
    queryKey: ['spaces', filter],
    queryFn: () => api.get<Space[]>('/api/v1/spaces', filter),
    enabled,
    staleTime: 30_000,
  });
}

export function useSpaceCategories() {
  return useQuery({
    queryKey: ['space-categories'],
    queryFn: () => api.get<SpaceCategory[]>('/api/v1/space-categories'),
    staleTime: 60_000,
  });
}

/** Team-Bereiche in Kategorien gruppieren – in der gepflegten Reihenfolge, ohne Kategorie zuletzt. */
export function groupByCategory<T extends { category: string }>(items: T[], categories: SpaceCategory[], otherTitle: string) {
  const known = new Map(categories.map((c) => [c.name.toLowerCase(), c]));
  const groups = categories.map((c) => ({ key: `c${c.id}`, title: c.name, icon: c.icon, items: items.filter((s) => s.category.toLowerCase() === c.name.toLowerCase()) }));
  const rest = items.filter((s) => !s.category || !known.has(s.category.toLowerCase()));
  const all = [...groups, { key: 'other', title: groups.some((g) => g.items.length) ? otherTitle : '', icon: null as string | null, items: rest }];
  return all.filter((g) => g.items.length);
}

export function useSpace(key: string | undefined) {
  return useQuery({
    queryKey: ['space', key],
    queryFn: () => api.get<Space>(`/api/v1/spaces/${encodeURIComponent(key!)}`),
    enabled: !!key,
    staleTime: 30_000,
  });
}

export function useTree(key: string | undefined) {
  return useQuery({
    queryKey: ['tree', key],
    queryFn: () => api.get<TreeNode[]>(`/api/v1/spaces/${encodeURIComponent(key!)}/tree`),
    enabled: !!key,
    staleTime: 15_000,
  });
}

export function usePage(id: number | undefined, options: { render?: boolean; view?: boolean; deleted?: boolean } = {}) {
  return useQuery({
    queryKey: ['page', id, options.render ? 'render' : 'raw'],
    queryFn: () => api.get<Page>(`/api/v1/pages/${id}`, { render: options.render, view: options.view, deleted: options.deleted }),
    enabled: !!id && Number.isFinite(id),
    staleTime: 5_000,
    retry: (count, err) => (err as { status?: number }).status !== 404 && (err as { status?: number }).status !== 403 && count < 2,
  });
}

export function useChildren(id: number | undefined, sort?: string, depth = 1, enabled = true) {
  return useQuery({
    queryKey: ['children', id, sort, depth],
    queryFn: () => api.get<PageSummary[]>(`/api/v1/pages/${id}/children`, { sort, depth }),
    enabled: !!id && enabled,
    staleTime: 15_000,
  });
}

export function useRevisions(id: number | undefined, limit = 100) {
  return useQuery({
    queryKey: ['revisions', id, limit],
    queryFn: () => api.get<Paged<Revision>>(`/api/v1/pages/${id}/revisions`, { limit }),
    enabled: !!id,
  });
}

export function useComments(id: number | undefined) {
  return useQuery({
    queryKey: ['comments', id],
    queryFn: () => api.get<Comment[]>(`/api/v1/pages/${id}/comments`),
    enabled: !!id,
  });
}

export function useAttachments(id: number | undefined, includeDeleted = false) {
  return useQuery({
    queryKey: ['attachments', id, includeDeleted],
    queryFn: () => api.get<Attachment[]>(`/api/v1/pages/${id}/attachments`, { deleted: includeDeleted }),
    enabled: !!id,
  });
}

export function useTemplates(spaceKey?: string, scope?: 'all' | 'global' | 'space') {
  return useQuery({
    queryKey: ['templates', spaceKey ?? null, scope ?? 'all'],
    queryFn: () => api.get<Template[]>('/api/v1/templates', { space: spaceKey, scope }),
    staleTime: 60_000,
  });
}

export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: () => api.get<Catalog>('/api/v1/catalog'), staleTime: Infinity });
}

export function useGroups(enabled = true) {
  return useQuery({ queryKey: ['groups'], queryFn: () => api.get<Group[]>('/api/v1/groups'), enabled, staleTime: 60_000 });
}

export function useNotifications(unreadOnly = false) {
  return useQuery({
    queryKey: ['notifications', unreadOnly],
    queryFn: () => api.get<{ items: Notification[]; unread: number }>('/api/v1/me/notifications', { unread: unreadOnly, limit: 50 }),
  });
}

export function useActivity(params: { space?: string; user?: string } = {}) {
  return useInfiniteQuery({
    queryKey: ['activity', params],
    queryFn: ({ pageParam }) => api.get<{ items: Activity[]; nextBefore: number | null }>('/api/v1/activity', { ...params, before: pageParam ?? undefined, limit: 30 }),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
  });
}

export function usePresence(pageId: number | undefined) {
  return useQuery<PresenceUser[]>({
    queryKey: ['presence', pageId],
    queryFn: () => [],
    enabled: false,
    initialData: [],
  });
}

/** Häufig benötigte Invalidierungen nach Seitenänderungen. */
export function useInvalidatePage() {
  const qc = useQueryClient();
  return (page: { id: number; space?: { key: string }; spaceKey?: string }) => {
    const key = page.space?.key ?? page.spaceKey;
    void qc.invalidateQueries({ queryKey: ['page', page.id] });
    void qc.invalidateQueries({ queryKey: ['children'] });
    void qc.invalidateQueries({ queryKey: ['revisions', page.id] });
    if (key) void qc.invalidateQueries({ queryKey: ['tree', key] });
  };
}

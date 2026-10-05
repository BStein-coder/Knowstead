import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { FilePlus2, FileText, FolderInput, History, MessageSquare, Paperclip, RotateCcw, Tag, Trash2, type LucideIcon } from 'lucide-react';
import type { Activity } from '../api/types';
import { useI18n } from '../i18n';
import { Avatar, Time, cx } from './ui';

const ICONS: Record<string, { icon: LucideIcon; kind: string }> = {
  'page.created': { icon: FilePlus2, kind: 'create' },
  'page.updated': { icon: FileText, kind: 'edit' },
  'page.moved': { icon: FolderInput, kind: 'move' },
  'page.copied': { icon: FilePlus2, kind: 'create' },
  'page.deleted': { icon: Trash2, kind: 'delete' },
  'page.purged': { icon: Trash2, kind: 'delete' },
  'page.restored': { icon: RotateCcw, kind: 'restore' },
  'page.version_restored': { icon: History, kind: 'restore' },
  'page.labels_changed': { icon: Tag, kind: 'edit' },
  'comment.created': { icon: MessageSquare, kind: 'edit' },
  'attachment.uploaded': { icon: Paperclip, kind: 'create' },
  'attachment.deleted': { icon: Trash2, kind: 'delete' },
};

export function activityIcon(type: string) {
  return ICONS[type] ?? { icon: FileText, kind: '' };
}

/** Gruppiert Einträge nach Tag und rendert je Tag eine Zeitleiste. */
export function DayGroups<T extends { createdAt: string }>({ items, render }: { items: T[]; render: (item: T) => ReactNode }) {
  const { fmt } = useI18n();
  const groups: [string, T[]][] = [];
  for (const item of items) {
    const day = fmt.date(item.createdAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === day) last[1].push(item);
    else groups.push([day, [item]]);
  }
  return (
    <>
      {groups.map(([day, list]) => (
        <div key={day}>
          <div className="timeline-day">{day}</div>
          <div className="timeline">{list.map(render)}</div>
        </div>
      ))}
    </>
  );
}

function ActivityItem({ a, compact }: { a: Activity; compact?: boolean }) {
  const { icon: Icon, kind } = activityIcon(a.type);
  const note = (a.data.changeNote as string | undefined) || (a.data.excerpt as string | undefined);
  return (
    <div className="timeline-item" style={compact ? { padding: '0.55rem 0.25rem', borderBottom: 'none' } : undefined}>
      <span className={cx('timeline-icon', kind)}>
        <Icon size={15} />
      </span>
      <div className="timeline-body">
        <div className="timeline-title">
          <span className="soft">{a.label}:</span>{' '}
          {a.page ? a.page.deleted ? <span className="muted">{a.page.title}</span> : <Link to={a.page.url} className="strong">{a.page.title}</Link> : a.target?.label && <strong>{a.target.label}</strong>}
        </div>
        <div className="timeline-meta">
          <Avatar user={a.actor} size={16} />
          <span>{a.actor?.displayName ?? a.actorName ?? 'System'}</span>
          <Time value={a.createdAt} />
          {a.space && (
            <Link to={`/s/${encodeURIComponent(a.space.key)}`} className="muted">
              {a.space.icon} {a.space.name}
            </Link>
          )}
          {typeof a.data.version === 'number' && <span>v{a.data.version as number}</span>}
        </div>
        {note && !compact && <div className="timeline-note">{note}</div>}
      </div>
    </div>
  );
}

/** Aktivitätsliste für Startseite, Bereiche, Profile und den Aktivitätsfeed. */
export function ActivityList({ items, compact }: { items: Activity[]; compact?: boolean }) {
  if (compact) {
    return (
      <div>
        {items.map((a) => (
          <ActivityItem key={a.id} a={a} compact />
        ))}
      </div>
    );
  }
  return <DayGroups items={items} render={(a) => <ActivityItem key={a.id} a={a} />} />;
}

import { useState } from 'react';
import { Link } from 'react-router';
import { Archive, ClipboardCheck, Eye, FolderOpen, FolderPlus, Search, User } from 'lucide-react';
import { groupByCategory, useSpaceCategories, useSpaces } from '../../api/hooks';
import { useAuth } from '../../lib/auth';
import { useI18n } from '../../i18n';
import { Badge, Button, Checkbox, EmptyState, Input, Loading, PageHeader, Time } from '../../components/ui';
import { CreateSpaceDialog } from '../../components/CreateSpaceDialog';

export function SpacesPage() {
  const { t } = useI18n();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const { data, isLoading } = useSpaces({ archived });
  const lower = q.trim().toLowerCase();
  const spaces = (data ?? []).filter((s) => !lower || `${s.name} ${s.key} ${s.description}`.toLowerCase().includes(lower));
  const team = spaces.filter((s) => s.kind === 'team');
  const personal = spaces.filter((s) => s.kind === 'personal');
  const { data: categories = [] } = useSpaceCategories();
  // Nach Kategorie gruppieren (gepflegte Reihenfolge); Bereiche ohne Kategorie kommen zuletzt.
  const groups = groupByCategory(team, categories, t('spaces.otherCategory'));

  return (
    <div className="container">
      <PageHeader
        icon={FolderOpen}
        title={t('spaces.title')}
        subtitle={t('spaces.subtitle')}
        actions={
          can('spaces.create') && (
            <Button variant="primary" icon={FolderPlus} onClick={() => setCreating(true)}>
              {t('spaces.create')}
            </Button>
          )
        }
      />
      <div className="row mb-2" style={{ flexWrap: 'wrap' }}>
        <div style={{ width: 340, maxWidth: '100%' }}>
          <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('spaces.filterPlaceholder')} />
        </div>
        <Checkbox checked={archived} onChange={setArchived} label={t('spaces.showArchived')} />
      </div>
      {isLoading && <Loading />}
      {!isLoading && team.length === 0 && personal.length === 0 && <EmptyState icon={FolderOpen} title={t('spaces.empty')} />}
      {groups.map((group) => (
        <section key={group.key}>
          {group.title && (
            <h3 className="space-group-title">
              {group.icon && <span className="space-group-icon">{group.icon}</span>}
              {group.title}
            </h3>
          )}
          <div className="space-grid stagger">
            {group.items.map((s) => (
              <Link
                key={s.key}
                to={`/s/${encodeURIComponent(s.key)}`}
                className="space-card"
                data-tilt="4"
                style={{ ['--space-color' as string]: s.color ?? undefined }}
              >
                <div className="space-card-head">
                  <span className="space-icon" style={{ background: s.color ? `${s.color}22` : undefined }}>
                    {s.icon ?? '📘'}
                  </span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="space-card-name truncate">{s.name}</div>
                    <div className="space-card-key">{s.key}</div>
                  </div>
                  {s.reviewRequired && (
                    <Badge color="blue" title={t('review.required')}>
                      <ClipboardCheck size={11} />
                    </Badge>
                  )}
                  {s.archivedAt && (
                    <Badge color="yellow">
                      <Archive size={11} /> {t('spaces.archived')}
                    </Badge>
                  )}
                  {s.isWatching && <Eye size={15} className="muted" />}
                </div>
                <div className="space-card-desc">{s.description || ' '}</div>
                <div className="space-card-meta">
                  <span>{t('spaces.pagesCount', { n: s.pageCount ?? 0 })}</span>
                  {s.lastActivityAt && (
                    <span>
                      <Time value={s.lastActivityAt} />
                    </span>
                  )}
                  <span className="spacer" />
                  {s.role && (
                    <Badge color={s.role === 'admin' ? 'purple' : s.role === 'editor' ? 'blue' : 'gray'}>{t(`roles.${s.role}`)}</Badge>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </section>
      ))}
      {personal.length > 0 && (
        <>
          <h3 className="mt-3 mb-1 row">
            <User size={17} /> {t('spaces.personal')}
          </h3>
          <div className="space-grid stagger">
            {personal.map((s) => (
              <Link key={s.key} to={`/s/${encodeURIComponent(s.key)}`} className="space-card" data-tilt="4">
                <div className="space-card-head">
                  <span className="space-icon">{s.icon ?? '👤'}</span>
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="space-card-name truncate">{s.name}</div>
                    <div className="space-card-key">{s.key}</div>
                  </div>
                </div>
                <div className="space-card-meta">
                  <span>{t('spaces.pagesCount', { n: s.pageCount ?? 0 })}</span>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
      <CreateSpaceDialog open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

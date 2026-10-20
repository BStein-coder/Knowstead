import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, FolderKanban, Plus, Search } from 'lucide-react';
import { api } from '../../api/client';
import { useSpaces } from '../../api/hooks';
import type { Project } from '../../api/types';
import { localeTag, useI18n } from '../../i18n';
import { useCountUp } from '../../lib/motion';
import { Avatar, Button, EmptyState, ErrorView, Input, Loading, Modal, PageHeader, cx } from '../../components/ui';
import { ymd } from './TaskCalendar';

type Status = 'planning' | 'active' | 'done';
type Filter = 'all' | Status;

/** Ein Projekt ist „in Planung“, solange nichts begonnen ist, „abgeschlossen“, wenn alles erledigt ist – dazwischen „in Arbeit“. */
export function projectStatus(project: Pick<Project, 'counts' | 'summary'>): Status {
  const { total, done } = project.counts;
  if (total === 0) return 'planning';
  if (done === total) return 'done';
  return done > 0 || project.summary.doing > 0 ? 'active' : 'planning';
}

const percent = (project: Pick<Project, 'counts'>) => (project.counts.total ? Math.round((project.counts.done / project.counts.total) * 100) : 0);
const dayDiff = (date: string) => Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${ymd(new Date())}T00:00:00`).getTime()) / 86400000);

/** „Projekte“: alle Pläne der sichtbaren Bereiche als Karten – mit Fortschrittsring, nächstem Termin und Beteiligten. */
export default function ProjectsPage() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [choosing, setChoosing] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<{ items: Project[] }>('/api/v1/projects'),
  });

  const items = useMemo(() => {
    const list = (data?.items ?? []).map((project) => ({ project, status: projectStatus(project) }));
    const order: Record<Status, number> = { active: 0, planning: 1, done: 2 };
    // In Arbeit zuerst, innerhalb davon der nächste Termin vorn; Abgeschlossene zuletzt
    return list.sort((a, b) => order[a.status] - order[b.status] || (a.project.summary.nextTask?.dueDate ?? '9999').localeCompare(b.project.summary.nextTask?.dueDate ?? '9999') || a.project.name.localeCompare(b.project.name));
  }, [data]);

  const counts = useMemo(
    () => ({ all: items.length, active: items.filter((x) => x.status === 'active').length, planning: items.filter((x) => x.status === 'planning').length, done: items.filter((x) => x.status === 'done').length }),
    [items],
  );
  const monthEnd = ymd(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0));
  const monthStart = ymd(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const running = items.filter((x) => x.status !== 'done');
  const onTrack = running.length ? Math.round((running.filter((x) => x.project.counts.overdue === 0).length / running.length) * 100) : 100;
  const dueThisMonth = running.filter((x) => x.project.summary.dueDate && x.project.summary.dueDate >= monthStart && x.project.summary.dueDate <= monthEnd).length;

  const needle = query.trim().toLowerCase();
  const shown = items.filter(
    (x) => (filter === 'all' || x.status === filter) && (!needle || `${x.project.name} ${x.project.spaceName} ${x.project.description}`.toLowerCase().includes(needle)),
  );

  if (isLoading) return <Loading />;
  if (error) return <ErrorView error={error} />;

  return (
    <div className="container container-wide projects-page">
      <PageHeader
        icon={FolderKanban}
        title={t('planner.projects.title')}
        subtitle={t('planner.projects.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setChoosing(true)}>
            {t('planner.projects.newProject')}
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState icon={FolderKanban} title={t('planner.projects.empty')} text={t('planner.projects.emptyHint')} />
      ) : (
        <>
          <div className="plan-stats stagger">
            <Stat label={t('planner.projects.statActive')} value={counts.active} />
            <Stat label={t('planner.projects.statDone')} value={counts.done} />
            <Stat label={t('planner.projects.statOnTrack')} value={onTrack} suffix=" %" />
            <Stat label={t('planner.projects.statDueMonth')} value={dueThisMonth} />
          </div>

          <div className="projects-bar">
            <div className="cal-modes" role="group" aria-label={t('planner.projects.title')}>
              {(['all', 'active', 'planning', 'done'] as const).map((value) => (
                <button key={value} type="button" className={cx('cal-mode', filter === value && 'active')} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {t(`planner.projects.filter${value === 'all' ? 'All' : value === 'active' ? 'Active' : value === 'planning' ? 'Planning' : 'Done'}`)}
                  <span className="cal-mode-count">{counts[value]}</span>
                </button>
              ))}
            </div>
            <label className="projects-search">
              <Search size={15} aria-hidden="true" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('planner.projects.search')} aria-label={t('planner.projects.searchLabel')} />
            </label>
          </div>

          {shown.length === 0 ? (
            <p className="muted">{t('planner.projects.noMatch')}</p>
          ) : (
            <div className="project-grid">
              {shown.map(({ project, status }, index) => (
                <ProjectCard key={project.id} project={project} status={status} index={index} locale={locale} />
              ))}
            </div>
          )}
        </>
      )}

      {choosing && (
        <ChooseSpaceForPlan
          onClose={() => setChoosing(false)}
          onChoose={(key) => {
            setChoosing(false);
            navigate(`/s/${encodeURIComponent(key)}/tasks?new=1`);
          }}
        />
      )}
    </div>
  );
}

function Stat({ label, value, suffix = '' }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="plan-stat">
      <span className="plan-stat-label">{label}</span>
      <CountedValue value={value} suffix={suffix} />
    </div>
  );
}

function CountedValue({ value, suffix }: { value: number; suffix: string }) {
  const shown = useCountUp(value, 700) ?? value;
  return (
    <span className="plan-stat-value">
      {shown}
      {suffix}
    </span>
  );
}

/** Fortschrittsring: der Bogen zeichnet sich beim Erscheinen von null bis zum Wert. */
function Ring({ value, done }: { value: number; done: boolean }) {
  const radius = 21;
  const circumference = 2 * Math.PI * radius;
  const shown = useCountUp(value, 900) ?? value;
  return (
    <span className={cx('ring', done && 'is-done')} role="img" aria-label={`${value} %`}>
      <svg viewBox="0 0 52 52" aria-hidden="true">
        <circle className="ring-track" cx="26" cy="26" r={radius} />
        <circle className="ring-arc" cx="26" cy="26" r={radius} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - value / 100)} transform="rotate(-90 26 26)" />
      </svg>
      <span className="ring-text" aria-hidden="true">
        {shown}%
      </span>
    </span>
  );
}

function ProjectCard({ project, status, index, locale }: { project: Project; status: Status; index: number; locale: 'de' | 'en' }) {
  const { t } = useI18n();
  const tag = localeTag(locale);
  const value = percent(project);
  const next = project.summary.nextTask;
  const when = (date: string) => {
    const diff = dayDiff(date);
    if (diff < 0) return diff === -1 ? t('planner.projects.overdueOneDay') : t('planner.projects.overdueDays', { n: -diff });
    if (diff === 0) return t('planner.projects.todayDue');
    return diff === 1 ? t('planner.projects.inOneDay') : t('planner.projects.inDays', { n: diff });
  };
  const fmt = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(tag, { day: 'numeric', month: 'short' });
  const late = project.counts.overdue > 0;

  return (
    <Link
      to={`/s/${encodeURIComponent(project.spaceKey)}/tasks?board=${project.id}`}
      className={cx('project-card', `status-${status}`, late && status !== 'done' && 'late')}
      style={{ ['--i' as string]: Math.min(index, 10), ['--space-color' as string]: project.spaceColor ?? undefined }}
      aria-label={`${project.name} – ${t('planner.projects.open')}`}
      data-spot=""
    >
      <div className="project-head">
        <span className="project-icon" aria-hidden="true">
          {project.spaceIcon ?? '📘'}
        </span>
        <div className="project-title">
          <span className="project-name">{project.name}</span>
          <span className="project-meta">
            <span className={cx('project-status', `status-${status}`)}>
              <i aria-hidden="true" />
              {t(`planner.projects.status${status === 'planning' ? 'Planning' : status === 'active' ? 'Active' : 'Done'}`)}
            </span>
            <span className="project-space">{project.spaceName}</span>
          </span>
        </div>
      </div>

      <p className="project-desc">{project.description || ' '}</p>

      <div className="project-next">
        <Ring value={value} done={status === 'done'} />
        <div className="project-next-body">
          <span className="project-next-label">{status === 'done' ? t('planner.projects.allDone') : t('planner.projects.nextDate')}</span>
          {status === 'done' ? (
            <span className="project-next-title">{t('planner.projects.progress', { n: 100 })}</span>
          ) : next ? (
            <>
              <span className="project-next-title" title={next.title}>
                {next.title}
              </span>
              <span className={cx('project-next-date', dayDiff(next.dueDate) < 0 && 'danger')}>
                {fmt(next.dueDate)} · {when(next.dueDate)}
              </span>
            </>
          ) : (
            <span className="project-next-title muted">{project.counts.total ? t('planner.projects.noDate') : t('planner.projects.noTasks')}</span>
          )}
        </div>
      </div>

      <div className="project-foot">
        <span className="avatar-stack">
          {project.summary.assignees.map((user) => (
            <Avatar key={user.id} user={user} size={26} title={user.displayName} />
          ))}
          {project.summary.assigneeCount > project.summary.assignees.length && (
            <span className="avatar avatar-more" style={{ width: 26, height: 26 }} title={t('planner.projects.people', { n: project.summary.assigneeCount })}>
              +{project.summary.assigneeCount - project.summary.assignees.length}
            </span>
          )}
        </span>
        <span className="project-count">{t('planner.projects.tasks', { done: project.counts.done, total: project.counts.total })}</span>
        {project.summary.dueDate && (
          <span className="project-end">
            <CalendarDays size={13} aria-hidden="true" /> {fmt(project.summary.dueDate)}
          </span>
        )}
      </div>
    </Link>
  );
}

/** Auswahl des Bereichs für einen neuen Plan – dort öffnet sich der Dialog „Neuer Plan“. */
function ChooseSpaceForPlan({ onClose, onChoose }: { onClose: () => void; onChoose: (key: string) => void }) {
  const { t } = useI18n();
  const { data, isLoading } = useSpaces({}, true);
  const spaces = (data ?? []).filter((s) => s.can.create && !s.archivedAt);
  return (
    <Modal open onClose={onClose} title={t('planner.projects.newProject')} size="sm">
      <p className="muted mb-2">{t('planner.projects.chooseSpace')}</p>
      {isLoading && <Loading />}
      {!isLoading && spaces.length === 0 && <EmptyState compact title={t('planner.projects.noSpace')} />}
      <div className="list">
        {spaces.map((s) => (
          <button key={s.key} type="button" className="list-item" onClick={() => onChoose(s.key)}>
            <span className="space-icon" style={{ width: 30, height: 30, fontSize: 16 }}>
              {s.icon ?? '📘'}
            </span>
            <span className="list-item-body">
              <div className="list-item-title">{s.name}</div>
              <div className="list-item-meta">{s.kind === 'personal' ? t('spaces.personal') : s.key}</div>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

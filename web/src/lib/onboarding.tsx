import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { BookOpen, Check, FolderPlus, PenLine, Search, Sparkles, UserCog, Wand2, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { useAuth } from './auth';
import { Button, IconButton, cx } from '../components/ui';

export interface OnboardingState {
  /** Erledigte Aufgaben der Einstiegsliste. */
  done?: string[];
  /** Liste ausgeblendet. */
  dismissed?: boolean;
  /** Rundgang abgeschlossen oder übersprungen. */
  tourDone?: boolean;
}

const TASK_IDS = ['profile', 'space', 'page', 'editor', 'search', 'handbook'] as const;
export type TaskId = (typeof TASK_IDS)[number];

const ICONS: Record<TaskId, typeof Check> = {
  profile: UserCog,
  space: FolderPlus,
  page: PenLine,
  editor: Wand2,
  search: Search,
  handbook: BookOpen,
};

/** Lesen und Fortschreiben des Onboarding-Zustands (in den Benutzereinstellungen). */
export function useOnboarding() {
  const { user, updatePreferences } = useAuth();
  const stored = user?.preferences?.onboarding as OnboardingState | undefined;
  const state = useMemo(() => stored ?? {}, [stored]);
  const done = useMemo(() => new Set(state.done ?? []), [state.done]);

  const patch = useCallback(
    (next: OnboardingState) => void updatePreferences({ onboarding: { ...state, ...next } }),
    [state, updatePreferences],
  );

  const complete = useCallback(
    (task: TaskId) => {
      if (done.has(task)) return;
      patch({ done: [...done, task] });
    },
    [done, patch],
  );

  return {
    state,
    done,
    complete,
    dismiss: () => patch({ dismissed: true }),
    finishTour: () => patch({ tourDone: true }),
    resetTour: () => patch({ tourDone: false, dismissed: false }),
    allDone: TASK_IDS.every((id) => done.has(id)),
    tasks: TASK_IDS,
  };
}

/** Einstiegsliste auf der Startseite. */
export function OnboardingChecklist() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { state, done, complete, dismiss, allDone, tasks } = useOnboarding();

  if (!user || state.dismissed || allDone) return null;

  const targets: Record<TaskId, string> = {
    profile: '/profile',
    space: '/spaces',
    page: '/spaces',
    editor: '/spaces',
    search: '/search',
    handbook: '/s/HANDBUCH',
  };
  const progress = Math.round((done.size / tasks.length) * 100);

  return (
    <section className="onboarding-card" aria-label={t('onboarding.checklist')}>
      <div className="row gap-sm">
        <Sparkles size={18} className="accent" />
        <div className="grow">
          <h3 style={{ margin: 0 }}>{t('onboarding.checklist')}</h3>
          <p className="small muted" style={{ margin: '0.15rem 0 0' }}>
            {t('onboarding.checklistHint')}
          </p>
        </div>
        <IconButton icon={X} label={t('onboarding.hide')} onClick={dismiss} />
      </div>
      <div className="onboarding-progress" style={{ marginTop: '0.75rem' }} role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={t('onboarding.checklist')}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <ul className="onboarding-tasks">
        {tasks.map((id) => {
          const Icon = ICONS[id];
          const isDone = done.has(id);
          return (
            <li key={id} className={cx('onboarding-task', isDone && 'done')}>
              <span className="check">
                <Check size={14} />
              </span>
              <button
                type="button"
                className="task-label text-left"
                onClick={() => {
                  complete(id);
                  navigate(targets[id]);
                }}
              >
                <span className="row gap-xs">
                  <Icon size={14} className="muted" />
                  <strong>{t(`onboarding.tasks.${id}`)}</strong>
                </span>
                <span className="small muted">{t(`onboarding.tasks.${id}Hint`)}</span>
              </button>
              {!isDone && (
                <Button size="sm" variant="ghost" onClick={() => complete(id)}>
                  {t('common.done')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

interface TourStep {
  selector: string;
  text: string;
  /** Ausweichposition, wenn das Element fehlt. */
  fallback?: 'center';
}

/**
 * Geführter Rundgang: hebt nacheinander Bereiche der Oberfläche hervor.
 * Startet einmalig nach der ersten Anmeldung und über „Rundgang erneut ansehen“.
 */
export function OnboardingTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const steps = useMemo<TourStep[]>(
    () => [
      { selector: '.sidebar', text: t('onboarding.tour.sidebar') },
      { selector: '[data-tour="create"]', text: t('onboarding.tour.create') },
      { selector: '.topbar-search', text: t('onboarding.tour.search') },
      { selector: '[data-tour="reviews"]', text: t('onboarding.tour.review') },
      { selector: '[data-tour="user"]', text: t('onboarding.tour.profile') },
    ],
    [t],
  );

  useEffect(() => {
    if (!open) return;
    const step = steps[index];
    const el = step ? document.querySelector(step.selector) : null;
    setRect(el ? el.getBoundingClientRect() : null);
    const onResize = () => {
      const current = step ? document.querySelector(step.selector) : null;
      setRect(current ? current.getBoundingClientRect() : null);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
    };
  }, [open, index, steps]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' || e.key === 'Enter') setIndex((i) => Math.min(i + 1, steps.length - 1));
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, steps.length]);

  if (!open) return null;
  const step = steps[index];
  const last = index === steps.length - 1;

  // Sprechblase unter bzw. neben dem hervorgehobenen Element platzieren.
  const pop: React.CSSProperties = rect
    ? {
        top: Math.min(rect.bottom + 12, window.innerHeight - 200),
        left: Math.min(Math.max(rect.left, 16), window.innerWidth - 380),
      }
    : { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };

  return (
    <>
      <div className="tour-backdrop" onClick={onClose} />
      {rect && (
        <div
          className="tour-spot"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }}
        />
      )}
      <div className="tour-pop" style={pop} role="dialog" aria-modal="true">
        <div className="row gap-sm" style={{ marginBottom: '0.5rem' }}>
          <Sparkles size={16} className="accent" />
          <strong>{t('onboarding.step', { n: index + 1, total: steps.length })}</strong>
          <span className="spacer" />
          <IconButton icon={X} label={t('onboarding.skip')} onClick={onClose} />
        </div>
        <p style={{ margin: '0 0 0.9rem' }}>{step.text}</p>
        <div className="row gap-sm">
          <div className="tour-steps">
            {steps.map((_, i) => (
              <span key={i} className={cx(i === index && 'active')} />
            ))}
          </div>
          <span className="spacer" />
          {index > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setIndex(index - 1)}>
              {t('common.back')}
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => (last ? onClose() : setIndex(index + 1))}>
            {last ? t('onboarding.finish') : t('common.next')}
          </Button>
        </div>
      </div>
    </>
  );
}

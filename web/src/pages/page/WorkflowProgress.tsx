import { Check, Clock3, UserRoundCheck, X } from 'lucide-react';
import type { Review } from '../../api/types';
import { useI18n } from '../../i18n';
import { Time, cx } from '../../components/ui';

/** Stufen eines mehrstufigen Freigabeablaufs mit Entscheidungen (im Prüfband der Seite). */
export function WorkflowProgress({ review }: { review: Review }) {
  const { t } = useI18n();
  const workflow = review.workflow;
  if (!workflow) return null;
  return (
    <ol className="workflow-progress" aria-label={t('workflow.progress')}>
      {workflow.stages.map((stage, index) => {
        const approvals = stage.decisions.filter((d) => d.decision === 'approved').length;
        const icon = stage.state === 'done' ? <Check size={13} /> : stage.state === 'rejected' ? <X size={13} /> : stage.state === 'current' ? <Clock3 size={13} /> : <span>{index + 1}</span>;
        return (
          <li key={index} className={cx('workflow-step', `is-${stage.state}`)} aria-current={stage.state === 'current' ? 'step' : undefined}>
            <span className="workflow-step-icon">{icon}</span>
            <div className="workflow-step-body">
              <strong>{stage.name}</strong>
              <div className="small muted">
                {stage.approvers.map((a) => a.label).join(', ')}
                {stage.minApprovals > 1 && ` · ${t('workflow.approvalsOf', { n: approvals, min: stage.minApprovals })}`}
              </div>
              {stage.decisions.map((d, i) => (
                <div key={i} className="small">
                  {d.decision === 'approved' ? <Check size={12} className="success-text" /> : <X size={12} className="danger-text" />} {d.user?.displayName}
                  {d.onBehalfOf && (
                    <span className="muted">
                      {' '}
                      <UserRoundCheck size={12} /> {t('workflow.onBehalfOf', { name: d.onBehalfOf.displayName })}
                    </span>
                  )}
                  {' · '}
                  <Time value={d.createdAt} />
                  {d.note && <span className="muted"> · {d.note}</span>}
                </div>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Plus, Trash2, Users, X } from 'lucide-react';
import { api } from '../../api/client';
import type { ApprovalWorkflow, ApprovalStage, Space } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Button, Card, Field, IconButton, Input, Loading, Switch } from '../../components/ui';
import { SubjectPicker } from '../../components/Pickers';

type EditableStage = ApprovalStage & { key: string };

let seq = 0;
const newKey = () => `s${++seq}`;

/** Bereichseinstellungen → Freigaben: mehrstufiger Ablauf wie „Fachbereich → QM → Veröffentlichung“. */
export function ApprovalWorkflowCard({ space }: { space: Space }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['approval-workflow', space.key], queryFn: () => api.get<ApprovalWorkflow>(`/api/v1/spaces/${encodeURIComponent(space.key)}/approval-workflow`) });
  const [enabled, setEnabled] = useState(false);
  const [distinct, setDistinct] = useState(true);
  const [stages, setStages] = useState<EditableStage[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setDistinct(data.distinctApprovers);
    setStages(data.stages.map((st) => ({ ...st, key: newKey() })));
  }, [data]);

  if (isLoading || !data) return <Loading />;

  const update = (key: string, patch: Partial<ApprovalStage>) => setStages(stages.map((st) => (st.key === key ? { ...st, ...patch } : st)));
  const move = (index: number, delta: number) => {
    const next = [...stages];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setStages(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/v1/spaces/${encodeURIComponent(space.key)}/approval-workflow`, {
        enabled,
        distinctApprovers: distinct,
        stages: stages.map((st) => ({ name: st.name, approvers: st.approvers.map((a) => ({ type: a.type, id: a.id })), minApprovals: st.minApprovals, escalateDays: st.escalateDays })),
      });
      toast.success(t('common.changesSaved'));
      void qc.invalidateQueries({ queryKey: ['approval-workflow', space.key] });
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card title={t('workflow.title')}>
      <p className="small muted" style={{ marginTop: 0 }}>
        {t('workflow.intro')}
      </p>
      <div className="col gap-sm mb-2">
        <Switch checked={enabled} onChange={setEnabled} label={t('workflow.enable')} description={t('workflow.enableHelp')} disabled={!data.canEdit} />
        <Switch checked={distinct} onChange={setDistinct} label={t('workflow.distinct')} description={t('workflow.distinctHelp')} disabled={!data.canEdit} />
      </div>

      <ol className="workflow-stages">
        {stages.map((stage, index) => (
          <li key={stage.key} className="workflow-stage">
            <div className="workflow-stage-head">
              <span className="workflow-stage-number" aria-hidden="true">
                {index + 1}
              </span>
              <Input value={stage.name} onChange={(e) => update(stage.key, { name: e.target.value })} placeholder={t('workflow.stageName')} aria-label={t('workflow.stageName')} maxLength={60} />
              <IconButton icon={ArrowUp} label={t('workflow.moveUp')} disabled={index === 0} onClick={() => move(index, -1)} />
              <IconButton icon={ArrowDown} label={t('workflow.moveDown')} disabled={index === stages.length - 1} onClick={() => move(index, 1)} />
              <IconButton icon={Trash2} label={t('common.remove')} onClick={() => setStages(stages.filter((s) => s.key !== stage.key))} />
            </div>
            <Field label={t('workflow.approvers')}>
              <div className="chip-list mb-1">
                {stage.approvers.map((a) => (
                  <span key={`${a.type}:${a.id}`} className="chip">
                    {a.type === 'group' && <Users size={12} />} {a.label}
                    <IconButton icon={X} label={t('common.remove')} onClick={() => update(stage.key, { approvers: stage.approvers.filter((x) => x !== a) })} />
                  </span>
                ))}
              </div>
              <SubjectPicker exclude={stage.approvers} onPick={(s) => update(stage.key, { approvers: [...stage.approvers, { type: s.type as 'group' | 'user', id: s.id, label: s.label }] })} placeholder={t('workflow.addApprover')} />
            </Field>
            <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
              <Field label={t('workflow.minApprovals')}>
                <Input type="number" min={1} max={10} value={stage.minApprovals} onChange={(e) => update(stage.key, { minApprovals: Math.max(1, Math.min(10, Number(e.target.value) || 1)) })} style={{ width: 110 }} />
              </Field>
              <Field label={t('workflow.escalateDays')} help={t('workflow.escalateHelp')}>
                <Input type="number" min={0} max={60} value={stage.escalateDays} onChange={(e) => update(stage.key, { escalateDays: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} style={{ width: 110 }} />
              </Field>
            </div>
          </li>
        ))}
      </ol>
      <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
        <Button
          size="sm"
          icon={Plus}
          disabled={stages.length >= 6}
          onClick={() => setStages([...stages, { key: newKey(), name: stages.length ? '' : t('workflow.defaultStage'), approvers: [], minApprovals: 1, escalateDays: 0 }])}
        >
          {t('workflow.addStage')}
        </Button>
        <span className="spacer" />
        {data.canEdit && (
          <Button variant="primary" loading={saving} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        )}
      </div>
      <p className="small muted mt-2">{t('workflow.deputyHint')}</p>
    </Card>
  );
}

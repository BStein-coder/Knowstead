import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarRange, Trash2, UserRoundCheck } from 'lucide-react';
import { api } from '../../api/client';
import type { DeputyEntry, UserRef } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { Avatar, Badge, Button, Card, EmptyState, Field, IconButton, Input, Loading } from '../../components/ui';
import { AssigneePicker } from '../tasks/TaskComponents';

function localDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Profil → Vertretung: Abwesenheiten mit Vertretung für Freigaben. */
export function DeputiesTab() {
  const { t, fmt } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['deputies'], queryFn: () => api.get<{ absences: DeputyEntry[]; actingFor: DeputyEntry[] }>('/api/v1/me/deputies') });
  const [deputy, setDeputy] = useState<UserRef | null>(null);
  const [startsOn, setStartsOn] = useState(localDay());
  const [endsOn, setEndsOn] = useState(localDay(7));
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const add = async () => {
    if (!deputy) return;
    setSaving(true);
    try {
      await api.post('/api/v1/me/deputies', { deputyId: deputy.id, startsOn, endsOn, note });
      toast.success(t('deputies.saved'));
      setDeputy(null);
      setNote('');
      void qc.invalidateQueries({ queryKey: ['deputies'] });
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    try {
      await api.del(`/api/v1/me/deputies/${id}`);
      void qc.invalidateQueries({ queryKey: ['deputies'] });
    } catch (err) {
      toast.error(err);
    }
  };

  const range = (e: DeputyEntry) => `${fmt.date(e.startsOn)} – ${fmt.date(e.endsOn)}`;

  return (
    <div className="col gap-lg">
      <Card title={t('deputies.title')}>
        <p className="small muted" style={{ marginTop: 0 }}>
          {t('deputies.intro')}
        </p>
        <div className="task-form-grid">
          <Field label={t('deputies.deputy')}>
            <AssigneePicker value={deputy} onChange={setDeputy} />
          </Field>
          <Field label={t('deputies.note')}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={t('deputies.notePlaceholder')} />
          </Field>
          <Field label={t('deputies.from')}>
            <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} />
          </Field>
          <Field label={t('deputies.until')}>
            <Input type="date" value={endsOn} min={startsOn} onChange={(e) => setEndsOn(e.target.value)} />
          </Field>
        </div>
        <Button variant="primary" icon={CalendarRange} loading={saving} disabled={!deputy || !startsOn || !endsOn} onClick={() => void add()}>
          {t('deputies.add')}
        </Button>
      </Card>

      {isLoading ? (
        <Loading />
      ) : (
        <>
          <Card title={t('deputies.mine')}>
            {!data?.absences.length ? (
              <EmptyState compact icon={CalendarRange} title={t('deputies.noneMine')} />
            ) : (
              <ul className="deputy-list">
                {data.absences.map((e) => (
                  <li key={e.id}>
                    {e.deputy && <Avatar user={e.deputy} size={24} />}
                    <span className="grow">
                      <strong>{e.deputy?.displayName}</strong> · {range(e)}
                      {e.note && <span className="muted"> · {e.note}</span>}
                    </span>
                    {e.active && <Badge color="green">{t('deputies.active')}</Badge>}
                    <IconButton icon={Trash2} label={t('common.remove')} onClick={() => void remove(e.id)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title={t('deputies.actingFor')}>
            {!data?.actingFor.length ? (
              <EmptyState compact icon={UserRoundCheck} title={t('deputies.noneActing')} />
            ) : (
              <ul className="deputy-list">
                {data.actingFor.map((e) => (
                  <li key={e.id}>
                    {e.user && <Avatar user={e.user} size={24} />}
                    <span className="grow">
                      <strong>{e.user?.displayName}</strong> · {range(e)}
                    </span>
                    {e.active && <Badge color="green">{t('deputies.active')}</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

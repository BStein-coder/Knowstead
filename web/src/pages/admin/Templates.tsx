import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import type { Template } from '../../api/types';
import { useTemplates } from '../../api/hooks';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Badge, Button, Loading, PageHeader, Time } from '../../components/ui';
import { TemplateEditorDialog } from '../../components/TemplateEditorDialog';

export function AdminTemplates() {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const qc = useQueryClient();
  const { data, isLoading } = useTemplates(undefined, 'global');
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  return (
    <>
      <PageHeader
        icon={LayoutTemplate}
        title={t('templates.title')}
        subtitle={t('templates.subtitle')}
        actions={
          <Button variant="primary" icon={Plus} onClick={() => setEditing('new')}>
            {t('templates.create')}
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('common.name')}</th>
                <th>{t('templates.category')}</th>
                <th>{t('adminTemplates.changed')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(data ?? []).map((tpl) => (
                <tr key={tpl.id}>
                  <td>
                    <div className="strong">
                      {tpl.icon} {tpl.name} {tpl.builtin && <Badge>{t('templates.builtin')}</Badge>}
                    </div>
                    <div className="small muted">{tpl.description}</div>
                  </td>
                  <td>{tpl.category}</td>
                  <td className="small muted">
                    <Time value={tpl.updatedAt} />
                  </td>
                  <td className="actions-cell">
                    {tpl.canEdit && (
                      <>
                        <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(tpl)}>
                          {t('common.edit')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Trash2}
                          aria-label={t('common.delete')}
                          onClick={async () => {
                            if (!(await dialogs.confirm({ title: t('templates.deleteConfirm', { name: tpl.name }), danger: true, confirmLabel: t('common.delete') }))) return;
                            try {
                              await api.del(`/api/v1/templates/${tpl.id}`);
                              void qc.invalidateQueries({ queryKey: ['templates'] });
                            } catch (err) {
                              toast.error(err);
                            }
                          }}
                        />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <TemplateEditorDialog template={editing === 'new' ? null : editing} spaceKey={null} onClose={() => setEditing(null)} />}
    </>
  );
}

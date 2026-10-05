import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { SpaceCategory } from '../api/types';
import { useSpaceCategories } from '../api/hooks';
import { useAuth } from '../lib/auth';
import { useDialogs } from '../lib/dialogs';
import { useToast } from '../lib/toast';
import { useI18n } from '../i18n';
import { Select } from './ui';

const NEW = '__new__';

/** Auswahl der Bereichskategorie; Administratoren können direkt eine neue anlegen. */
export function CategorySelect({ value, onChange, disabled, id, 'aria-label': ariaLabel }: { value: string; onChange: (name: string) => void; disabled?: boolean; id?: string; 'aria-label'?: string }) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const dialogs = useDialogs();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: categories = [] } = useSpaceCategories();
  const match = categories.find((c) => c.name.toLowerCase() === value.toLowerCase());
  const known = !!match;

  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      value={match?.name ?? value}
      disabled={disabled}
      onChange={async (e) => {
        if (e.target.value !== NEW) {
          onChange(e.target.value);
          return;
        }
        const name = await dialogs.prompt({ title: t('spaces.newCategory'), label: t('common.name'), placeholder: t('spaces.categoryPlaceholder') });
        if (!name?.trim()) return;
        try {
          const created = await api.post<SpaceCategory>('/api/v1/admin/space-categories', { name: name.trim() });
          await qc.invalidateQueries({ queryKey: ['space-categories'] });
          onChange(created.name);
        } catch (err) {
          toast.error(err);
        }
      }}
    >
      <option value="">{t('spaces.noCategory')}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.name}>
          {c.icon ? `${c.icon} ` : ''}
          {c.name}
        </option>
      ))}
      {value && !known && <option value={value}>{value}</option>}
      {isAdmin && <option value={NEW}>＋ {t('spaces.newCategory')}</option>}
    </Select>
  );
}

import { useEffect, useState } from 'react';
import { CategorySelect } from './CategorySelect';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { FolderPlus } from 'lucide-react';
import { api } from '../api/client';
import type { Space } from '../api/types';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';
import { Button, Field, Input, Modal, Textarea } from './ui';
import { ColorPicker, EmojiPicker } from './Pickers';

function suggestKey(name: string): string {
  const words = name
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .toUpperCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '';
  let key = words.length === 1 ? words[0].slice(0, 6) : words.map((w) => w[0]).join('').slice(0, 6);
  key = key.replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]/.test(key)) key = `S${key}`;
  return key.slice(0, 10);
}

export function CreateSpaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [icon, setIcon] = useState<string | null>('📘');
  const [color, setColor] = useState<string | null>('#2563eb');
  const [preset, setPreset] = useState<'open' | 'readonly' | 'private'>('open');
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setKey('');
      setKeyTouched(false);
      setDescription('');
      setIcon('📘');
      setPreset('open');
    }
  }, [open]);

  const submit = async () => {
    setBusy(true);
    try {
      const space = await api.post<Space>('/api/v1/spaces', { name, key, description, icon, color, preset, category });
      await qc.invalidateQueries({ queryKey: ['spaces'] });
      onClose();
      navigate(`/s/${encodeURIComponent(space.key)}`);
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('spaces.createTitle')}
      icon={FolderPlus}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim() || key.length < 2} onClick={submit}>
            {t('spaces.create')}
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="row row-top gap-lg">
          <Field label={t('spaces.icon')}>
            <EmojiPicker value={icon} onChange={setIcon} allowClear={false} />
          </Field>
          <Field label={t('common.name')} className="grow" required>
            <Input
              value={name}
              autoFocus
              onChange={(e) => {
                setName(e.target.value);
                if (!keyTouched) setKey(suggestKey(e.target.value));
              }}
            />
          </Field>
        </div>
        <Field label={t('spaces.key')} help={t('spaces.keyHelp')} required>
          <Input
            value={key}
            className="mono"
            maxLength={20}
            onChange={(e) => {
              setKeyTouched(true);
              setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''));
            }}
          />
        </Field>
        <Field label={t('common.description')}>
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Field label={t('spaces.category')} help={t('spaces.categoryHelp')}>
          <CategorySelect value={category} onChange={setCategory} />
        </Field>
        <Field label={t('spaces.color')}>
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <Field label={t('spaces.preset')}>
          <div className="col gap-sm">
            {(['open', 'readonly', 'private'] as const).map((p) => (
              <label key={p} className="checkbox-row">
                <input type="radio" name="preset" checked={preset === p} onChange={() => setPreset(p)} />
                <span>{t(`spaces.preset${p[0].toUpperCase()}${p.slice(1)}`)}</span>
              </label>
            ))}
          </div>
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

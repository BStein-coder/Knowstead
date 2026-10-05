import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutTemplate, Plus, X } from 'lucide-react';
import { api } from '../api/client';
import type { Template } from '../api/types';
import { useI18n } from '../i18n';
import { useToast } from '../lib/toast';
import { Button, Field, IconButton, Input, Loading, Modal, Textarea } from './ui';
import { EmojiPicker, TagInput } from './Pickers';
import { RichEditor } from '../editor/RichEditor';
import { CodeEditor } from '../editor/CodeEditor';

/** Vorlage anlegen oder bearbeiten (global oder für einen Bereich). */
export function TemplateEditorDialog({ template, spaceKey, onClose }: { template: Template | null; spaceKey: string | null; onClose: () => void }) {
  const full = useQuery({
    queryKey: ['template', template?.id],
    queryFn: () => api.get<Template>(`/api/v1/templates/${template!.id}`),
    enabled: !!template,
  });
  if (template && full.isLoading) {
    return (
      <Modal open onClose={onClose} size="xl">
        <Loading />
      </Modal>
    );
  }
  return <Editor template={full.data ?? null} spaceKey={spaceKey} onClose={onClose} />;
}

function Editor({ template, spaceKey, onClose }: { template: Template | null; spaceKey: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [icon, setIcon] = useState<string | null>(template?.icon ?? '📄');
  const [category, setCategory] = useState(template?.category ?? '');
  const [titlePattern, setTitlePattern] = useState(template?.titlePattern ?? '');
  const [content, setContent] = useState(template?.content ?? '');
  const [labels, setLabels] = useState<string[]>(template?.labels ?? []);
  const [properties, setProperties] = useState(template?.properties ?? []);
  const [busy, setBusy] = useState(false);
  const contentType = template?.contentType ?? 'richtext';

  const save = async () => {
    setBusy(true);
    const body = { name, description, icon, category, titlePattern, content, contentType, labels, properties: properties.filter((p) => p.name.trim()) };
    try {
      if (template) await api.put(`/api/v1/templates/${template.id}`, body);
      else await api.post('/api/v1/templates', { ...body, spaceKey });
      toast.success(t('common.changesSaved'));
      void qc.invalidateQueries({ queryKey: ['templates'] });
      void qc.invalidateQueries({ queryKey: ['template', template?.id] });
      onClose();
    } catch (err) {
      toast.error(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      dismissible={false}
      size="xl"
      icon={LayoutTemplate}
      title={template ? t('templates.edit') : t('templates.create')}
      footer={
        <>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="row row-top gap-lg">
        <Field label={t('spaces.icon')}>
          <EmojiPicker value={icon} onChange={setIcon} allowClear={false} />
        </Field>
        <Field label={t('common.name')} className="grow" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field label={t('templates.category')}>
          <Input value={category} onChange={(e) => setCategory(e.target.value)} />
        </Field>
      </div>
      <Field label={t('common.description')}>
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="form-grid">
        <Field label={t('templates.titlePattern')} help="z. B. Besprechung {{isodatum}}">
          <Input value={titlePattern} onChange={(e) => setTitlePattern(e.target.value)} />
        </Field>
        <Field label={t('page.labels')}>
          <TagInput value={labels} onChange={setLabels} />
        </Field>
      </div>
      <Field label={t('page.properties')}>
        <div className="col gap-sm">
          {properties.map((p, i) => (
            <div key={i} className="row">
              <Input className="input-sm" style={{ maxWidth: 220 }} value={p.name} placeholder={t('page.propertyName')} onChange={(e) => setProperties(properties.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Input className="input-sm grow" value={p.value} placeholder={t('page.propertyValue')} onChange={(e) => setProperties(properties.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
              <IconButton icon={X} label={t('common.remove')} onClick={() => setProperties(properties.filter((_, j) => j !== i))} />
            </div>
          ))}
          <div>
            <Button size="sm" icon={Plus} onClick={() => setProperties([...properties, { name: '', value: '', type: 'text' }])}>
              {t('page.addProperty')}
            </Button>
          </div>
        </div>
      </Field>
      <Field label={t('templates.content')}>
        <div className="card" style={{ padding: '0 1rem 1rem', maxHeight: '55vh', overflow: 'auto' }}>
          {contentType === 'richtext' ? (
            <RichEditor
              initialContent={content}
              pageId={null}
              spaceKey={spaceKey}
              onChange={setContent}
              toolbarTarget={(toolbar) => <div style={{ position: 'sticky', top: 0, background: 'var(--bg)', zIndex: 5, margin: '0 -1rem 0.75rem' }}>{toolbar}</div>}
            />
          ) : (
            <CodeEditor value={content} onChange={setContent} language={contentType === 'markdown' ? 'markdown' : null} wrap />
          )}
        </div>
      </Field>
    </Modal>
  );
}

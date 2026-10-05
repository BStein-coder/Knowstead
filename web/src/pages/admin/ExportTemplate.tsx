import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileDown, FileOutput, ImagePlus, Save, Trash2 } from 'lucide-react';
import { api, saveFile } from '../../api/client';
import { useI18n, type TFn } from '../../i18n';
import { useToast } from '../../lib/toast';
import { exportFooterText } from '../../lib/built-in-texts';
import { Alert, Button, Card, Field, Input, Loading, PageHeader, Select, Switch } from '../../components/ui';
import { ColorPicker } from '../../components/Pickers';

export interface ExportTemplate {
  company: string;
  logo: string;
  primaryColor: string;
  font: string;
  coverPage: boolean;
  toc: boolean;
  headerText: string;
  footerText: string;
  classification: string;
  paper: 'A4' | 'LETTER';
}

const FONTS = ['Calibri', 'Aptos', 'Arial', 'Segoe UI', 'Verdana', 'Cambria', 'Georgia', 'Times New Roman'];
const MAX_LOGO = 512 * 1024;

/** Platzhalter mit Beispielwerten für die Vorschau – Beschriftungen in der Sprache der Oberfläche. */
function placeholders(t: TFn, locale: string): { key: string; label: string; sample: string }[] {
  return [
    { key: 'company', label: t('adminExport.ph.company'), sample: '' },
    { key: 'title', label: t('adminExport.ph.title'), sample: t('adminExport.sample.title') },
    { key: 'space', label: t('adminExport.ph.space'), sample: t('adminExport.sample.space') },
    { key: 'date', label: t('adminExport.ph.date'), sample: new Date().toLocaleDateString(locale === 'en' ? 'en-GB' : 'de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) },
    { key: 'version', label: t('adminExport.ph.version'), sample: t('adminExport.sample.version') },
    { key: 'author', label: t('adminExport.ph.author'), sample: 'Ada Admin' },
    { key: 'owner', label: t('adminExport.ph.owner'), sample: 'Bernd Betrieb' },
    { key: 'classification', label: t('adminExport.ph.classification'), sample: '' },
  ];
}

/** Gleiche Regeln wie auf dem Server: Platzhalter ersetzen, verwaiste Trennzeichen entfernen. */
function fill(text: string, tpl: ExportTemplate, PLACEHOLDERS: { key: string; sample: string }[]): string {
  const values: Record<string, string> = Object.fromEntries(PLACEHOLDERS.map((p) => [p.key, p.sample]));
  values.company = tpl.company;
  values.classification = tpl.classification;
  return text
    .replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m)
    .replace(/(\s+[·|•–])(\s+[·|•–])+(?=\s)/g, '$1')
    .replace(/^[\s·|•–]+|[\s·|•–]+$/g, '');
}

/** Administration → Export-Vorlage: Deckblatt, Logo, Farben, Kopf- und Fußzeile für PDF und Word. */
export function AdminExportTemplate() {
  const { t, locale } = useI18n();
  const PLACEHOLDERS = placeholders(t, locale);
  const toast = useToast();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['admin-settings'], queryFn: () => api.get<{ exportTemplate: ExportTemplate }>('/api/v1/admin/settings') });
  const [tpl, setTpl] = useState<ExportTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [sample, setSample] = useState<'pdf' | 'docx' | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const focused = useRef<'headerText' | 'footerText'>('headerText');

  // Die unveränderte Vorgabe der Fußzeile steht im Formular in der Sprache der Oberfläche
  const localized = (template: ExportTemplate): ExportTemplate => ({ ...structuredClone(template), footerText: exportFooterText(template.footerText, t) });

  useEffect(() => {
    if (settings.data && !dirty) setTpl(localized(settings.data.exportTemplate));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `localized` hängt nur an der Sprache
  }, [settings.data, dirty, locale]);

  if (settings.isLoading || !tpl) return <Loading />;
  const set = (patch: Partial<ExportTemplate>) => {
    setTpl({ ...tpl, ...patch });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.put<{ exportTemplate: ExportTemplate }>('/api/v1/admin/settings', { exportTemplate: tpl });
      setTpl(localized(saved.exportTemplate));
      setDirty(false);
      void qc.invalidateQueries({ queryKey: ['admin-settings'] });
      void qc.invalidateQueries({ queryKey: ['export-template-defaults'] });
      toast.success(t('common.changesSaved'));
    } catch (err) {
      toast.error(err);
    } finally {
      setSaving(false);
    }
  };

  const downloadSample = async (format: 'pdf' | 'docx') => {
    setSample(format);
    try {
      await saveFile('POST', '/api/v1/admin/export-template/sample', { body: { format, template: tpl } });
    } catch (err) {
      toast.error(err);
    } finally {
      setSample(null);
    }
  };

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|svg\+xml)$/.test(file.type)) {
      toast.error(t('adminExport.logoType'));
      return;
    }
    if (file.size > MAX_LOGO) {
      toast.error(t('adminExport.logoSize'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => set({ logo: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const insert = (key: string) => {
    const field = focused.current;
    const current = tpl[field];
    set({ [field]: `${current}${current && !current.endsWith(' ') ? ' · ' : ''}{${key}}` } as Partial<ExportTemplate>);
  };

  const header = fill(tpl.headerText, tpl, PLACEHOLDERS);
  const footer = fill(tpl.footerText, tpl, PLACEHOLDERS);
  const color = /^#[0-9a-f]{6}$/i.test(tpl.primaryColor) ? tpl.primaryColor : '#2563eb';

  return (
    <>
      <PageHeader
        icon={FileOutput}
        title={t('adminExport.title')}
        subtitle={t('adminExport.subtitle')}
        actions={
          <Button variant="primary" icon={Save} loading={saving} disabled={!dirty} onClick={() => void save()}>
            {t('common.save')}
          </Button>
        }
      />
      <div className="export-template-layout">
        <div className="col gap-lg">
          <Card title={t('adminExport.brand')}>
            <div className="form-grid">
              <Field label={t('adminExport.company')} help={t('adminExport.companyHelp')}>
                <Input value={tpl.company} maxLength={120} onChange={(e) => set({ company: e.target.value })} placeholder={t('adminExport.companyPlaceholder')} />
              </Field>
              <Field label={t('adminExport.classification')} help={t('adminExport.classificationHelp')}>
                <Input value={tpl.classification} maxLength={60} onChange={(e) => set({ classification: e.target.value })} placeholder={t('adminExport.classificationPlaceholder')} />
              </Field>
              <Field label={t('adminExport.color')} help={t('adminExport.colorHelp')}>
                <div className="row">
                  <ColorPicker value={color} onChange={(c) => set({ primaryColor: c })} />
                  <Input value={tpl.primaryColor} onChange={(e) => set({ primaryColor: e.target.value.trim() })} className="mono" style={{ width: 110 }} aria-label={t('adminExport.colorHex')} />
                </div>
              </Field>
              <Field label={t('adminExport.font')} help={t('adminExport.fontHelp')}>
                <Select value={FONTS.includes(tpl.font) ? tpl.font : ''} onChange={(e) => set({ font: e.target.value || tpl.font })}>
                  {!FONTS.includes(tpl.font) && <option value="">{tpl.font}</option>}
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('adminExport.paper')}>
                <Select value={tpl.paper} onChange={(e) => set({ paper: e.target.value as ExportTemplate['paper'] })}>
                  <option value="A4">DIN A4</option>
                  <option value="LETTER">US Letter</option>
                </Select>
              </Field>
            </div>
            <Field label={t('adminExport.logo')} help={t('adminExport.logoHelp')}>
              <div className="export-logo-row">
                <div className="export-logo-box">{tpl.logo ? <img src={tpl.logo} alt="Logo" /> : <span className="muted small">{t('adminExport.noLogo')}</span>}</div>
                <Button icon={ImagePlus} onClick={() => fileInput.current?.click()}>
                  {tpl.logo ? t('adminExport.otherLogo') : t('adminExport.uploadLogo')}
                </Button>
                {tpl.logo && (
                  <Button variant="ghost" icon={Trash2} onClick={() => set({ logo: '' })}>
                    {t('adminExport.remove')}
                  </Button>
                )}
                <input
                  ref={fileInput}
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/svg+xml"
                  onChange={(e) => {
                    pickLogo(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
              </div>
            </Field>
          </Card>

          <Card title={t('adminExport.structure')}>
            <div className="col gap-sm">
              <Switch checked={tpl.coverPage} onChange={(v) => set({ coverPage: v })} label={t('adminExport.cover')} description={t('adminExport.coverHelp')} />
              <Switch checked={tpl.toc} onChange={(v) => set({ toc: v })} label={t('adminExport.toc')} description={t('adminExport.tocHelp')} />
            </div>
            <p className="small muted mt-2">{t('adminExport.structureHint')}</p>
          </Card>

          <Card title={t('adminExport.headerFooter')}>
            <div className="form-grid">
              <Field label={t('adminExport.header')}>
                <Input value={tpl.headerText} maxLength={200} onFocus={() => (focused.current = 'headerText')} onChange={(e) => set({ headerText: e.target.value })} />
              </Field>
              <Field label={t('adminExport.footer')} help={t('adminExport.footerHelp')}>
                <Input value={tpl.footerText} maxLength={200} onFocus={() => (focused.current = 'footerText')} onChange={(e) => set({ footerText: e.target.value })} />
              </Field>
            </div>
            <div className="export-placeholders">
              <span className="small muted">{t('adminExport.insertPlaceholder')}</span>
              {PLACEHOLDERS.map((p) => (
                <button key={p.key} type="button" className="chip" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p.key)} title={p.label}>
                  {`{${p.key}}`}
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="export-template-side">
          <Card
            title={t('adminExport.preview')}
            actions={
              <div className="row gap-xs">
                <Button size="sm" icon={FileDown} loading={sample === 'pdf'} onClick={() => void downloadSample('pdf')}>
                  {t('adminExport.samplePdf')}
                </Button>
                <Button size="sm" icon={FileDown} loading={sample === 'docx'} onClick={() => void downloadSample('docx')}>
                  {t('adminExport.sampleWord')}
                </Button>
              </div>
            }
          >
            <div className="export-preview" style={{ ['--tpl-color' as string]: color }}>
              {tpl.coverPage && (
                <div className="paper paper-cover" aria-label={t('adminExport.cover')}>
                  <div className="paper-bar" />
                  {tpl.logo && <img className="paper-logo" src={tpl.logo} alt="" />}
                  {tpl.company && <div className="paper-company">{tpl.company}</div>}
                  <div className="paper-title">{t('adminExport.sample.title')}</div>
                  <div className="paper-subtitle">{t('adminExport.sample.space')}</div>
                  <dl className="paper-meta">
                    <dt>{t('adminExport.ph.date')}</dt>
                    <dd>{PLACEHOLDERS[3].sample}</dd>
                    <dt>{t('adminExport.ph.version')}</dt>
                    <dd>{t('adminExport.sample.version')}</dd>
                    <dt>{t('adminExport.ph.owner')}</dt>
                    <dd>Bernd Betrieb</dd>
                    {tpl.classification && (
                      <>
                        <dt>{t('adminExport.ph.classification')}</dt>
                        <dd>{tpl.classification}</dd>
                      </>
                    )}
                  </dl>
                </div>
              )}
              <div className="paper" aria-label={t('adminExport.contentPage')}>
                <div className="paper-header">
                  <span>{header}</span>
                  <strong>{tpl.classification}</strong>
                </div>
                <div className="paper-body">
                  {tpl.toc && (
                    <div className="paper-toc">
                      <div className="paper-h1">{t('adminExport.toc')}</div>
                      {[t('adminExport.sample.purpose'), t('adminExport.sample.operation'), t('adminExport.sample.incidents')].map((line, i) => (
                        <div key={line} className="paper-toc-line">
                          <span>{line}</span>
                          <span>{i + 3}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="paper-h1">{t('adminExport.sample.purpose')}</div>
                  <div className="paper-text" />
                  <div className="paper-text short" />
                  <div className="paper-h2">{t('adminExport.sample.operation')}</div>
                  <div className="paper-text" />
                  <div className="paper-text" />
                  <div className="paper-text short" />
                </div>
                <div className="paper-footer">
                  <span>{footer}</span>
                  <span>{t('adminExport.pageOf', { page: 2, pages: 5 })}</span>
                </div>
              </div>
            </div>
            {dirty && (
              <div className="mt-2">
                <Alert variant="info">{t('adminExport.unsavedHint')}</Alert>
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

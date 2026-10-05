import type { ExportTemplateSettings } from '../../core/settings.ts';
import { DEFAULT_SETTINGS } from '../../core/settings.ts';
import { badRequest } from '../../core/errors.ts';
import { sniffImage } from './model.ts';

export const MAX_LOGO_BYTES = 512 * 1024;

/** Vorlage prüfen und bereinigen (Administration und Musterdokument). */
export function validateExportTemplate(input: Partial<ExportTemplateSettings>): ExportTemplateSettings {
  const d = DEFAULT_SETTINGS.exportTemplate;
  const text = (value: unknown, fallback: string, max: number, label: string): string => {
    const clean = typeof value === 'string' ? value.replace(/[\r\n\t]+/g, ' ').trim() : fallback;
    if (clean.length > max) throw badRequest(`${label}: höchstens ${max} Zeichen`);
    return clean;
  };
  const tpl: ExportTemplateSettings = {
    company: text(input.company, d.company, 120, 'Firmenname'),
    logo: typeof input.logo === 'string' ? input.logo.trim() : '',
    primaryColor: typeof input.primaryColor === 'string' ? input.primaryColor.trim() : d.primaryColor,
    font: text(input.font, d.font, 60, 'Schriftart') || d.font,
    coverPage: typeof input.coverPage === 'boolean' ? input.coverPage : d.coverPage,
    toc: typeof input.toc === 'boolean' ? input.toc : d.toc,
    headerText: text(input.headerText, d.headerText, 200, 'Kopfzeile'),
    footerText: text(input.footerText, d.footerText, 200, 'Fußzeile'),
    classification: text(input.classification, d.classification, 60, 'Klassifizierung'),
    paper: input.paper === 'LETTER' ? 'LETTER' : 'A4',
  };
  if (!/^#[0-9a-f]{6}$/i.test(tpl.primaryColor)) throw badRequest('Ungültige Vorlagenfarbe (Format #RRGGBB)');
  if (!/^[\p{L}\p{N} ._-]+$/u.test(tpl.font)) throw badRequest('Ungültige Schriftart');
  if (tpl.logo) {
    const m = tpl.logo.match(/^data:image\/[a-z0-9.+-]+;base64,([a-z0-9+/=]+)$/i);
    if (!m) throw badRequest('Das Logo muss ein PNG-, JPEG- oder SVG-Bild sein');
    const data = Buffer.from(m[1], 'base64');
    if (data.length > MAX_LOGO_BYTES) throw badRequest('Das Logo darf höchstens 512 KB groß sein');
    const kind = sniffImage(data);
    if (!kind) throw badRequest('Das Logo muss ein PNG-, JPEG- oder SVG-Bild sein');
    // Typ nach dem tatsächlichen Inhalt setzen
    tpl.logo = `data:${kind};base64,${data.toString('base64')}`;
  }
  return tpl;
}

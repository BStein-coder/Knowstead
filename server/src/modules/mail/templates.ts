/**
 * E-Mail-Vorlagen: eine schlichte, gut lesbare HTML-Mail (Tabellen-Layout mit
 * Inline-Stilen, damit Outlook & Co. sie korrekt darstellen) plus Textfassung.
 */
import { escapeHtml } from '../../core/html.ts';
import { FREE_TEXT_MIN_FIXED, translate, type Locale } from '../../core/i18n.ts';

export interface MailBrand {
  siteName: string;
  accent: string;
  baseUrl: string;
}

export interface MailItem {
  title: string;
  meta?: string;
  /** weitere Zeilen unter dem Titel – feste Texte, werden wie der Titel übersetzt */
  lines?: string[];
  url: string;
}

export interface MailLayout {
  heading: string;
  /** Absätze (Klartext, werden maskiert) */
  paragraphs?: string[];
  /** hervorgehobener Auszug, z. B. Kommentartext */
  quote?: string;
  items?: MailItem[];
  action?: { label: string; url: string };
  /** Hinweis in der Fußzeile, warum die Mail kommt */
  reason: string;
}

export interface RenderedMail {
  subject: string;
  text: string;
  html: string;
}

const SAFE_COLOR = /^#[0-9a-f]{6}$/i;

/** Relative Links (/s/…) absolut machen, fremde Schemata verwerfen. */
export function absoluteUrl(brand: MailBrand, link: string): string {
  if (/^https?:\/\//i.test(link)) return link;
  if (link.startsWith('/')) return `${brand.baseUrl}${link}`;
  return brand.baseUrl;
}

/** Mail in der Sprache der empfangenden Person – Texte kommen deutsch und werden über den Katalog übertragen. */
export function renderMail(brand: MailBrand, rawSubject: string, rawLayout: MailLayout, locale: Locale = 'de'): RenderedMail {
  const tr = (value: string) => translate(value, locale);
  const prefix = `${brand.siteName}: `;
  const whole = tr(rawSubject);
  const subject = whole === rawSubject && rawSubject.startsWith(prefix) ? `${prefix}${tr(rawSubject.slice(prefix.length))}` : whole;
  const layout: MailLayout = {
    heading: tr(rawLayout.heading),
    paragraphs: rawLayout.paragraphs?.map(tr),
    quote: rawLayout.quote ? translate(rawLayout.quote, locale, FREE_TEXT_MIN_FIXED) : undefined,
    items: rawLayout.items?.map((item) => ({ ...item, title: tr(item.title), lines: item.lines?.map(tr) })),
    action: rawLayout.action ? { ...rawLayout.action, label: tr(rawLayout.action.label) } : undefined,
    reason: tr(rawLayout.reason),
  };
  const accent = SAFE_COLOR.test(brand.accent) ? brand.accent : '#2563eb';
  const site = escapeHtml(brand.siteName);
  const paragraphs = (layout.paragraphs ?? []).filter(Boolean);
  const actionUrl = layout.action ? absoluteUrl(brand, layout.action.url) : '';

  const text = [
    layout.heading,
    '',
    ...paragraphs.flatMap((p) => [p, '']),
    ...(layout.quote ? [`> ${layout.quote.replace(/\n/g, '\n> ')}`, ''] : []),
    ...(layout.items ?? []).flatMap((item) => [`• ${item.title}${item.meta ? ` (${item.meta})` : ''}`, ...(item.lines ?? []).map((line) => `  ${line}`), `  ${absoluteUrl(brand, item.url)}`]),
    ...(layout.items?.length ? [''] : []),
    ...(layout.action ? [`${layout.action.label}: ${actionUrl}`, ''] : []),
    '—',
    `${brand.siteName} · ${layout.reason}`,
    `${tr('Einstellungen')}: ${brand.baseUrl}/profile`,
  ].join('\n');

  const itemsHtml = (layout.items ?? [])
    .map(
      (item) => `
        <tr>
          <td style="padding:10px 0;border-top:1px solid #e8ebf2;">
            <a href="${escapeHtml(absoluteUrl(brand, item.url))}" style="color:#0b1220;font-weight:600;text-decoration:none;">${escapeHtml(item.title)}</a>
            ${item.meta ? `<div style="color:#69728a;font-size:13px;margin-top:2px;">${escapeHtml(item.meta)}</div>` : ''}
            ${(item.lines ?? []).map((line) => `<div style="color:#4a5365;font-size:14px;line-height:1.5;margin-top:4px;">${escapeHtml(line)}</div>`).join('')}
          </td>
        </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#232936;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fa;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
          <tr>
            <td style="padding:0 4px 14px;font-size:14px;font-weight:700;color:${accent};letter-spacing:.2px;">${site}</td>
          </tr>
          <tr>
            <td style="background:#ffffff;border-radius:14px;border:1px solid #e3e7ef;padding:26px 28px;">
              <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35;color:#0b1220;">${escapeHtml(layout.heading)}</h1>
              ${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')}
              ${
                layout.quote
                  ? `<div style="margin:6px 0 16px;padding:10px 14px;border-left:3px solid ${accent};background:#f6f8fc;border-radius:0 8px 8px 0;font-size:14px;line-height:1.5;color:#4a5365;">${escapeHtml(layout.quote).replace(/\n/g, '<br>')}</div>`
                  : ''
              }
              ${itemsHtml ? `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 12px;">${itemsHtml}</table>` : ''}
              ${
                layout.action
                  ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:18px 0 4px;"><tr><td style="border-radius:9px;background:${accent};">
                      <a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:11px 20px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9px;">${escapeHtml(layout.action.label)}</a>
                    </td></tr></table>`
                  : ''
              }
            </td>
          </tr>
          <tr>
            <td style="padding:14px 6px;font-size:12px;line-height:1.5;color:#99a1b3;">
              ${escapeHtml(layout.reason)}<br>
              <a href="${escapeHtml(brand.baseUrl)}/profile" style="color:#69728a;">${escapeHtml(tr('Benachrichtigungen einstellen'))}</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

import { createT, type TFn } from '../i18n';

const german = createT('de');
const english = createT('en');

/**
 * Einige Vorgaben stehen als Text in den Einstellungen: der Untertitel der Installation, die Fußzeile der
 * Export-Vorlage, die Beschriftung der Anmeldeknöpfe. Gespeichert sind sie in der Sprache, in der sie angelegt
 * oder zuletzt gespeichert wurden. Solange niemand einen eigenen Text eingetragen hat, zeigt die Oberfläche sie
 * in ihrer Sprache – sonst stünde in einer englischen Oberfläche der deutsche Text. Eigene Texte bleiben, wie
 * sie sind.
 */
function builtIn(key: string, value: string, t: TFn): string {
  return value === german(key) || value === english(key) ? t(key) : value;
}

/** Untertitel der Installation (Anmeldeseite, Startseite, Einstellungen) */
export function taglineText(value: string | null | undefined, t: TFn): string {
  return builtIn('app.tagline', (value ?? '').trim(), t);
}

/** Fußzeile der Export-Vorlage – der Export schreibt die Vorgabe ohnehin in der Sprache des Dokuments */
export function exportFooterText(value: string, t: TFn): string {
  return builtIn('adminExport.defaultFooter', value, t);
}

/** Beschriftung eines Anmeldeknopfs – die Anmeldeseite zeigt die Vorgabe ohnehin in der Sprache der Person */
export function ssoLabelText(provider: 'oidc' | 'saml' | 'kerberos', value: string, t: TFn): string {
  return builtIn(`sso.defaultLabel.${provider}`, value, t);
}

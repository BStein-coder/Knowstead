import { useEffect } from 'react';
import { Fingerprint, KeyRound, MonitorSmartphone } from 'lucide-react';
import type { SsoInfo, SsoProviderId } from '../../api/types';

/** Bekannte Fehlerkennungen der Anmeldung – andere Werte aus der URL werden nie angezeigt. */
export const SSO_ERROR_CODES = ['unavailable', 'flow', 'provider', 'no_account', 'account_exists', 'admin_link', 'conflict', 'group', 'disabled', 'identity_taken', 'proxy', 'no_user'];

/** Nach dem Abmelden nicht sofort wieder automatisch per Windows-Konto anmelden. */
export const SKIP_AUTO_SSO_KEY = 'knowstead.sso.skipAuto';

export function SsoProviderIcon({ provider }: { provider: SsoProviderId }) {
  const Icon = provider === 'oidc' ? KeyRound : provider === 'saml' ? Fingerprint : MonitorSmartphone;
  return <Icon size={16} aria-hidden />;
}

export function ssoStartUrl(provider: SsoProviderId, next: string, remember: boolean): string {
  const query = new URLSearchParams({ next, remember: String(remember) });
  return `/api/v1/auth/${provider === 'kerberos' ? 'kerberos' : `${provider}/start`}?${query.toString()}`;
}

/** Anmeldeknöpfe für Single Sign-on; die Windows-Anmeldung startet auf Wunsch selbstständig. */
export function SsoButtons({ sso, next, remember, autoStart }: { sso: SsoInfo; next: string; remember: boolean; autoStart: boolean }) {
  useEffect(() => {
    if (!autoStart || !sso.kerberosAuto) return;
    let skip = false;
    try {
      skip = sessionStorage.getItem(SKIP_AUTO_SSO_KEY) === '1';
    } catch {
      /* Speicher nicht verfügbar */
    }
    if (!skip) window.location.replace(ssoStartUrl('kerberos', next, remember));
  }, [autoStart, sso.kerberosAuto, next, remember]);

  if (!sso.providers.length) return null;
  return (
    <div className="sso-buttons">
      {sso.providers.map((provider) => (
        <a key={provider.id} className="btn btn-secondary btn-lg btn-block" href={ssoStartUrl(provider.id, next, remember)}>
          <SsoProviderIcon provider={provider.id} />
          <span>{provider.label}</span>
        </a>
      ))}
    </div>
  );
}

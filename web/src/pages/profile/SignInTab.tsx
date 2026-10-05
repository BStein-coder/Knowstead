import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Link2, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import type { LinkedIdentity, SsoInfo, SsoProviderId } from '../../api/types';
import { useI18n } from '../../i18n';
import { useToast } from '../../lib/toast';
import { useDialogs } from '../../lib/dialogs';
import { Alert, Button, Card, EmptyState, Loading, Time } from '../../components/ui';
import { SSO_ERROR_CODES, SsoProviderIcon } from '../auth/SsoButtons';

/** Profil → Anmeldung: mit Entra ID, SAML oder dem Windows-Konto verknüpfte Anmeldungen. */
export function SignInTab() {
  const { t } = useI18n();
  const toast = useToast();
  const dialogs = useDialogs();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState<SsoProviderId | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['my-identities'],
    queryFn: () => api.get<{ items: LinkedIdentity[]; available: SsoInfo['providers'] }>('/api/v1/me/identities'),
  });
  if (isLoading || !data) return <Loading />;
  const error = params.get('sso_error');

  const link = async (provider: SsoProviderId) => {
    setBusy(provider);
    try {
      const { url } = await api.post<{ url: string }>(`/api/v1/me/identities/${provider}/link`);
      window.location.href = url;
    } catch (err) {
      toast.error(err);
      setBusy(null);
    }
  };

  const unlink = async (identity: LinkedIdentity) => {
    const ok = await dialogs.confirm({
      title: t('sso.unlinkTitle'),
      message: t('sso.unlinkText', { account: identity.label, provider: t(`sso.providerNames.${identity.provider}`) }),
      confirmLabel: t('sso.unlink'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/api/v1/me/identities/${identity.id}`);
      await refetch();
      toast.success(t('common.changesSaved'));
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <div className="col gap-lg">
      {params.get('linked') && <Alert variant="success">{t('sso.linked')}</Alert>}
      {error && <Alert variant="error">{t(`sso.errors.${SSO_ERROR_CODES.includes(error) ? error : 'provider'}`)}</Alert>}
      <p className="muted" style={{ margin: 0 }}>
        {t('sso.profileIntro')}
      </p>
      <Card title={t('sso.linkedTitle')}>
        {data.items.length === 0 ? (
          <EmptyState compact icon={Link2} title={t('sso.noLinked')} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {data.items.map((identity) => (
                  <tr key={identity.id}>
                    <td>
                      <div className="row gap-sm">
                        <SsoProviderIcon provider={identity.provider} />
                        <strong>{t(`sso.providerNames.${identity.provider}`)}</strong>
                        <span className="muted">{identity.label}</span>
                      </div>
                      <div className="small muted">
                        {t('sso.linkedSince')} <Time value={identity.createdAt} />
                        {identity.lastLoginAt && (
                          <>
                            {' · '}
                            {t('sso.lastUsed')} <Time value={identity.lastLoginAt} />
                          </>
                        )}
                      </div>
                    </td>
                    <td className="actions-cell">
                      <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void unlink(identity)}>
                        {t('sso.unlink')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {data.available.length > 0 && (
        <Card title={t('sso.linkTitle')}>
          <p className="small muted" style={{ marginTop: 0 }}>
            {t('sso.linkIntro')}
          </p>
          <div className="row gap-sm" style={{ flexWrap: 'wrap' }}>
            {data.available.map((provider) => (
              <Button key={provider.id} loading={busy === provider.id} onClick={() => void link(provider.id)}>
                <SsoProviderIcon provider={provider.id} /> {provider.label}
              </Button>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

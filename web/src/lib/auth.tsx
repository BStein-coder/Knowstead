import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Me, MeResponse, Preferences, PublicSettings } from '../api/types';
import { storedLocale, useI18n } from '../i18n';
import { applyAccent, applyTheme } from './theme';
import { applyMotion, storedMotion } from './motion';

interface AuthValue {
  data: MeResponse | undefined;
  user: Me | null;
  settings: PublicSettings;
  loading: boolean;
  isAdmin: boolean;
  can: (permission: string) => boolean;
  refresh: () => Promise<unknown>;
  logout: () => Promise<void>;
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
}

const DEFAULT_SETTINGS: PublicSettings = {
  siteName: 'Knowstead',
  siteTagline: '',
  accentColor: '#2563eb',
  uiMotion: 'full',
  defaultLocale: 'de',
  allowRegistration: false,
  anonymousAccess: false,
  footerText: '',
  passwordMinLength: 10,
  personalSpaces: true,
  maxUploadMb: 50,
  allowedEmbedHosts: [],
  drawioUrl: 'https://embed.diagrams.net',
  realtimeCollaboration: true,
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { setLocale, locale } = useI18n();
  const query = useQuery({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/api/v1/auth/me'),
    staleTime: 60_000,
    retry: 1,
  });

  const data = query.data;
  const user = data?.user ?? null;
  const settings = data?.settings ?? DEFAULT_SETTINGS;

  // Theme, Akzentfarbe, Sprache und Titel anwenden
  useEffect(() => {
    applyTheme(user?.preferences?.theme);
  }, [user?.preferences?.theme]);
  useEffect(() => {
    applyAccent(settings.accentColor);
    document.title = settings.siteName;
  }, [settings.accentColor, settings.siteName]);
  // Bewegung und Effekte: eigene Wahl des Kontos → Wahl auf diesem Gerät → Vorgabe der Installation
  useEffect(() => {
    if (!data) return;
    const pref = user?.preferences?.motion;
    if (pref === 'full' || pref === 'reduced') applyMotion(pref, true);
    else if (!storedMotion()) applyMotion(settings.uiMotion === 'reduced' ? 'reduced' : 'full');
  }, [data, user?.preferences?.motion, settings.uiMotion]);
  useEffect(() => {
    if (!data) return;
    const pref = user?.preferences?.locale as 'de' | 'en' | undefined;
    if (pref) {
      if (pref !== locale) setLocale(pref);
    } else if (!storedLocale() && settings.defaultLocale !== locale) {
      setLocale(settings.defaultLocale, false);
    }
  }, [user?.preferences?.locale, data, settings.defaultLocale, locale, setLocale]);

  useEffect(() => {
    const onUnauthorized = () => {
      if (qc.getQueryData<MeResponse>(['me'])?.user) void qc.invalidateQueries({ queryKey: ['me'] });
    };
    window.addEventListener('knowstead:unauthorized', onUnauthorized);
    return () => window.removeEventListener('knowstead:unauthorized', onUnauthorized);
  }, [qc]);

  const refresh = useCallback(() => qc.invalidateQueries({ queryKey: ['me'] }), [qc]);

  const logout = useCallback(async () => {
    await api.post('/api/v1/auth/logout');
    // Nach dem Abmelden nicht gleich wieder per Windows-Konto anmelden
    try {
      sessionStorage.setItem('knowstead.sso.skipAuto', '1');
    } catch {
      /* Speicher nicht verfügbar */
    }
    qc.clear();
    window.location.href = '/login';
  }, [qc]);

  const updatePreferences = useCallback(
    async (patch: Partial<Preferences>) => {
      await api.patch('/api/v1/me/preferences', patch);
      await refresh();
    },
    [refresh],
  );

  const value = useMemo<AuthValue>(
    () => ({
      data,
      user,
      settings,
      loading: query.isLoading,
      isAdmin: !!user?.isAdmin,
      can: (p) => !!user && (user.isAdmin === true || user.permissions.includes(p)),
      refresh,
      logout,
      updatePreferences,
    }),
    [data, user, settings, query.isLoading, refresh, logout, updatePreferences],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('AuthProvider fehlt');
  return ctx;
}

import type { Db } from '../db/database.ts';
import { parseJson } from '../db/database.ts';

export type SmtpSecurity = 'starttls' | 'tls' | 'none';

export interface SmtpSettings {
  host: string;
  port: number;
  /** starttls = Port 587 mit Pflicht-STARTTLS · tls = direkt verschlüsselt (465) · none = unverschlüsselt (interner Relay) */
  security: SmtpSecurity;
  /** veraltet (bis 1.1) – wird beim Speichern aus `security` abgeleitet */
  secure: boolean;
  user: string;
  /** verschlüsselt gespeichert */
  password: string;
  from: string;
  /** optionale Antwortadresse */
  replyTo: string;
  /** Serverzertifikat prüfen – nur für interne Server mit eigenem Zertifikat abschalten */
  rejectUnauthorized: boolean;
}

/** Anbindung an Active Directory bzw. einen LDAP-Server. */
export interface DirectorySettings {
  enabled: boolean;
  /** z. B. ldaps://dc01.example.com:636 */
  url: string;
  startTls: boolean;
  rejectUnauthorized: boolean;
  /** Dienstkonto zum Suchen; leer = anonyme Suche */
  bindDn: string;
  /** verschlüsselt gespeichert */
  bindPassword: string;
  baseDn: string;
  /** eigener Suchbereich für Gruppen (leer = baseDn) */
  groupBaseDn: string;
  /** Suchfilter, {login} wird ersetzt */
  userFilter: string;
  userIdAttribute: string;
  nameAttribute: string;
  mailAttribute: string;
  groupAttribute: string;
  /** verschachtelte Gruppen über LDAP_MATCHING_RULE_IN_CHAIN auflösen */
  nestedGroups: boolean;
  /** Standarddomäne, damit „anna@example.com“ und „anna“ gleich behandelt werden */
  defaultDomain: string;
  /** Konten beim ersten erfolgreichen Anmelden anlegen */
  autoCreateUsers: boolean;
  /** bestehende lokale Konten mit gleichem Namen übernehmen */
  adoptLocalUsers: boolean;
  /** lokale Anmeldung zusätzlich erlauben */
  allowLocalLogin: boolean;
  /** nur Mitglieder dieser AD-Gruppe dürfen sich anmelden (CN oder DN) */
  requireGroup: string;
}

/** Gemeinsame Regeln der Anmeldung über einen Identitätsanbieter (OIDC, SAML). */
export interface SsoAccountRules {
  /** Konten beim ersten erfolgreichen Anmelden anlegen */
  autoCreateUsers: boolean;
  /** vorhandene Konten gleichen Benutzernamens verknüpfen (nie Administratoren) */
  adoptExistingUsers: boolean;
  /** Gruppen aus dem Anbieter auf Knowstead-Gruppen abbilden (Zuordnung wie beim Verzeichnis) */
  syncGroups: boolean;
  /** nur Mitglieder dieser Gruppe dürfen sich anmelden (Objekt-ID oder Name) */
  requireGroup: string;
  /** Domainanteil vom Benutzernamen entfernen: „anna@firma.de“ → „anna“ */
  stripDomain: boolean;
}

/** Anmeldung über OpenID Connect – Microsoft Entra ID oder ein anderer Anbieter (Keycloak, ADFS, Okta …). */
export interface OidcSettings extends SsoAccountRules {
  enabled: boolean;
  provider: 'entra' | 'generic';
  /** Beschriftung des Anmeldeknopfs */
  label: string;
  /** Entra ID: Verzeichnis-ID (Mandanten-ID, GUID) */
  tenantId: string;
  /** anderer Anbieter: Aussteller-URL, z. B. https://sso.firma.de/realms/firma */
  issuer: string;
  clientId: string;
  /** verschlüsselt gespeichert */
  clientSecret: string;
  scopes: string;
  usernameClaim: string;
  nameClaim: string;
  emailClaim: string;
  /** ein oder mehrere Claims, z. B. „groups roles“ */
  groupsClaim: string;
}

/** Anmeldung über SAML 2.0 (Entra ID, ADFS, Shibboleth …). */
export interface SamlSettings extends SsoAccountRules {
  enabled: boolean;
  label: string;
  /** Anmelde-URL des Identitätsanbieters (HTTP-Redirect-Bindung) */
  entryPoint: string;
  /** Entity-ID (Issuer) des Identitätsanbieters */
  idpEntityId: string;
  /** Signaturzertifikat(e) des Anbieters im PEM-Format – mehrere für den Zertifikatswechsel */
  idpCert: string;
  /** eigene Entity-ID; leer = Adresse der Metadaten */
  spEntityId: string;
  /** leer = NameID */
  usernameAttribute: string;
  nameAttribute: string;
  emailAttribute: string;
  groupsAttribute: string;
}

/** Windows-integrierte Anmeldung (Kerberos) über einen vorgeschalteten Webserver. */
export interface KerberosSettings {
  enabled: boolean;
  label: string;
  /** Kopfzeile, in die der Webserver das angemeldete Konto schreibt */
  header: string;
  /** Adressen bzw. Netze der Webserver, deren Angabe vertraut wird */
  trustedProxies: string[];
  /** gemeinsames Geheimnis in „X-Knowstead-Proxy-Secret“ (verschlüsselt gespeichert, optional) */
  proxySecret: string;
  /** Anmeldeseite versucht die Windows-Anmeldung selbstständig */
  autoLogin: boolean;
  /** ohne Verzeichnisanbindung: Konten beim ersten Anmelden anlegen */
  autoCreateUsers: boolean;
}

/** Anbindung an ein KI-Modell (optional, standardmäßig aus). */
export interface AiSettings {
  enabled: boolean;
  /** anthropic | openai | azure | ollama | custom (OpenAI-kompatibel) */
  provider: 'anthropic' | 'openai' | 'azure' | 'ollama' | 'custom';
  /** Abweichende Basis-URL (Pflicht bei azure, ollama, custom) */
  baseUrl: string;
  /** verschlüsselt gespeichert */
  apiKey: string;
  model: string;
  maxTokens: number;
  /** Temperatur mitsenden? Aktuelle Claude-Modelle lehnen den Parameter ab. */
  sendTemperature: boolean;
  temperature: number;
  /** Freigeschaltete Funktionen */
  actions: string[];
  /** Anfragen je Benutzer und Tag (0 = unbegrenzt) */
  dailyLimit: number;
  /** Zusätzliche Anweisung, die jeder Anfrage vorangestellt wird */
  systemPrompt: string;
}

/** Vorschau von Office-Dateien über LibreOffice (serverseitige PDF-Umwandlung). */
export interface OfficePreviewSettings {
  enabled: boolean;
  /** Pfad zu soffice; leer = übliche Installationsorte durchsuchen */
  sofficePath: string;
}

/** Texterkennung (OCR) mit Tesseract für eingescannte PDFs und Bilder. */
export interface OcrSettings {
  enabled: boolean;
  /** Pfad zu tesseract; leer = übliche Installationsorte */
  tesseractPath: string;
  /** Tesseract-Sprachen, z. B. deu+eng */
  languages: string;
  /** Höchstens so viele Seiten je PDF */
  maxPages: number;
}

/** Betriebswarnungen (Sicherung, Speicherplatz, fehlender Neustart) an die Administration. */
export interface AlertSettings {
  /** Warnungen per E-Mail an alle Administratorkonten */
  email: boolean;
  /** weitere Empfänger, z. B. ein Verteiler – Adressen durch Komma getrennt */
  recipients: string;
  /** warnen, wenn auf dem Laufwerk des Datenverzeichnisses weniger frei ist (GB, 0 = nie) */
  diskMinGb: number;
  /** warnen, wenn die neueste Sicherung älter ist (Tage, 0 = nie) */
  backupMaxAgeDays: number;
}

/** Firmenvorlage für PDF- und Word-Exporte. */
export interface ExportTemplateSettings {
  company: string;
  /** Logo als data-URL (PNG, JPEG oder SVG) */
  logo: string;
  primaryColor: string;
  /** Schriftart im Word-Dokument (PDF nutzt die eingebettete Roboto) */
  font: string;
  coverPage: boolean;
  toc: boolean;
  /** Platzhalter: {company} {title} {space} {date} {version} {author} {owner} {classification} */
  headerText: string;
  footerText: string;
  /** z. B. „Intern“ oder „Vertraulich“ – erscheint auf Deckblatt und in der Kopfzeile */
  classification: string;
  paper: 'A4' | 'LETTER';
}

/** Alle Systemeinstellungen mit Standardwerten. */
export interface Settings {
  siteName: string;
  siteTagline: string;
  accentColor: string;
  /** Vorgabe für Bewegung und 3D-Effekte der Oberfläche; „reduced“ z. B. für Terminalserver */
  uiMotion: 'full' | 'reduced';
  defaultLocale: 'de' | 'en';
  welcomeMessage: string;
  footerText: string;
  allowRegistration: boolean;
  registrationDomains: string[];
  anonymousAccess: boolean;
  personalSpaces: boolean;
  sessionDays: number;
  passwordMinLength: number;
  maxLoginAttempts: number;
  lockMinutes: number;
  maxUploadMb: number;
  blockedExtensions: string[];
  allowedEmbedHosts: string[];
  trashRetentionDays: number;
  revisionLimit: number;
  eventRetentionDays: number;
  backupEnabled: boolean;
  backupHour: number;
  backupKeep: number;
  backupIncludeUploads: boolean;
  alerts: AlertSettings;
  emailNotifications: boolean;
  /** Uhrzeit (Stunde, Serverzeit) für tägliche Zusammenfassungen */
  mailDigestHour: number;
  smtp: SmtpSettings;
  directory: DirectorySettings;
  oidc: OidcSettings;
  saml: SamlSettings;
  kerberos: KerberosSettings;
  /** Anmeldeformular für lokale Konten sichtbar, auch wenn Single Sign-on eingerichtet ist */
  showLocalLogin: boolean;
  ai: AiSettings;
  officePreview: OfficePreviewSettings;
  ocr: OcrSettings;
  exportTemplate: ExportTemplateSettings;
  /** Gleichzeitiges Bearbeiten in Echtzeit (WebSocket) */
  realtimeCollaboration: boolean;
  /** Adresse des draw.io-Editors (z. B. selbst betrieben) */
  drawioUrl: string;
}

export const DEFAULT_SETTINGS: Settings = {
  siteName: 'Knowstead',
  siteTagline: 'Dokumentation & Wissen',
  accentColor: '#2563eb',
  uiMotion: 'full',
  defaultLocale: 'de',
  welcomeMessage: '',
  footerText: '',
  allowRegistration: false,
  registrationDomains: [],
  anonymousAccess: false,
  personalSpaces: true,
  sessionDays: 30,
  passwordMinLength: 10,
  maxLoginAttempts: 5,
  lockMinutes: 10,
  maxUploadMb: 50,
  blockedExtensions: ['exe', 'bat', 'cmd', 'com', 'msi', 'ps1', 'vbs', 'scr'],
  allowedEmbedHosts: [
    'www.youtube.com',
    'www.youtube-nocookie.com',
    'player.vimeo.com',
    'viewer.diagrams.net',
    'embed.diagrams.net',
    'www.figma.com',
    'docs.google.com',
    'calendar.google.com',
    'app.powerbi.com',
    'miro.com',
    'www.openstreetmap.org',
  ],
  trashRetentionDays: 30,
  revisionLimit: 0,
  eventRetentionDays: 365,
  backupEnabled: true,
  backupHour: 3,
  backupKeep: 7,
  backupIncludeUploads: true,
  emailNotifications: false,
  mailDigestHour: 7,
  smtp: { host: '', port: 587, security: 'starttls', secure: false, user: '', password: '', from: '', replyTo: '', rejectUnauthorized: true },
  directory: {
    enabled: false,
    url: '',
    startTls: false,
    rejectUnauthorized: true,
    bindDn: '',
    bindPassword: '',
    baseDn: '',
    groupBaseDn: '',
    userFilter: '(&(objectClass=user)(sAMAccountName={login}))',
    userIdAttribute: 'sAMAccountName',
    nameAttribute: 'displayName',
    mailAttribute: 'mail',
    groupAttribute: 'memberOf',
    nestedGroups: true,
    defaultDomain: '',
    autoCreateUsers: true,
    adoptLocalUsers: false,
    allowLocalLogin: true,
    requireGroup: '',
  },
  oidc: {
    enabled: false,
    provider: 'entra',
    label: 'Mit Microsoft anmelden',
    tenantId: '',
    issuer: '',
    clientId: '',
    clientSecret: '',
    scopes: 'openid profile email',
    usernameClaim: 'preferred_username',
    nameClaim: 'name',
    emailClaim: 'email',
    groupsClaim: 'groups',
    autoCreateUsers: true,
    adoptExistingUsers: false,
    syncGroups: true,
    requireGroup: '',
    stripDomain: true,
  },
  saml: {
    enabled: false,
    label: 'Mit Firmenkonto anmelden (SAML)',
    entryPoint: '',
    idpEntityId: '',
    idpCert: '',
    spEntityId: '',
    usernameAttribute: '',
    nameAttribute: 'http://schemas.microsoft.com/identity/claims/displayname',
    emailAttribute: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    groupsAttribute: 'http://schemas.microsoft.com/ws/2008/06/identity/claims/groups',
    autoCreateUsers: true,
    adoptExistingUsers: false,
    syncGroups: true,
    requireGroup: '',
    stripDomain: true,
  },
  kerberos: {
    enabled: false,
    label: 'Mit Windows-Konto anmelden',
    header: 'X-Remote-User',
    trustedProxies: ['127.0.0.1', '::1'],
    proxySecret: '',
    autoLogin: false,
    autoCreateUsers: false,
  },
  showLocalLogin: true,
  ai: {
    enabled: false,
    provider: 'anthropic',
    baseUrl: '',
    apiKey: '',
    model: 'claude-opus-5',
    maxTokens: 2000,
    sendTemperature: false,
    temperature: 0.3,
    actions: ['summarize', 'improve', 'shorten', 'translate', 'tags', 'title', 'outline', 'ask', 'tasks'],
    dailyLimit: 100,
    systemPrompt: '',
  },
  alerts: { email: true, recipients: '', diskMinGb: 2, backupMaxAgeDays: 2 },
  officePreview: { enabled: false, sofficePath: '' },
  ocr: { enabled: false, tesseractPath: '', languages: 'deu+eng', maxPages: 30 },
  exportTemplate: {
    company: '',
    logo: '',
    primaryColor: '#2563eb',
    font: 'Calibri',
    coverPage: true,
    toc: true,
    headerText: '{company} · {title}',
    footerText: '{space} · Stand {date} · {version}',
    classification: '',
    paper: 'A4',
  },
  realtimeCollaboration: true,
  drawioUrl: 'https://embed.diagrams.net',
};

/** Einstellungen, die auch ohne Anmeldung an den Client geliefert werden. */
export const PUBLIC_SETTING_KEYS = [
  'siteName',
  'siteTagline',
  'accentColor',
  'uiMotion',
  'defaultLocale',
  'allowRegistration',
  'anonymousAccess',
  'footerText',
  'passwordMinLength',
  'personalSpaces',
  'maxUploadMb',
  'allowedEmbedHosts',
  'drawioUrl',
  'realtimeCollaboration',
] as const satisfies readonly (keyof Settings)[];

export class SettingsService {
  private readonly db: Db;
  private cache: Settings | null = null;

  constructor(db: Db) {
    this.db = db;
  }

  all(): Settings {
    if (!this.cache) {
      const rows = this.db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
      const stored: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const row of rows) stored[row.key] = parseJson(row.value, undefined);
      const merged = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
      for (const key of Object.keys(DEFAULT_SETTINGS)) {
        if (Object.hasOwn(stored, key) && stored[key] !== undefined) {
          const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
          merged[key] =
            def && typeof def === 'object' && !Array.isArray(def)
              ? { ...(def as object), ...(stored[key] as object) }
              : stored[key];
        }
      }
      this.cache = merged as unknown as Settings;
    }
    return this.cache;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.all()[key];
  }

  /** Übernimmt nur bekannte Schlüssel mit passendem Typ. Gibt die geänderten Schlüssel zurück. */
  update(patch: Partial<Settings>): string[] {
    const current = this.all();
    const changed: string[] = [];
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.hasOwn(DEFAULT_SETTINGS, key) || value === undefined) continue;
        const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
        if (Array.isArray(def) !== Array.isArray(value) || typeof def !== typeof value) continue;
        if (JSON.stringify((current as unknown as Record<string, unknown>)[key]) === JSON.stringify(value)) continue;
        this.db.run(
          'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          key,
          JSON.stringify(value),
        );
        changed.push(key);
      }
    });
    this.cache = null;
    return changed;
  }

  publicSettings(): Pick<Settings, (typeof PUBLIC_SETTING_KEYS)[number]> {
    const all = this.all();
    const out: Record<string, unknown> = {};
    for (const key of PUBLIC_SETTING_KEYS) out[key] = all[key];
    return out as Pick<Settings, (typeof PUBLIC_SETTING_KEYS)[number]>;
  }

  /** Beliebige interne Werte (z. B. Setup-Status), nicht Teil der Settings-Oberfläche. */
  getInternal<T>(key: string, fallback: T): T {
    const row = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', `internal:${key}`);
    return row ? parseJson(row.value, fallback) : fallback;
  }

  setInternal(key: string, value: unknown): void {
    this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      `internal:${key}`,
      JSON.stringify(value),
    );
  }
}

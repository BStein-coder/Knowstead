import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { SignedXml } from 'xml-crypto';
import { Client, createTestApp } from './helpers.ts';
import type { App } from '../src/http.ts';
import { proxyList, safeNext, usernameFrom } from '../src/modules/auth/sso.ts';

/** Browser mit Cookie-Speicher (mehrere Cookies, Löschen per Max-Age=0). */
class Browser {
  private readonly jar = new Map<string, string>();
  private readonly app: App;
  private readonly remoteAddress: string | undefined;

  constructor(app: App, remoteAddress?: string) {
    this.app = app;
    this.remoteAddress = remoteAddress;
  }

  has(name: string): boolean {
    return this.jar.has(name);
  }

  async go(method: 'GET' | 'POST' | 'DELETE', url: string, options: { payload?: string | object; headers?: Record<string, string> } = {}) {
    const res = await this.app.inject({
      method,
      url,
      payload: options.payload,
      headers: { ...(this.jar.size ? { cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...options.headers },
      ...(this.remoteAddress ? { remoteAddress: this.remoteAddress } : {}),
    });
    const setCookie = res.headers['set-cookie'];
    for (const line of Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : []) {
      const pair = line.split(';')[0];
      const name = pair.slice(0, pair.indexOf('='));
      const value = pair.slice(pair.indexOf('=') + 1);
      if (!value || /max-age=0/i.test(line)) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }

  api(method: 'GET' | 'POST' | 'DELETE', url: string, body?: object) {
    return this.go(method, url, { payload: body, headers: { 'x-knowstead-client': 'test' } });
  }
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

/** Minimaler OpenID-Connect-Anbieter mit RS256-signierten ID-Tokens. */
async function fakeOidcProvider(clientId: string, clientSecret: string) {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, { claims: Record<string, unknown>; challenge?: string; nonce?: string }>();
  let issuer = '';
  const tokenRequests: URLSearchParams[] = [];

  const sign = (payload: Record<string, unknown>) => {
    const head = b64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    return `${head}.${body}.${b64url(crypto.sign('sha256', Buffer.from(`${head}.${body}`), privateKey))}`;
  };

  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/.well-known/openid-configuration') {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (req.url === '/jwks') return send(200, { keys: [jwk] });
    // Microsoft Graph (Gruppenüberlauf bei Entra ID)
    if (req.url === '/v1.0/me/getMemberObjects' && req.method === 'POST') {
      return req.headers.authorization === 'Bearer zugriffstoken' ? send(200, { value: ['5f2c0000-0000-0000-0000-000000000001'] }) : send(401, { error: 'unauthorized' });
    }
    if (req.url === '/token' && req.method === 'POST') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        const params = new URLSearchParams(raw);
        tokenRequests.push(params);
        const entry = codes.get(params.get('code') ?? '');
        codes.delete(params.get('code') ?? '');
        if (!entry || params.get('client_id') !== clientId || params.get('client_secret') !== clientSecret) return send(400, { error: 'invalid_grant' });
        const verifier = params.get('code_verifier') ?? '';
        if (entry.challenge && b64url(crypto.createHash('sha256').update(verifier).digest()) !== entry.challenge) return send(400, { error: 'invalid_grant', error_description: 'PKCE' });
        const now = Math.floor(Date.now() / 1000);
        send(200, {
          access_token: 'zugriffstoken',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: sign({ iss: issuer, aud: clientId, iat: now, exp: now + 300, nonce: entry.nonce, ...entry.claims }),
        });
      });
      return;
    }
    send(404, { error: 'not_found' });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    issuer,
    tokenRequests,
    /** Anmeldung beim Anbieter „bestätigen“: Code für die Werte aus der Weiterleitung ausstellen. */
    authorize(location: string, claims: Record<string, unknown>, overrides: { nonce?: string } = {}) {
      const url = new URL(location);
      const code = crypto.randomBytes(12).toString('hex');
      codes.set(code, { claims, challenge: url.searchParams.get('code_challenge') ?? undefined, nonce: overrides.nonce ?? url.searchParams.get('nonce') ?? undefined });
      return { code, state: url.searchParams.get('state') ?? '', url };
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('Single Sign-on: Entra ID/OIDC, SAML und Windows-Anmeldung', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const idp = await fakeOidcProvider('knowstead-app', 'sehr-geheim');
  const groupIds: Record<string, number> = {};

  const oidcLogin = async (browser: Browser, claims: Record<string, unknown>, next = '/s/TEST') => {
    const start = await browser.go('GET', `/api/v1/auth/oidc/start?next=${encodeURIComponent(next)}`);
    assert.equal(start.statusCode, 302, start.body);
    const { code, state } = idp.authorize(String(start.headers.location), claims);
    return browser.go('GET', `/api/v1/auth/oidc/callback?code=${code}&state=${state}`);
  };
  const me = async (browser: Browser) => (await browser.api('GET', '/api/v1/auth/me')).json();
  const groupNames = (user: { groups?: { name: string }[] }) => (user.groups ?? []).map((g) => g.name).filter((n) => n !== 'Benutzer').sort();

  try {
    await t.test('Hilfsfunktionen', () => {
      assert.equal(usernameFrom('FIRMA\\anna.schmidt', true), 'anna.schmidt');
      assert.equal(usernameFrom('anna.schmidt@firma.de', true), 'anna.schmidt');
      assert.equal(usernameFrom('anna.schmidt@firma.de', false), 'anna.schmidt.firma.de');
      assert.equal(usernameFrom('  Jörg Müller ', true), 'J.rg.M.ller');
      assert.equal(safeNext('//evil.example'), '/');
      assert.equal(safeNext('/\\evil.example'), '/');
      assert.equal(safeNext('https://evil.example'), '/');
      assert.equal(safeNext('/s/TEST/p/1'), '/s/TEST/p/1');
      const { list, invalid } = proxyList(['10.0.0.0/8', '::1', '192.168.1.5']);
      assert.equal(invalid, null);
      assert.ok(list.check('10.20.30.40', 'ipv4'));
      assert.ok(!list.check('11.0.0.1', 'ipv4'));
      assert.equal(proxyList(['10.0.0.0/33']).invalid, '10.0.0.0/33');
      assert.equal(proxyList(['kein-host']).invalid, 'kein-host');
    });

    await t.test('Einrichtung und Prüfung der Einstellungen', async () => {
      await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
      groupIds.redaktion = (await admin.post('/api/v1/admin/groups', { name: 'Redaktion', directoryGroups: ['grp-redaktion', '5f2c0000-0000-0000-0000-000000000001'], syncEnabled: true })).body.id;
      groupIds.leitung = (await admin.post('/api/v1/admin/groups', { name: 'Leitung', directoryGroups: ['grp-leitung'], syncEnabled: true })).body.id;
      await admin.post('/api/v1/admin/users', { username: 'bernd', displayName: 'Bernd', password: 'geheim-geheim' });

      // Mandantenlose Entra-Anmeldung („common“) ist nicht erlaubt
      const common = await admin.put('/api/v1/admin/settings', { oidc: { enabled: true, provider: 'entra', tenantId: 'common', clientId: 'x' } });
      assert.equal(common.status, 400);
      assert.match(common.body.error.message, /GUID/);
      assert.equal((await admin.put('/api/v1/admin/settings', { oidc: { issuer: 'http://sso.example.com' } })).status, 400, 'nur https');
      assert.equal((await admin.put('/api/v1/admin/settings', { oidc: { groupsClaim: 'groups <script>' } })).status, 400);
      assert.equal((await admin.put('/api/v1/admin/settings', { kerberos: { enabled: true, header: 'Cookie' } })).status, 400);
      assert.equal((await admin.put('/api/v1/admin/settings', { kerberos: { trustedProxies: ['irgendwas'] } })).status, 400);
      assert.equal((await admin.put('/api/v1/admin/settings', { saml: { idpCert: '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----' } })).status, 400);

      const saved = await admin.put('/api/v1/admin/settings', {
        oidc: { enabled: true, provider: 'generic', issuer: idp.issuer, clientId: 'knowstead-app', clientSecret: 'sehr-geheim', scopes: 'profile email', groupsClaim: 'groups roles' },
      });
      assert.equal(saved.status, 200, saved.raw);
      assert.equal(saved.body.oidc.clientSecret, '••••••••', 'Geheimnis maskiert');
      assert.equal(saved.body.oidc.scopes, 'openid profile email', 'openid ergänzt');
      const stored = ctx.s.settings.get('oidc').clientSecret;
      assert.ok(stored && !stored.includes('sehr-geheim'), 'verschlüsselt gespeichert');
      // Maskierter Wert beim erneuten Speichern ändert das Geheimnis nicht
      await admin.put('/api/v1/admin/settings', { oidc: { ...saved.body.oidc } });
      assert.equal(ctx.s.settings.get('oidc').clientSecret, stored);

      const test = await admin.post('/api/v1/admin/sso/oidc/test');
      assert.equal(test.body.ok, true, JSON.stringify(test.body));
      const info = await admin.get('/api/v1/admin/sso');
      assert.equal(info.body.redirectUri, 'http://localhost:3999/api/v1/auth/oidc/callback');

      const anonymous = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me' });
      assert.deepEqual(anonymous.json().sso.providers, [{ id: 'oidc', label: 'Mit Microsoft anmelden', kind: 'generic' }]);
      assert.equal(anonymous.json().sso.showLocalLogin, true);

      // Die vorgegebene Beschriftung folgt der Sprache der Anfrage – auch wenn sie aus einer englischen
      // Administration heraus auf Englisch gespeichert wurde. Eine eigene Beschriftung bleibt, wie sie ist.
      const labelFor = async (locale: string) => (await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { 'x-knowstead-locale': locale } })).json().sso.providers[0].label;
      assert.equal(await labelFor('en'), 'Sign in with Microsoft');
      assert.equal((await admin.put('/api/v1/admin/settings', { oidc: { ...saved.body.oidc, label: 'Sign in with Microsoft' } })).status, 200);
      assert.equal(await labelFor('de'), 'Mit Microsoft anmelden');
      assert.equal(await labelFor('en'), 'Sign in with Microsoft');
      assert.equal((await admin.put('/api/v1/admin/settings', { oidc: { ...saved.body.oidc, label: 'Firmenanmeldung' } })).status, 200);
      assert.equal(await labelFor('en'), 'Firmenanmeldung');
      assert.equal((await admin.put('/api/v1/admin/settings', { oidc: { ...saved.body.oidc } })).status, 200);
      assert.equal(await labelFor('de'), 'Mit Microsoft anmelden');
      assert.equal(ctx.s.settings.get('oidc').clientSecret, stored, 'das Geheimnis blieb dabei unverändert');
    });

    await t.test('OIDC: Weiterleitung mit PKCE, state und nonce', async () => {
      const browser = new Browser(ctx.app);
      const start = await browser.go('GET', '/api/v1/auth/oidc/start?next=/s/TEST');
      assert.equal(start.statusCode, 302);
      const url = new URL(String(start.headers.location));
      assert.equal(url.origin + url.pathname, `${idp.issuer}/authorize`);
      assert.equal(url.searchParams.get('client_id'), 'knowstead-app');
      assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3999/api/v1/auth/oidc/callback');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      assert.ok((url.searchParams.get('state') ?? '').length >= 32);
      assert.ok((url.searchParams.get('nonce') ?? '').length >= 32);
      assert.ok(browser.has('knowstead_sso'), 'Vorgangs-Cookie gesetzt');
      const cookie = String(start.headers['set-cookie']);
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Lax/i);
      assert.match(cookie, /Path=\/api\/v1\/auth/);
    });

    await t.test('OIDC: Konto anlegen, Gruppen zuordnen, Ziel öffnen', async () => {
      const browser = new Browser(ctx.app);
      const res = await oidcLogin(browser, { sub: 'anna-1', preferred_username: 'anna.schmidt@firma.de', name: 'Anna Schmidt', email: 'anna@firma.de', groups: ['grp-redaktion'], roles: ['GRP-LEITUNG'] });
      assert.equal(res.statusCode, 302, res.body);
      assert.equal(res.headers.location, '/s/TEST');
      assert.ok(browser.has('knowstead_session'));
      assert.ok(!browser.has('knowstead_sso'), 'Vorgang verbraucht');
      const user = (await me(browser)).user;
      assert.equal(user.username, 'anna.schmidt');
      assert.equal(user.displayName, 'Anna Schmidt');
      assert.equal(user.email, 'anna@firma.de');
      assert.equal(user.hasPassword, false);
      assert.deepEqual(groupNames(user), ['Leitung', 'Redaktion'], 'Gruppen und Rollen, ohne Groß-/Kleinschreibung');
      assert.equal(idp.tokenRequests.at(-1)?.get('redirect_uri'), 'http://localhost:3999/api/v1/auth/oidc/callback');

      const identities = await browser.api('GET', '/api/v1/me/identities');
      assert.equal(identities.json().items.length, 1);
      assert.equal(identities.json().items[0].label, 'anna.schmidt@firma.de');
      const events = ctx.s.db.all<{ type: string; data: string }>("SELECT type, data FROM events WHERE type IN ('auth.login', 'user.created') ORDER BY id DESC LIMIT 2");
      assert.ok(events.some((e) => e.type === 'auth.login' && e.data.includes('oidc')));
    });

    await t.test('OIDC: erneute Anmeldung gleicht Gruppen ab – fehlender Claim entzieht', async () => {
      let browser = new Browser(ctx.app);
      await oidcLogin(browser, { sub: 'anna-1', preferred_username: 'anna.schmidt@firma.de', name: 'Anna S.', groups: ['grp-redaktion'] });
      let user = (await me(browser)).user;
      assert.deepEqual(groupNames(user), ['Redaktion']);
      assert.equal(user.displayName, 'Anna S.');
      assert.equal(user.email, 'anna@firma.de', 'E-Mail bleibt, wenn der Claim fehlt');
      browser = new Browser(ctx.app);
      await oidcLogin(browser, { sub: 'anna-1', preferred_username: 'anna.schmidt@firma.de' });
      user = (await me(browser)).user;
      assert.deepEqual(groupNames(user), []);
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM users WHERE username LIKE ?', 'anna%'), 1, 'kein zweites Konto');
    });

    await t.test('OIDC: Vorgänge sind an den Browser gebunden und einmalig', async () => {
      // Login-CSRF: Code und state einer fremden Anmeldung im Browser des Opfers
      const attacker = new Browser(ctx.app);
      const start = await attacker.go('GET', '/api/v1/auth/oidc/start');
      const { code, state } = idp.authorize(String(start.headers.location), { sub: 'angreifer', preferred_username: 'mallory' });
      const victim = new Browser(ctx.app);
      const planted = await victim.go('GET', `/api/v1/auth/oidc/callback?code=${code}&state=${state}`);
      assert.equal(planted.headers.location, '/login?sso_error=flow');
      assert.ok(!victim.has('knowstead_session'));

      // Falscher state
      const b1 = new Browser(ctx.app);
      const s1 = await b1.go('GET', '/api/v1/auth/oidc/start');
      const a1 = idp.authorize(String(s1.headers.location), { sub: 'anna-1', preferred_username: 'anna.schmidt' });
      const wrongState = await b1.go('GET', `/api/v1/auth/oidc/callback?code=${a1.code}&state=manipuliert`);
      assert.equal(wrongState.headers.location, '/login?sso_error=provider');
      // Wiederholung mit dem richtigen state: Vorgang ist verbraucht
      const replay = await b1.go('GET', `/api/v1/auth/oidc/callback?code=${a1.code}&state=${a1.state}`);
      assert.equal(replay.headers.location, '/login?sso_error=flow');

      // Falsche nonce im ID-Token
      const b2 = new Browser(ctx.app);
      const s2 = await b2.go('GET', '/api/v1/auth/oidc/start');
      const a2 = idp.authorize(String(s2.headers.location), { sub: 'anna-1', preferred_username: 'anna.schmidt' }, { nonce: 'fremd' });
      const wrongNonce = await b2.go('GET', `/api/v1/auth/oidc/callback?code=${a2.code}&state=${a2.state}`);
      assert.equal(wrongNonce.headers.location, '/login?sso_error=provider');
      assert.ok(!b2.has('knowstead_session'));

      // Fehler vom Anbieter
      const b3 = new Browser(ctx.app);
      await b3.go('GET', '/api/v1/auth/oidc/start');
      const denied = await b3.go('GET', '/api/v1/auth/oidc/callback?error=access_denied&error_description=Nope');
      assert.equal(denied.headers.location, '/login?sso_error=provider');

      // Offene Weiterleitung über next
      const b4 = new Browser(ctx.app);
      const evil = await oidcLogin(b4, { sub: 'anna-1', preferred_username: 'anna.schmidt' }, '//evil.example/');
      assert.equal(evil.headers.location, '/');
    });

    await t.test('OIDC: vorhandene Konten, Administratoren, Pflichtgruppe, gesperrte Konten', async () => {
      const bernd = await oidcLogin(new Browser(ctx.app), { sub: 'bernd-1', preferred_username: 'bernd@firma.de' });
      assert.equal(bernd.headers.location, '/login?sso_error=account_exists', 'ohne Übernahme kein Zugriff auf fremdes Konto');

      await admin.put('/api/v1/admin/settings', { oidc: { adoptExistingUsers: true } });
      const adminTakeover = await oidcLogin(new Browser(ctx.app), { sub: 'boese', preferred_username: 'admin@firma.de' });
      assert.equal(adminTakeover.headers.location, '/login?sso_error=admin_link');
      const failed = ctx.s.db.value<string>("SELECT data FROM events WHERE type = 'auth.login_failed' ORDER BY id DESC LIMIT 1");
      assert.match(String(failed), /sso_admin_link/);

      const browser = new Browser(ctx.app);
      const adopted = await oidcLogin(browser, { sub: 'bernd-1', preferred_username: 'bernd@firma.de', groups: [] });
      assert.equal(adopted.statusCode, 302);
      assert.equal((await me(browser)).user.username, 'bernd');
      const row = ctx.s.users.byUsername('bernd')!;
      assert.equal(row.auth_source, 'oidc');
      assert.equal(row.password_hash, null, 'lokales Passwort entfällt');
      assert.equal((await new Client(ctx.app).post('/api/v1/auth/login', { login: 'bernd', password: 'geheim-geheim' })).status, 401);
      // Zweite Person gleichen Namens bei demselben Anbieter wird nicht auf das Konto gelegt
      const other = await oidcLogin(new Browser(ctx.app), { sub: 'bernd-2', preferred_username: 'bernd@tochter.de' });
      assert.equal(other.headers.location, '/login?sso_error=conflict');

      // Passwort-Reset ist für SSO-Konten gesperrt
      const token = ctx.s.auth.createResetToken(row.id);
      const reset = await new Client(ctx.app).post('/api/v1/auth/reset', { token, password: 'neues-passwort-123' });
      assert.equal(reset.status, 400);

      await admin.put('/api/v1/admin/settings', { oidc: { requireGroup: 'grp-leitung' } });
      assert.equal((await oidcLogin(new Browser(ctx.app), { sub: 'anna-1', preferred_username: 'anna.schmidt', groups: ['grp-redaktion'] })).headers.location, '/login?sso_error=group');
      assert.equal((await oidcLogin(new Browser(ctx.app), { sub: 'anna-1', preferred_username: 'anna.schmidt', roles: 'grp-leitung' })).statusCode, 302);
      await admin.put('/api/v1/admin/settings', { oidc: { requireGroup: '' } });

      const anna = ctx.s.users.byUsername('anna.schmidt')!;
      const dis = await admin.post(`/api/v1/admin/users/${anna.id}/status`, { status: 'disabled' });
      assert.equal(dis.status, 200, dis.raw);
      const disabled = await oidcLogin(new Browser(ctx.app), { sub: 'anna-1', preferred_username: 'anna.schmidt' });
      assert.equal(disabled.headers.location, '/login?sso_error=disabled');
      await admin.post(`/api/v1/admin/users/${anna.id}/status`, { status: 'active' });

      await admin.put('/api/v1/admin/settings', { oidc: { autoCreateUsers: false } });
      assert.equal((await oidcLogin(new Browser(ctx.app), { sub: 'neu-1', preferred_username: 'neu' })).headers.location, '/login?sso_error=no_account');
      await admin.put('/api/v1/admin/settings', { oidc: { autoCreateUsers: true, adoptExistingUsers: false } });
    });

    await t.test('Entra ID: oid als Kennung, Gruppenüberlauf über Microsoft Graph', async () => {
      const sso = ctx.s.sso as unknown as {
        graphUrl: string;
        identityFromClaims: (o: unknown, claims: Record<string, unknown>, token?: string) => Promise<{ subject: string; username: string; groups: string[] | null }>;
      };
      sso.graphUrl = idp.issuer;
      const entra = { ...ctx.s.settings.get('oidc'), provider: 'entra', syncGroups: true, groupsClaim: 'groups' };
      const claims = { iss: 'https://login.microsoftonline.com/x/v2.0', sub: 'app-spezifisch', oid: 'objekt-id', preferred_username: 'eva@firma.de' };
      const overage = await sso.identityFromClaims(entra, { ...claims, _claim_names: { groups: 'src1' } }, 'zugriffstoken');
      assert.equal(overage.subject, 'objekt-id');
      assert.equal(overage.username, 'eva');
      assert.deepEqual(overage.groups, ['5f2c0000-0000-0000-0000-000000000001']);
      // Graph verweigert: Gruppen unbekannt – kein Abgleich statt Entzug
      assert.equal((await sso.identityFromClaims(entra, { ...claims, _claim_names: { groups: 'src1' } }, 'falsch')).groups, null);
      assert.deepEqual((await sso.identityFromClaims(entra, claims)).groups, []);
      const generic = await sso.identityFromClaims({ ...entra, provider: 'generic' }, claims);
      assert.equal(generic.subject, 'app-spezifisch');
    });

    await t.test('Profil: eigenes Konto verknüpfen und trennen', async () => {
      const browser = new Browser(ctx.app);
      await browser.api('POST', '/api/v1/auth/login', { login: 'admin', password: 'geheim-geheim' });
      // Verknüpfen nur per API-Aufruf mit CSRF-Kopfzeile, nicht per Link
      assert.equal((await browser.go('POST', '/api/v1/me/identities/oidc/link')).statusCode, 403);
      const link = await browser.api('POST', '/api/v1/me/identities/oidc/link');
      assert.equal(link.statusCode, 200, link.body);
      const url = new URL(link.json().url);
      assert.equal(url.searchParams.get('prompt'), 'select_account');
      const { code, state } = idp.authorize(url.href, { sub: 'ada-entra', preferred_username: 'ada@firma.de', groups: ['grp-redaktion'] });
      const done = await browser.go('GET', `/api/v1/auth/oidc/callback?code=${code}&state=${state}`);
      assert.equal(done.headers.location, '/profile/sign-in?linked=1');
      const items = (await browser.api('GET', '/api/v1/me/identities')).json().items;
      assert.equal(items.length, 1);

      // Jetzt meldet sich die Administratorin über den Anbieter an
      const sso = new Browser(ctx.app);
      await oidcLogin(sso, { sub: 'ada-entra', preferred_username: 'ada@firma.de', groups: ['grp-redaktion'] });
      const user = (await me(sso)).user;
      assert.equal(user.username, 'admin');
      assert.equal(user.isAdmin, true);
      assert.equal(ctx.s.users.byUsername('admin')!.auth_source, 'local', 'verknüpfte Konten behalten ihr Passwort');

      // Bereits vergebene Identität lässt sich nicht an ein zweites Konto hängen
      const anna = new Browser(ctx.app);
      await oidcLogin(anna, { sub: 'anna-1', preferred_username: 'anna.schmidt' });
      const steal = await anna.api('POST', '/api/v1/me/identities/oidc/link');
      const a = idp.authorize(steal.json().url, { sub: 'ada-entra', preferred_username: 'ada@firma.de' });
      assert.equal((await anna.go('GET', `/api/v1/auth/oidc/callback?code=${a.code}&state=${a.state}`)).headers.location, '/profile/sign-in?sso_error=identity_taken');

      // Letzte Anmeldemöglichkeit bleibt
      const annaItems = (await anna.api('GET', '/api/v1/me/identities')).json().items;
      const last = await anna.api('DELETE', `/api/v1/me/identities/${annaItems[0].id}`);
      assert.equal(last.statusCode, 400);
      assert.equal(last.json().error.code, 'last_sign_in');
      const unlink = await browser.api('DELETE', `/api/v1/me/identities/${items[0].id}`);
      assert.equal(unlink.statusCode, 200);
      // Fremde Verknüpfungen nur mit Benutzerverwaltung
      assert.equal((await anna.api('DELETE', `/api/v1/admin/users/1/identities/${annaItems[0].id}`)).statusCode, 403);
      const adminView = await admin.get(`/api/v1/admin/users/${ctx.s.users.byUsername('anna.schmidt')!.id}/identities`);
      assert.equal(adminView.body.items.length, 1);
    });

    await t.test('SAML: signierte Antwort, Gruppen, Wiederholung und Fälschung', async () => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      const keyPem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
      const publicPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
      const saved = await admin.put('/api/v1/admin/settings', {
        saml: { enabled: true, entryPoint: 'https://idp.example.test/sso', idpEntityId: 'https://idp.example.test', idpCert: publicPem, usernameAttribute: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name' },
      });
      assert.equal(saved.status, 200, saved.raw);
      const metadata = await ctx.app.inject({ method: 'GET', url: '/api/v1/auth/saml/metadata' });
      assert.equal(metadata.statusCode, 200);
      assert.match(metadata.body, /entityID="http:\/\/localhost:3999\/api\/v1\/auth\/saml\/metadata"/);
      assert.match(metadata.body, /Location="http:\/\/localhost:3999\/api\/v1\/auth\/saml\/acs"/);
      assert.equal((await admin.post('/api/v1/admin/sso/saml/test')).body.ok, true);

      const acs = 'http://localhost:3999/api/v1/auth/saml/acs';
      const audience = 'http://localhost:3999/api/v1/auth/saml/metadata';
      const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
      const response = (requestId: string, options: { audience?: string; issuer?: string; nameId?: string; groups?: string[]; sign?: boolean } = {}) => {
        const assertionId = `_a${crypto.randomBytes(8).toString('hex')}`;
        const issuer = options.issuer ?? 'https://idp.example.test';
        const groups = (options.groups ?? ['grp-redaktion', 'grp-leitung']).map((g) => `<saml:AttributeValue>${g}</saml:AttributeValue>`).join('');
        const xml =
          `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${crypto.randomBytes(8).toString('hex')}" Version="2.0" IssueInstant="${iso(0)}" Destination="${acs}" InResponseTo="${requestId}">` +
          `<saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
          `<saml:Assertion ID="${assertionId}" Version="2.0" IssueInstant="${iso(0)}"><saml:Issuer>${issuer}</saml:Issuer>` +
          `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:2.0:nameid-format:persistent">${options.nameId ?? 'carla-persistent'}</saml:NameID>` +
          `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${requestId}" NotOnOrAfter="${iso(300_000)}" Recipient="${acs}"/></saml:SubjectConfirmation></saml:Subject>` +
          `<saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(300_000)}"><saml:AudienceRestriction><saml:Audience>${options.audience ?? audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
          `<saml:AuthnStatement AuthnInstant="${iso(0)}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
          `<saml:AttributeStatement>` +
          `<saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"><saml:AttributeValue>carla@firma.de</saml:AttributeValue></saml:Attribute>` +
          `<saml:Attribute Name="http://schemas.microsoft.com/identity/claims/displayname"><saml:AttributeValue>Carla Clausen</saml:AttributeValue></saml:Attribute>` +
          `<saml:Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><saml:AttributeValue>carla@firma.de</saml:AttributeValue></saml:Attribute>` +
          `<saml:Attribute Name="http://schemas.microsoft.com/ws/2008/06/identity/claims/groups">${groups}</saml:Attribute>` +
          `</saml:AttributeStatement></saml:Assertion></samlp:Response>`;
        if (options.sign === false) return Buffer.from(xml).toString('base64');
        const sig = new SignedXml({
          privateKey: keyPem,
          signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
          canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
        });
        sig.addReference({
          xpath: "//*[local-name(.)='Assertion']",
          transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/2001/10/xml-exc-c14n#'],
          digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
        });
        sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' } });
        return Buffer.from(sig.getSignedXml()).toString('base64');
      };
      const startSaml = async (browser: Browser, next = '/') => {
        const start = await browser.go('GET', `/api/v1/auth/saml/start?next=${encodeURIComponent(next)}`);
        assert.equal(start.statusCode, 302, start.body);
        const url = new URL(String(start.headers.location));
        assert.equal(url.origin + url.pathname, 'https://idp.example.test/sso');
        const request = zlib.inflateRawSync(Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64')).toString();
        return /ID="([^"]+)"/.exec(request)![1];
      };
      // Der Anbieter postet ohne Cookies und ohne CSRF-Kopfzeile
      const post = (samlResponse: string) =>
        ctx.app.inject({ method: 'POST', url: '/api/v1/auth/saml/acs', payload: new URLSearchParams({ SAMLResponse: samlResponse, RelayState: '' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });

      const browser = new Browser(ctx.app);
      const requestId = await startSaml(browser, '/s/TEST');
      const signed = response(requestId);
      const accepted = await post(signed);
      assert.equal(accepted.statusCode, 303, accepted.body);
      assert.equal(accepted.headers.location, '/api/v1/auth/saml/finish');
      assert.equal((await post(signed)).headers.location, '/login?sso_error=provider', 'Wiederholung abgelehnt');
      const finish = await browser.go('GET', '/api/v1/auth/saml/finish');
      assert.equal(finish.headers.location, '/s/TEST');
      const user = (await me(browser)).user;
      assert.equal(user.username, 'carla');
      assert.equal(user.displayName, 'Carla Clausen');
      assert.deepEqual(groupNames(user), ['Leitung', 'Redaktion']);

      // Unsigniert, falsche Zielgruppe, fremder Aussteller, erfundene Anfrage
      const b2 = new Browser(ctx.app);
      const r2 = await startSaml(b2);
      assert.equal((await post(response(r2, { sign: false }))).headers.location, '/login?sso_error=provider');
      assert.equal((await post(response(r2, { audience: 'https://andere-app.example' }))).headers.location, '/login?sso_error=provider');
      assert.equal((await post(response(r2, { issuer: 'https://fremder-idp.example' }))).headers.location, '/login?sso_error=provider');
      assert.equal((await post(response('_erfunden'))).headers.location, '/login?sso_error=provider', 'vom Anbieter angestoßen');
      assert.equal((await b2.go('GET', '/api/v1/auth/saml/finish')).headers.location, '/login?sso_error=flow');
      // Manipulierte Gruppen nach dem Signieren
      const b3 = new Browser(ctx.app);
      const r3 = await startSaml(b3);
      const tampered = Buffer.from(Buffer.from(response(r3, { groups: ['grp-redaktion'] }), 'base64').toString().replace('grp-redaktion', 'grp-leitung')).toString('base64');
      assert.equal((await post(tampered)).headers.location, '/login?sso_error=provider');

      // Fremder Browser kann eine gültige Antwort nicht abschließen (Login-CSRF)
      const attacker = new Browser(ctx.app);
      const r4 = await startSaml(attacker);
      await post(response(r4, { nameId: 'angreifer', groups: [] }));
      const victim = new Browser(ctx.app);
      assert.equal((await victim.go('GET', '/api/v1/auth/saml/finish')).headers.location, '/login?sso_error=flow');
      assert.ok(!victim.has('knowstead_session'));
    });

    await t.test('CSRF-Ausnahme gilt nur für den Assertion Consumer Service', async () => {
      const post = (url: string) => ctx.app.inject({ method: 'POST', url, payload: 'SAMLResponse=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      assert.equal((await post('/api/v1/auth/saml/acs')).statusCode, 303);
      assert.equal((await post('/api/v1/auth/saml/acs/')).statusCode, 403);
      assert.equal((await post('/api/v1/auth/saml/acs2')).statusCode, 403);
      assert.equal((await post('/api/v1/auth/login')).statusCode, 403);
      // Formulardaten werden nur dort angenommen
      const other = await ctx.app.inject({ method: 'POST', url: '/api/v1/pages', payload: 'title=x', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-knowstead-client': 'test' } });
      assert.equal(other.statusCode, 415);
    });

    await t.test('Windows-Anmeldung über vorgeschalteten Webserver', async () => {
      await admin.put('/api/v1/admin/settings', { kerberos: { enabled: true, trustedProxies: ['10.1.2.3'], proxySecret: 'proxy-geheimnis', autoCreateUsers: true } });
      assert.equal((await admin.get('/api/v1/admin/settings')).body.kerberos.proxySecret, '••••••••');
      const headers = { 'x-remote-user': 'FIRMA\\dieter', 'x-knowstead-proxy-secret': 'proxy-geheimnis' };

      // Direkt aus dem Netz (am Webserver vorbei) – auch mit gefälschter Kopfzeile
      const direct = await new Browser(ctx.app, '203.0.113.9').go('GET', '/api/v1/auth/kerberos', { headers: { ...headers, 'x-forwarded-for': '10.1.2.3' } });
      assert.equal(direct.headers.location, '/login?sso_error=proxy');
      const noSecret = await new Browser(ctx.app, '10.1.2.3').go('GET', '/api/v1/auth/kerberos', { headers: { 'x-remote-user': 'FIRMA\\dieter' } });
      assert.equal(noSecret.headers.location, '/login?sso_error=proxy');
      const noUser = await new Browser(ctx.app, '10.1.2.3').go('GET', '/api/v1/auth/kerberos', { headers: { 'x-knowstead-proxy-secret': 'proxy-geheimnis' } });
      assert.equal(noUser.headers.location, '/login?sso_error=no_user');

      const browser = new Browser(ctx.app, '10.1.2.3');
      const ok = await browser.go('GET', '/api/v1/auth/kerberos?next=/s/TEST', { headers });
      assert.equal(ok.headers.location, '/s/TEST');
      assert.equal((await me(browser)).user.username, 'dieter');
      const again = new Browser(ctx.app, '::ffff:10.1.2.3');
      await again.go('GET', '/api/v1/auth/kerberos', { headers: { ...headers, 'x-remote-user': 'dieter@FIRMA.LOCAL' } });
      assert.equal((await me(again)).user.username, 'dieter', 'IPv4-gemappte Adresse und andere Schreibweise');

      const admins = new Browser(ctx.app, '10.1.2.3');
      assert.equal((await admins.go('GET', '/api/v1/auth/kerberos', { headers: { ...headers, 'x-remote-user': 'FIRMA\\admin' } })).headers.location, '/login?sso_error=admin_link');
    });
  } finally {
    await idp.close();
    await ctx.close();
  }
});

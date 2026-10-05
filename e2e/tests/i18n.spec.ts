import { test, expect, ready, expectAccessible } from './support/fixtures';
import { AUTH, unique } from './support/data';

test.describe('Single Sign-on und Englisch', () => {
  test('Anmeldeseite zeigt SSO-Fehler verständlich – deutsch und englisch', async ({ page }) => {
    await page.goto('/login?sso_error=group');
    await ready(page);
    await expect(page.getByRole('alert')).toContainText('Für die Anmeldung fehlt die erforderliche Gruppenmitgliedschaft.');
    // Unbekannte Kennungen werden nie als Text aus der URL übernommen
    await page.goto('/login?sso_error=%3Cb%3EBitte%20anrufen%3C%2Fb%3E');
    await ready(page);
    await expect(page.getByRole('alert')).toContainText('Der Identitätsanbieter hat die Anmeldung nicht bestätigt.');
    await expect(page.getByRole('alert')).not.toContainText('anrufen');

    await page.evaluate(() => localStorage.setItem('knowstead.locale', 'en'));
    await page.goto('/login?sso_error=disabled');
    await ready(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Log in to');
    await expect(page.getByRole('alert')).toContainText('This account is disabled.');
    await expectAccessible(page);

    // Serverfehler kommen ebenfalls auf Englisch
    await page.getByLabel('Username or email').fill('niemand');
    await page.getByLabel('Password', { exact: true }).fill('falsch-falsch');
    await page.getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page.getByRole('alert').last()).toContainText('Username or password is incorrect');
  });

  test.describe('als Administratorin', () => {
    test.use({ storageState: AUTH.admin });

    test('Single-Sign-on-Seite und Profil „Anmeldung“', async ({ page }) => {
      await page.goto('/admin/sso');
      await ready(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Single Sign-on' })).toBeVisible();
      await expect(page.getByText('/api/v1/auth/oidc/callback')).toBeVisible();
      await expect(page.getByText('/api/v1/auth/saml/metadata').first()).toBeVisible();
      await expectAccessible(page);

      // Ungültige Mandanten-ID wird abgelehnt
      await page.getByLabel('Verzeichnis-ID (Mandanten-ID)').fill('common');
      await page.getByRole('button', { name: 'Speichern' }).first().click();
      await expect(page.getByText(/als GUID angeben/)).toBeVisible();

      await page.goto('/profile/sign-in');
      await ready(page);
      await expect(page.getByText('Noch keine Konten verknüpft')).toBeVisible();
      await expectAccessible(page);
    });

    test('Oberfläche auf Englisch umschalten: Administration und Kataloge', async ({ page }) => {
      await page.goto('/admin/groups');
      await ready(page);
      await page.evaluate(() => localStorage.setItem('knowstead.locale', 'en'));
      // Die Sprache folgt der gespeicherten Profileinstellung – für diesen Test nur im Browser umschalten
      await page.route('**/api/v1/auth/me', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        if (body.user) body.user.preferences = { ...body.user.preferences, locale: 'en' };
        await route.fulfill({ response, json: body });
      });
      await page.reload();
      await ready(page);
      await expect(page.getByRole('button', { name: 'Create group' })).toBeVisible();
      await page.getByRole('button', { name: 'Create group' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog.getByText('System administration')).toBeVisible();
      await expect(dialog.getByText('Directory and SSO groups')).toBeVisible();
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      await page.goto('/admin/audit');
      await ready(page);
      await expect(page.getByRole('combobox', { name: 'Category' })).toBeVisible();
      await expect(page.locator('main')).not.toContainText('Alle Kategorien');

      await page.goto('/admin/mail');
      await ready(page);
      await expect(page.getByRole('heading', { level: 1, name: 'Email' })).toBeVisible();
      await expect(page.locator('main')).not.toContainText('Versandprotokoll');
    });

    test('Englische Oberfläche: Datum auf Aufgabenkarten, Wochenkürzel der Zeitachse, mitgelieferte Vorgaben in Feldern', async ({ page, seed }) => {
      const title = unique('Sprachprobe');
      const created = await page.request.post(`/api/v1/boards/${seed.boardId}/tasks`, {
        headers: { 'x-knowstead-client': 'e2e' },
        data: { title, startDate: '2026-10-12', dueDate: '2026-10-14' },
      });
      expect(created.ok()).toBeTruthy();
      const card = page.locator('.task-card', { hasText: title });

      // Deutsch: Schreibweise wie bisher
      await page.goto(`/s/${seed.spaceKey}/tasks?board=${seed.boardId}`);
      await ready(page);
      await expect(card).toContainText('14. Okt.');
      await page.goto('/');
      await ready(page);
      await expect(page.locator('.hero-sub')).toHaveText('Dokumentation & Wissen');
      // Dieselben Vorgaben in den Feldern der Administration
      await page.goto('/admin/settings');
      await ready(page);
      await expect(page.getByLabel('Untertitel', { exact: true })).toHaveValue('Dokumentation & Wissen');
      await page.goto('/admin/sso');
      await ready(page);
      const buttonLabels = page.getByLabel('Beschriftung des Anmeldeknopfs');
      await expect(buttonLabels.nth(0)).toHaveValue('Mit Microsoft anmelden');
      await expect(buttonLabels.nth(1)).toHaveValue('Mit Firmenkonto anmelden (SAML)');
      await expect(buttonLabels.nth(2)).toHaveValue('Mit Windows-Konto anmelden');
      await page.goto('/admin/export');
      await ready(page);
      await expect(page.getByLabel('Fußzeile (links)')).toHaveValue('{space} · Stand {date} · {version}');
      await expect(page.locator('.export-preview')).toContainText(/ · Stand \d{2}\.\d{2}\.\d{4} · /);

      // Englisch – nur im Browser umschalten, die Profileinstellung bleibt, wie sie ist
      await page.evaluate(() => localStorage.setItem('knowstead.locale', 'en'));
      await page.route('**/api/v1/auth/me', async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        if (body.user) body.user.preferences = { ...body.user.preferences, locale: 'en' };
        await route.fulfill({ response, json: body });
      });
      await page.reload();
      await ready(page);
      // Die mitgelieferte Fußzeile der Export-Vorlage folgt der Sprache der Oberfläche – im Feld und in der Vorschau
      await expect(page.getByLabel('Footer (left)')).toHaveValue('{space} · Date {date} · {version}');
      await expect(page.locator('.export-preview')).toContainText(/ · Date \d{2}\/\d{2}\/\d{4} · /);
      await expect(page.locator('.export-preview')).not.toContainText(/\bStand\b/);
      // Die mitgelieferten Beschriftungen der Anmeldeknöpfe ebenso
      await page.goto('/admin/sso');
      await ready(page);
      const signInLabels = page.getByLabel('Sign-in button label');
      await expect(signInLabels.nth(0)).toHaveValue('Sign in with Microsoft');
      await expect(signInLabels.nth(1)).toHaveValue('Sign in with company account (SAML)');
      await expect(signInLabels.nth(2)).toHaveValue('Sign in with Windows account');
      // Der mitgelieferte Untertitel ebenso: im Feld der Einstellungen und auf der Startseite
      await page.goto('/admin/settings');
      await ready(page);
      await expect(page.getByLabel('Subtitle', { exact: true })).toHaveValue('Documentation & knowledge');
      await page.goto('/');
      await ready(page);
      await expect(page.locator('.hero-sub')).toHaveText('Documentation & knowledge');

      await page.goto(`/s/${seed.spaceKey}/tasks?board=${seed.boardId}`);
      await ready(page);
      await expect(card).toContainText('14 Oct');
      await expect(card).not.toContainText('Okt');

      // Zeitachse in Wochen: Kalenderwochen heißen „Wk“, nicht „KW“
      await page.evaluate(() => {
        localStorage.setItem('knowstead.tasks.view', 'timeline');
        localStorage.setItem('knowstead.tasks.zoom', 'month');
      });
      await page.reload();
      await ready(page);
      const scale = page.locator('.timeline-days');
      await expect(scale).toContainText(/Wk \d+/);
      await expect(scale).not.toContainText(/KW \d+/);
    });
  });
});

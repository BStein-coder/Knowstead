import { test, expect, ready, expectAccessible } from './support/fixtures';
import { AUTH } from './support/data';

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
  });
});

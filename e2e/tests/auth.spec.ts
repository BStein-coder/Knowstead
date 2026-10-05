import { test, expect, ready } from './support/fixtures';
import { EDITOR, AUTH } from './support/data';

test.describe('Anmeldung', () => {
  test('Falsches Passwort zeigt eine Meldung, richtiges meldet an und leitet zurück', async ({ page, seed }) => {
    const target = `/s/${seed.spaceKey}/p/${seed.richPageId}`;
    await page.goto(target);
    await expect(page).toHaveURL(/\/login\?next=/);

    await page.getByLabel('Benutzername oder E-Mail').fill(EDITOR.username);
    await page.getByLabel('Passwort', { exact: true }).fill('falsches-passwort');
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page.getByRole('alert')).toContainText('Benutzername oder Passwort ist falsch');

    await page.getByLabel('Passwort', { exact: true }).fill(EDITOR.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await expect(page).toHaveURL(new RegExp(`${target}`));
    await expect(page.getByRole('heading', { level: 1, name: 'Makroseite' })).toBeVisible();
  });

  test('Abmelden über das Benutzermenü', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Benutzername oder E-Mail').fill(EDITOR.username);
    await page.getByLabel('Passwort', { exact: true }).fill(EDITOR.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await ready(page);
    await page.getByRole('button', { name: EDITOR.displayName }).click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login\?next=%2Fprofile/);
  });

  test('Passwort vergessen ohne E-Mail-Versand weist auf die Administration hin', async ({ page }) => {
    await page.goto('/forgot-password');
    await expect(page.getByText('Der E-Mail-Versand ist nicht eingerichtet')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Link senden' })).toBeDisabled();
  });

  test('Offene Weiterleitung über ?next= ist nicht möglich', async ({ page }) => {
    await page.goto('/login?next=https://example.com/phishing');
    await page.getByLabel('Benutzername oder E-Mail').fill(EDITOR.username);
    await page.getByLabel('Passwort', { exact: true }).fill(EDITOR.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    await ready(page);
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/?$/);
  });
});

test.describe('Sitzung', () => {
  test.use({ storageState: AUTH.editor });

  test('Verbogene ?next=-Werte enden auf der Startseite, nicht in einem Fehlerbildschirm', async ({ page }) => {
    // Browser lesen „/\host“ wie „//host“ und streichen Tabulatoren und Zeilenumbrüche aus Adressen
    for (const next of ['/\\example.com/x', '/\t/example.com/x', '/\n/example.com/x', '//example.com/x']) {
      await page.goto(`/login?next=${encodeURIComponent(next)}`);
      await ready(page);
      await expect(page, `next=${JSON.stringify(next)}`).toHaveURL(/127\.0\.0\.1:\d+\/?$/);
      await expect(page.getByText('Diese Ansicht konnte nicht angezeigt werden')).toHaveCount(0);
    }
  });

  test('Unbekannte Adresse zeigt die 404-Seite mit Rückweg', async ({ page }) => {
    await page.goto('/gibt-es-wirklich-nicht');
    await expect(page.getByRole('heading', { level: 1, name: 'Seite nicht gefunden' })).toBeVisible();
    await page.getByRole('link', { name: 'Zur Startseite' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/Guten|Hallo/);
  });
});

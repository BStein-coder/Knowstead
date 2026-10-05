import { test, expect, ready } from './support/fixtures';
import { AUTH, VIEWER, unique } from './support/data';

test.use({ storageState: AUTH.viewer });

test.describe('Profil', () => {
  test('Anzeigenamen ändern; E-Mail-Wechsel verlangt das Passwort', async ({ page }) => {
    await page.goto('/profile');
    await ready(page);
    const bio = unique('Über mich');
    await page.getByLabel('Über mich').fill(bio);
    const bioSaved = page.waitForResponse((res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Speichern' }).click();
    expect((await bioSaved).status()).toBe(200);
    await expect(page.getByText('Änderungen gespeichert').first()).toBeVisible();

    const email = `vera.${Date.now().toString(36)}@example.com`;
    await page.getByLabel('E-Mail').fill(email);
    const password = page.getByLabel('Aktuelles Passwort');
    await expect(password).toBeVisible();
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('mit deinem aktuellen Passwort')).toBeVisible();
    await password.fill(VIEWER.password);
    const saved = page.waitForResponse((res) => res.url().endsWith('/api/v1/me') && res.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Speichern' }).click();
    expect((await saved).status()).toBe(200);
    await page.reload();
    await expect(page.getByLabel('E-Mail')).toHaveValue(email);
  });

  test('Sitzungen und Einstellungen', async ({ page }) => {
    await page.goto('/profile/sessions');
    await expect(page.getByText('Diese Sitzung').or(page.getByText('aktuell')).first()).toBeVisible();
    await page.goto('/profile/preferences');
    await expect(page.getByLabel('Darstellung')).toBeVisible();
  });
});

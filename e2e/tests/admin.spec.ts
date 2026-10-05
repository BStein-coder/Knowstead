import { test, expect, ready, expectAccessible } from './support/fixtures';
import { AUTH, unique } from './support/data';

test.use({ storageState: AUTH.admin });

test.describe('Bereiche', () => {
  test('Bereich anlegen, Einstellungen speichern, Berechtigung vergeben', async ({ page }) => {
    const name = unique('Projektraum');
    const key = `P${Date.now().toString(36).toUpperCase().slice(-5)}`;
    await page.goto('/spaces');
    await ready(page);
    await page.getByRole('button', { name: 'Erstellen', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Neuer Bereich' }).click();
    const dialog = page.getByRole('dialog', { name: 'Neuen Bereich erstellen' });
    await expectAccessible(page, '[role="dialog"]');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel('Schlüssel').fill(key);
    await dialog.getByRole('button', { name: 'Bereich erstellen' }).click();
    await expect(page).toHaveURL(new RegExp(`/s/${key}`));
    await expect(page.locator('.sidebar').getByText(name)).toBeVisible();

    await page.goto(`/s/${key}/settings`);
    await page.getByLabel('Beschreibung').fill('Beschreibung aus dem Oberflächentest');
    await page.getByRole('button', { name: 'Speichern' }).first().click();
    await expect(page.getByText('Änderungen gespeichert').first()).toBeVisible();

    await page.goto(`/s/${key}/settings/permissions`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel('Rolle').first()).toBeVisible();
  });
});

test.describe('Administration', () => {
  test('Benutzer anlegen und in der Liste finden', async ({ page }) => {
    const username = `nutzer${Date.now().toString(36)}`;
    await page.goto('/admin/users');
    await page.getByRole('button', { name: 'Benutzer anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Benutzer anlegen' });
    await expectAccessible(page, '[role="dialog"]');
    await dialog.getByLabel('Anzeigename').fill('Neue Person');
    await dialog.getByLabel('Benutzername').fill(username);
    await dialog.getByLabel('E-Mail').fill(`${username}@example.com`);
    await dialog.getByRole('button', { name: 'Erstellen' }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByPlaceholder('Name, Benutzername oder E-Mail …').fill(username);
    await expect(page.getByRole('row').filter({ hasText: username })).toBeVisible();
  });

  test('Gruppe anlegen', async ({ page }) => {
    const name = unique('Redaktion');
    await page.goto('/admin/groups');
    await page.getByRole('button', { name: 'Gruppe anlegen' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText(name)).toBeVisible();
  });

  test('Einstellung ändern und speichern', async ({ page }) => {
    await page.goto('/admin/settings');
    const footer = page.getByLabel('Fußzeile / Hinweistext');
    const text = unique('Hinweis');
    await footer.fill(text);
    await page.getByRole('button', { name: 'Speichern' }).first().click();
    await expect(page.getByText('Änderungen gespeichert').first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Fußzeile / Hinweistext')).toHaveValue(text);
  });

  test('Sicherung anlegen und Wartungsaufgabe ausführen', async ({ page }) => {
    await page.goto('/admin/backups');
    const rows = page.locator('tbody tr');
    const before = await rows.count();
    await page.getByRole('button', { name: 'Jetzt sichern' }).click();
    await expect(rows).toHaveCount(before + 1, { timeout: 30_000 });
    await expect(page.getByText('npm run cli -- restore')).toBeVisible();

    await page.goto('/admin/maintenance');
    const card = page.locator('.card').filter({ hasText: 'Suchindex neu aufbauen' });
    await card.getByRole('button').click();
    await expect(page.getByText(/Suchindex neu aufbauen: pages=\d+/)).toBeVisible();
  });

  test('Nächste Schritte: Stand anzeigen, Sicherung erledigen, Hinweis in der Übersicht aus- und einblenden', async ({ page }) => {
    await page.goto('/admin/setup');
    await ready(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Nächste Schritte' })).toBeVisible();
    const backup = page.locator('[data-item="backup"]');
    await expect(backup.getByRole('link', { name: 'Sicherungen öffnen' })).toBeVisible();
    await backup.getByRole('button', { name: 'Jetzt sichern' }).click();
    await expect(page.getByText('Sicherung erstellt').first()).toBeVisible();
    await expect(backup.getByText('erledigt')).toBeVisible();
    await expect(backup.getByText(/Neueste Sicherung:/)).toBeVisible();
    await expect(page.locator('[data-item="mail"]').getByRole('link', { name: 'E-Mail einrichten' })).toHaveAttribute('href', '/admin/mail');
    await expect(page.locator('[data-item="login"]').getByText('optional')).toBeVisible();
    await expectAccessible(page, 'main');

    // Hinweis in der Übersicht: sichtbar, ausblenden, über „Nächste Schritte“ wieder einblenden
    const toggle = page.getByRole('switch', { name: /Hinweis in der Übersicht anzeigen/ });
    if (!(await toggle.isChecked())) await toggle.click();
    await page.goto('/admin');
    await ready(page);
    const card = page.locator('.setup-card');
    await expect(card.getByText('Einrichtung vervollständigen')).toBeVisible();
    await card.getByRole('button', { name: 'Ausblenden' }).click();
    await expect(card).toHaveCount(0);
    await page.goto('/admin/setup');
    await ready(page);
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
  });

  test('Webhook anlegen', async ({ page }) => {
    const name = unique('Hook');
    await page.goto('/admin/webhooks');
    await page.getByRole('button', { name: 'Webhook anlegen' }).click();
    const dialog = page.getByRole('dialog', { name: 'Webhook anlegen' });
    await expectAccessible(page, '[role="dialog"]');
    await dialog.getByLabel('Name').fill(name);
    await dialog.getByLabel(/URL|Adresse/).first().fill('https://example.com/hook');
    await dialog.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText(name)).toBeVisible();
  });

  test('Audit-Log filtern', async ({ page }) => {
    await page.goto('/admin/audit');
    await page.getByLabel('Kategorie').selectOption('security');
    await expect(page.locator('tbody tr').first()).toBeVisible();
    await expect(page.locator('tbody')).toContainText(/Anmeldung|Selbstregistrierung|Passwort/);
  });
});

import { test, expect, ready } from './support/fixtures';
import { AUTH, unique } from './support/data';
import type { Page } from '@playwright/test';

test.use({ storageState: AUTH.editor });

/** Legt eine Seite über die Oberfläche an und gibt ihre Adresse und ID zurück. */
async function createPage(page: Page, spaceKey: string, title: string, body: string): Promise<string> {
  await page.goto(`/s/${spaceKey}/new`);
  await page.locator('main').getByRole('button', { name: 'Erstellen', exact: true }).click();
  await expect(page).toHaveURL(/\/edit\/\d+/);
  await page.getByPlaceholder('Seitentitel').fill(title);
  await page.locator('.editor-page .tiptap').click();
  await page.keyboard.type(body);
  await page.locator('.editor-footer').getByRole('button', { name: 'Veröffentlichen' }).click();
  await expect(page).toHaveURL(/\/p\/\d+/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  return page.url();
}

test.describe('Seiten', () => {
  test('Anlegen, bearbeiten, Versionen vergleichen und alte Version wiederherstellen', async ({ page, seed }) => {
    const title = unique('Testseite');
    const url = await createPage(page, seed.spaceKey, title, 'Erste Fassung des Textes.');
    const history = `/s/${seed.spaceKey}/history/${/\/p\/(\d+)/.exec(url)![1]}`;
    await expect(page.locator('article')).toContainText('Erste Fassung des Textes.');
    // erscheint im Seitenbaum
    await expect(page.locator('.sidebar').getByText(title)).toBeVisible();

    // Bearbeiten
    await page.getByRole('button', { name: 'Bearbeiten' }).click();
    await expect(page).toHaveURL(/\/edit\/\d+/);
    const editor = page.locator('.editor-page .tiptap');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' Ergänzt in Fassung zwei.');
    await page.getByPlaceholder('Was hast du geändert? (optional)').fill('Zweite Fassung');
    await page.locator('.editor-footer').getByRole('button', { name: 'Aktualisieren' }).click();
    await expect(page).toHaveURL(url);
    await expect(page.getByText('Ergänzt in Fassung zwei.')).toBeVisible();

    // Versionsgeschichte und Vergleich
    await page.goto(history);
    await expect(page.getByRole('heading', { level: 1, name: 'Versionsgeschichte' })).toBeVisible();
    await expect(page.getByText('Zweite Fassung')).toBeVisible();
    await page.getByRole('button', { name: 'Vergleichen', exact: true }).first().click();
    await expect(page).toHaveURL(/\/diff\/\d+\?from=1&to=2/);
    await expect(page.locator('main')).toContainText('Ergänzt in Fassung zwei.');

    // Version 1 wiederherstellen → neue Version 3 ohne Ergänzung
    await page.goto(history);
    await page.getByRole('button', { name: 'Wiederherstellen', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect(page.getByText('Version 1 wiederhergestellt').first()).toBeVisible();
    await page.goto(url);
    await expect(page.getByText('Ergänzt in Fassung zwei.')).toHaveCount(0);
    await expect(page.getByText('Version 3').first()).toBeVisible();
  });

  test('In den Papierkorb verschieben und wiederherstellen', async ({ page, seed }) => {
    const title = unique('Papierkorbseite');
    const url = await createPage(page, seed.spaceKey, title, 'Wird gleich gelöscht.');
    await page.locator('.page-toolbar').getByRole('button', { name: 'Mehr', exact: true }).last().click();
    await page.getByRole('menuitem', { name: 'In den Papierkorb' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'In den Papierkorb' }).click();
    await expect(page.getByText('Seite in den Papierkorb verschoben')).toBeVisible();
    await expect(page.locator('.sidebar').getByText(title)).toHaveCount(0);

    await page.goto(`/s/${seed.spaceKey}/trash`);
    const row = page.locator('tr, .list-item').filter({ hasText: title });
    await row.getByRole('button', { name: 'Wiederherstellen' }).click();
    await expect(page.getByText('Seite wiederhergestellt')).toBeVisible();
    await page.goto(url);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByText('Diese Seite liegt im Papierkorb.')).toHaveCount(0);
  });

  test('Unterseite anlegen und Makros der Seite werden dargestellt', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/p/${seed.richPageId}`);
    await ready(page);
    const content = page.locator('article');
    await expect(content.getByText('Hinweis: Das ist ein Infokasten.')).toBeVisible();
    await expect(content.locator('pre code')).toContainText('const antwort = 42;');
    await expect(content.getByRole('table').filter({ hasText: 'Spalte A' })).toBeVisible();
    await expect(content.locator('.mermaid svg, .node-mermaid svg').first()).toBeVisible({ timeout: 20_000 });
    await expect(content.getByRole('link', { name: 'Unterseite Alpha' }).first()).toBeVisible();
    await expect(content.getByText('notiz.txt').first()).toBeVisible();
  });

  test('Favorit und Beobachten schalten', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/p/${seed.childPageId}`);
    await ready(page);
    await page.getByRole('button', { name: 'Zu Favoriten' }).click();
    await expect(page.getByRole('button', { name: 'Aus Favoriten entfernen' })).toBeVisible();
    await page.goto('/');
    await expect(page.locator('main').getByText('Unterseite Alpha').first()).toBeVisible();
  });
});

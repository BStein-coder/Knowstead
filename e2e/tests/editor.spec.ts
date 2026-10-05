import { test, expect, expectAccessible } from './support/fixtures';
import { AUTH, unique } from './support/data';

test.use({ storageState: AUTH.editor });

test.describe('Editor', () => {
  test('Slash-Befehle, Formatierung und Markdown-Kürzel', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/new`);
    await page.locator('main').getByRole('button', { name: 'Erstellen', exact: true }).click();
    await page.getByPlaceholder('Seitentitel').fill(unique('Editortest'));
    const editor = page.locator('.editor-page .tiptap');
    await editor.click();

    // Markdown-Kürzel für Überschrift und Liste
    await page.keyboard.type('## Abschnitt');
    await page.keyboard.press('Enter');
    await expect(editor.locator('h2')).toHaveText('Abschnitt');
    await page.keyboard.type('- Punkt eins');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Punkt zwei');
    await expect(editor.locator('ul li')).toHaveCount(2);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');

    // Fett über Tastenkürzel
    await page.keyboard.press('Control+b');
    await page.keyboard.type('fett');
    await page.keyboard.press('Control+b');
    await expect(editor.locator('strong')).toHaveText('fett');
    await page.keyboard.press('Enter');

    // Slash-Menü: Hinweisbox und Tabelle
    await page.keyboard.type('/info');
    await expect(page.locator('.suggestion-list')).toBeVisible();
    await expectAccessible(page, '.suggestion-list');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Wichtiger Hinweis');
    await expect(editor.locator('[data-type="callout"], .callout').first()).toContainText('Wichtiger Hinweis');

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/tabelle');
    await page.keyboard.press('Enter');
    await expect(editor.locator('table')).toBeVisible();

    // Entwurf wird automatisch gespeichert
    await expect(page.getByText(/Entwurf gespeichert/)).toBeVisible({ timeout: 15_000 });
    await expectAccessible(page, '.editor-page');

    await page.locator('.editor-footer').getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(page).toHaveURL(/\/p\/\d+/);
    const article = page.locator('article');
    await expect(article.locator('h2', { hasText: 'Abschnitt' })).toBeVisible();
    await expect(article.getByText('Wichtiger Hinweis')).toBeVisible();
    await expect(article.locator('table')).toBeVisible();
  });

  test('Ohne Titel wird nicht veröffentlicht', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/new`);
    await page.locator('main').getByRole('button', { name: 'Erstellen', exact: true }).click();
    await page.locator('.editor-page .tiptap').click();
    await page.keyboard.type('Inhalt ohne Titel');
    await page.locator('.editor-footer').getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(page.getByText('Seitentitel').last()).toBeVisible();
    await expect(page).toHaveURL(/\/edit\/\d+/);
  });

  test('Markdown-Seite mit Vorschau', async ({ page, seed }) => {
    await page.goto(`/s/${seed.spaceKey}/new`);
    await page.getByRole('button', { name: /Markdown/ }).first().click();
    await page.locator('main').getByRole('button', { name: 'Erstellen', exact: true }).click();
    await page.getByPlaceholder('Seitentitel').fill(unique('Markdowntest'));
    const code = page.locator('.cm-content');
    await code.click();
    await page.keyboard.type('# Titel im Markdown\n\n**Fett** und `Code`');
    if (!(await page.locator('.preview-pane').isVisible())) await page.getByRole('button', { name: 'Vorschau' }).click();
    await expect(page.locator('.preview-pane').getByRole('heading', { name: 'Titel im Markdown' })).toBeVisible();
    await page.locator('.editor-footer').getByRole('button', { name: 'Veröffentlichen' }).click();
    await expect(page).toHaveURL(/\/p\/\d+/);
    await expect(page.locator('article').getByRole('heading', { name: 'Titel im Markdown' })).toBeVisible();
  });
});
